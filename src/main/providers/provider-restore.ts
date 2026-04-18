/**
 * Provider Restore — restores persisted providers from DB on app startup.
 *
 * Reads all rows from the `providers` table and re-creates live provider
 * instances via the factory, then registers them in the in-memory registry.
 *
 * Called once during app boot, after migrations and before IPC handlers.
 */

import type { ProviderConfig } from '../../shared/provider-types';
import { loadAllProviders } from './provider-repository';
import { createProvider } from './factory';
import { providerRegistry } from './registry';
import { getConfigService } from '../config/instance';

/** Resolve an API key reference to the actual key value. */
async function resolveApiKey(ref: string): Promise<string> {
  const secret = getConfigService().getSecret(ref);
  if (!secret) throw new Error(`API key not found: ${ref}`);
  return secret;
}

/**
 * Restore all providers from DB into the in-memory registry.
 * Logs warnings for individual failures but does not throw.
 */
export function restoreProvidersFromDb(): void {
  const rows = loadAllProviders();
  if (rows.length === 0) return;

  console.log(`[provider-restore] Restoring ${rows.length} provider(s) from DB...`);

  for (const row of rows) {
    try {
      const config = JSON.parse(row.config) as ProviderConfig;
      const provider = createProvider({
        id: row.id,
        displayName: row.name,
        persona: row.persona ?? undefined,
        config,
        resolveApiKey,
      });

      providerRegistry.register(provider);
      // Warmup in background
      void provider.warmup();

      console.log(`[provider-restore] Restored: ${row.name} (${row.id})`);
    } catch (err) {
      console.error(`[provider-restore] Failed to restore provider ${row.id}:`, err);
    }
  }
}
