/**
 * Registering a new AI (QA Minor 9: one place for `provider:add` and
 * `provider:add-local`): supported-CLI check, display-name uniqueness
 * (`display-name-uniqueness.ts`, case-insensitive), the live instance, then
 * the DB row — the instance is discarded if the save fails, so a failed add
 * leaves nothing behind. Warm-up runs in the background.
 */
import type { ProviderConfig, ProviderInfo } from '../../shared/provider-types';
import { getConfigService } from '../config/instance';
import { assertDisplayNameAvailable } from './display-name-uniqueness';
import { createProvider, isSupportedChatCliCommand } from './factory';
import { saveProvider } from './provider-repository';
import { providerRegistry } from './registry';

/** Resolve an API key reference to the actual key value. */
async function resolveApiKey(ref: string): Promise<string> {
  const secret = getConfigService().getSecret(ref);
  if (!secret) throw new Error(`API key not found: ${ref}`);
  return secret;
}

export async function registerProvider(requestedName: string, config: ProviderConfig): Promise<ProviderInfo> {
  if (config.type === 'cli' && !isSupportedChatCliCommand(config.command)) {
    throw new Error('Unsupported chat CLI command');
  }
  const displayName = requestedName.trim();
  assertDisplayNameAvailable(displayName);
  // F3 (QA defect 1): no `persona` input — the character sheet
  // (MemberProfile.characterSheet) is the only editable persona surface.
  const provider = createProvider({ displayName, config, resolveApiKey });

  providerRegistry.register(provider);

  // Persist so the AI survives a restart. The model lives inside config_json;
  // a new AI starts with no roles, no department-head pin and an empty
  // legacy persona column (the character sheet is the persona).
  try {
    saveProvider(
      provider.id,
      provider.type,
      provider.displayName,
      config,
      provider.roles,
      provider.skill_overrides,
      provider.isDepartmentHead,
    );
  } catch (err) {
    providerRegistry.discardUnstarted(provider.id);
    throw err;
  }

  void provider.warmup();
  return provider.toInfo();
}
