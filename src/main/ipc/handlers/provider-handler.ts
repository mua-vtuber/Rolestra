/**
 * Handler for 'provider:*' IPC channels.
 *
 * Bridges between the IPC layer and the provider registry.
 * Uses the provider factory to create provider instances.
 * Synchronizes in-memory registry with DB persistence.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type {
  ApiKeyCleanup,
  ApiProviderConfig,
  InactiveCliProviderInfo,
  ProviderConfig,
} from '../../../shared/provider-types';
import { providerRegistry } from '../../providers/registry';
import { isSupportedChatCliCommand } from '../../providers/factory';
import {
  getModelsForProvider,
  ModelRegistryAuthError,
  ModelRegistryNetworkError,
  ModelRegistryParseError,
} from '../../providers/model-registry';
import { getConfigService } from '../../config/instance';
import { saveProvider, removeProvider, loadAllProviders } from '../../providers/provider-repository';
import { registerProvider } from '../../providers/provider-registration';
import { releaseApiKeyRef } from '../../providers/api-key-release';
import { tryGetLogger } from '../../log/logger-accessor';

/**
 * provider:list — return all registered providers.
 */
export function handleProviderList(): IpcResponse<'provider:list'> {
  return { providers: providerRegistry.listAll() };
}

/**
 * provider:add — register a CLI or API AI (`provider-registration.ts`).
 *
 * F2-3: rejects a display name that collides (case-insensitively) with any
 * registered AI — chat-room participants are told apart by this name in the
 * model's own input. The router discards the schema's parsed value, so the
 * registration trims the name itself.
 *
 * A local AI is not added here: `provider:add-local` finds and confirms the
 * Ollama server in main (manual address entry was dropped, 2026-10-01 user
 * decision), and this channel's schema has no local branch.
 */
export async function handleProviderAdd(
  data: IpcRequest<'provider:add'>,
): Promise<IpcResponse<'provider:add'>> {
  return { provider: await registerProvider(data.displayName, data.config) };
}

/**
 * Deletes the secret behind `ref` unless another stored AI still uses it
 * (`api-key-release.ts`). A failure is logged and returned — the AI change
 * that triggered it has already been committed.
 */
function releaseProviderApiKey(
  ref: string,
  providerId: string,
  action: 'remove' | 'replace-api-key',
): ApiKeyCleanup {
  const cleanup = releaseApiKeyRef(ref, {
    remainingRows: loadAllProviders,
    deleteSecret: (key) => getConfigService().deleteSecret(key),
  });
  if (cleanup.status === 'failed') {
    tryGetLogger()?.error({
      component: 'provider-handler',
      action: `${action}:api-key-cleanup`,
      result: 'failure',
      metadata: { providerId, apiKeyRef: ref, cause: cleanup.message },
    });
  }
  return cleanup;
}

/**
 * provider:remove — unregister, shutdown, and remove from DB.
 *
 * R5-6 (spec 2026-10-01-messenger-redesign.md): an API AI's stored key is
 * deleted with it, unless another registered AI shares the same ref.
 * `apiKeyCleanup` is `null` for CLI / local AIs, which have no key.
 */
export async function handleProviderRemove(
  data: IpcRequest<'provider:remove'>,
): Promise<IpcResponse<'provider:remove'>> {
  const config = providerRegistry.get(data.id)?.config;
  await providerRegistry.unregister(data.id);
  removeProvider(data.id);
  const apiKeyCleanup = config?.type === 'api'
    ? releaseProviderApiKey(config.apiKeyRef, data.id, 'remove')
    : null;
  return { success: true, apiKeyCleanup };
}

/**
 * provider:replace-api-key — points an API AI at a key the renderer has just
 * stored with `config:set-secret` (only the ref crosses IPC), then releases
 * the previous key under the same sharing rule as provider:remove.
 *
 * The new ref must already hold a secret and must differ from the current
 * one. The row is saved before the live instance changes, so a failed save
 * leaves both the provider and its old key untouched — the renderer then
 * deletes the secret it stored for this attempt.
 */
export function handleProviderReplaceApiKey(
  data: IpcRequest<'provider:replace-api-key'>,
): IpcResponse<'provider:replace-api-key'> {
  const provider = providerRegistry.get(data.id);
  if (!provider) throw new Error(`Provider not found: ${data.id}`);
  if (provider.config.type !== 'api') {
    throw new Error(`Provider ${data.id} is not an API provider`);
  }
  const previousRef = provider.config.apiKeyRef;
  if (previousRef === data.apiKeyRef) {
    throw new Error(`Provider ${data.id} already uses API key ref ${data.apiKeyRef}`);
  }
  if (!getConfigService().getSecret(data.apiKeyRef)) {
    throw new Error(`API key not found: ${data.apiKeyRef}`);
  }

  const nextConfig: ApiProviderConfig = { ...provider.config, apiKeyRef: data.apiKeyRef };
  saveProvider(
    provider.id,
    provider.type,
    provider.displayName,
    nextConfig,
    provider.roles,
    provider.skill_overrides,
    provider.isDepartmentHead,
  );
  provider.config = nextConfig;

  const previousKeyCleanup = releaseProviderApiKey(previousRef, provider.id, 'replace-api-key');
  return { provider: provider.toInfo(), previousKeyCleanup };
}

/**
 * provider:list-inactive-cli (B1) — return DB-stored CLI provider rows
 * whose command is not one of the supported chat CLIs (see
 * `isSupportedChatCliCommand`). `provider-restore.ts` keeps these rows in
 * the DB but never restores them into the live registry, so they would
 * otherwise vanish from `provider:list` without explanation. Never
 * deletes or executes the row — read-only.
 */
export function handleProviderListInactiveCli(): IpcResponse<'provider:list-inactive-cli'> {
  const inactive: InactiveCliProviderInfo[] = [];
  for (const row of loadAllProviders()) {
    let config: ProviderConfig;
    try {
      config = JSON.parse(row.configJson) as ProviderConfig;
    } catch (error) {
      // B8: a corrupt row is still real data the user needs to see and
      // act on (remove it or re-register the CLI) — never drop it
      // silently. `command` stays null: there is no real command value
      // to show, and inventing a placeholder like 'unknown' would be
      // fake data presented as real (CLAUDE.md no-silent-fallback rule).
      tryGetLogger()?.warn({
        component: 'provider-handler',
        action: 'list-inactive-cli',
        result: 'failure',
        metadata: { id: row.id, error: error instanceof Error ? error.message : String(error) },
      });
      inactive.push({
        id: row.id,
        displayName: row.displayName,
        command: null,
        reason: 'corrupt-config',
      });
      continue;
    }
    if (config.type !== 'cli' || isSupportedChatCliCommand(config.command)) continue;
    inactive.push({
      id: row.id,
      displayName: row.displayName,
      command: config.command,
      reason: 'unsupported-command',
    });
  }
  return { inactive };
}

/**
 * provider:list-models — return models for a provider type + key.
 * For API providers, resolves apiKeyRef to the actual key for live model
 * fetching; a ref with no stored key is an error, never the static catalog.
 * Local (Ollama) models are listed by `provider:detect-local` instead.
 *
 * F1-6: a live-fetch failure (wrong key / service unreachable / unreadable
 * response) is caught here and turned into `{ ok: false, reason }` — a
 * FIRST-CLASS response, never a rejected IPC call and never a silent empty
 * list. `getModelsForProvider` already discriminates the three cases via
 * `ModelRegistryAuthError` / `*NetworkError` / `*ParseError`; this handler
 * maps each to its `ModelListFailureReason` code. Any other unexpected
 * throw is NOT caught here — it propagates to the router's generic error
 * path, which is the correct behavior for a genuinely unexpected failure
 * (never mask it as one of the three known reasons).
 */
export async function handleProviderListModels(
  data: IpcRequest<'provider:list-models'>,
): Promise<IpcResponse<'provider:list-models'>> {
  let apiKey: string | undefined;
  if (data.apiKeyRef) {
    const secret = getConfigService().getSecret(data.apiKeyRef);
    if (!secret) throw new Error(`API key not found: ${data.apiKeyRef}`);
    apiKey = secret;
  }
  try {
    const models = await getModelsForProvider(data.type, data.key, apiKey);
    return { ok: true, models };
  } catch (err) {
    if (err instanceof ModelRegistryAuthError) return { ok: false, reason: 'auth' };
    if (err instanceof ModelRegistryNetworkError) return { ok: false, reason: 'network' };
    if (err instanceof ModelRegistryParseError) return { ok: false, reason: 'parse' };
    throw err;
  }
}

/**
 * provider:validate — check if a provider can connect.
 */
export async function handleProviderValidate(
  data: IpcRequest<'provider:validate'>,
): Promise<IpcResponse<'provider:validate'>> {
  const provider = providerRegistry.get(data.id);
  if (!provider) {
    return { valid: false, message: `Provider not found: ${data.id}` };
  }
  try {
    const valid = await provider.validateConnection();
    return { valid };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, message };
  }
}
