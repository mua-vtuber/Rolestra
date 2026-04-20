/**
 * Handler for 'provider:*' IPC channels.
 *
 * Bridges between the IPC layer and the provider registry.
 * Uses the provider factory to create provider instances.
 * Synchronizes in-memory registry with DB persistence.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import { providerRegistry } from '../../providers/registry';
import { createProvider } from '../../providers/factory';
import { getEmbeddingModelsForProvider, getModelsForProvider } from '../../providers/model-registry';
import { getConfigService } from '../../config/instance';
import { saveProvider, removeProvider } from '../../providers/provider-repository';

/** Resolve an API key reference to the actual key value. */
async function resolveApiKey(ref: string): Promise<string> {
  const secret = getConfigService().getSecret(ref);
  if (!secret) throw new Error(`API key not found: ${ref}`);
  return secret;
}

/**
 * provider:list — return all registered providers.
 */
export function handleProviderList(): IpcResponse<'provider:list'> {
  return { providers: providerRegistry.listAll() };
}

/**
 * provider:add — register a new provider via factory + persist to DB.
 */
export async function handleProviderAdd(
  data: IpcRequest<'provider:add'>,
): Promise<IpcResponse<'provider:add'>> {
  const provider = createProvider({
    displayName: data.displayName,
    persona: data.persona,
    config: data.config,
    resolveApiKey,
  });

  providerRegistry.register(provider);

  // Persist to DB so the provider survives app restart. v3 schema stores
  // model inside config_json (§5.2 001_core); no separate column.
  saveProvider(
    provider.id,
    provider.type,
    provider.displayName,
    provider.persona,
    data.config,
  );

  // Warmup in background (don't block the response)
  void provider.warmup();

  return { provider: provider.toInfo() };
}

/**
 * provider:remove — unregister, shutdown, and remove from DB.
 */
export async function handleProviderRemove(
  data: IpcRequest<'provider:remove'>,
): Promise<IpcResponse<'provider:remove'>> {
  await providerRegistry.unregister(data.id);
  removeProvider(data.id);
  return { success: true };
}

/**
 * provider:list-models — return models for a provider type + key.
 * For API providers, resolves apiKeyRef to the actual key for live model fetching.
 */
export async function handleProviderListModels(
  data: IpcRequest<'provider:list-models'>,
): Promise<IpcResponse<'provider:list-models'>> {
  let apiKey: string | undefined;
  if (data.apiKeyRef) {
    apiKey = getConfigService().getSecret(data.apiKeyRef) ?? undefined;
  }
  return { models: await getModelsForProvider(data.type, data.key, apiKey) };
}

/**
 * provider:list-embedding-models — return embedding-capable models for a provider.
 */
export async function handleProviderListEmbeddingModels(
  data: IpcRequest<'provider:list-embedding-models'>,
): Promise<IpcResponse<'provider:list-embedding-models'>> {
  let apiKey: string | undefined;
  if (data.apiKeyRef) {
    apiKey = getConfigService().getSecret(data.apiKeyRef) ?? undefined;
  }
  return { models: await getEmbeddingModelsForProvider(data.type, data.key, apiKey) };
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
