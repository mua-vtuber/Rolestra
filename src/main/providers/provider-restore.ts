/**
 * Provider Restore — restores persisted providers from DB on app startup.
 *
 * Reads all rows from the `providers` table and re-creates live provider
 * instances via the factory, then registers them in the in-memory registry.
 *
 * Called once during app boot, after migrations and before IPC handlers.
 */

import type { ProviderConfig } from '../../shared/provider-types';
import type { RoleId } from '../../shared/role-types';
import { loadAllProviders } from './provider-repository';
import { createProvider } from './factory';
import { providerRegistry } from './registry';
import { getConfigService } from '../config/instance';

/**
 * R12-S: providers.roles 컬럼 (JSON-serialized RoleId[]) 를 파싱한다.
 * JSON 손상 시 silent fallback 금지 — providerId 와 원본 문자열을 포함한
 * loud throw 로 사용자에게 정확한 위치를 알린다 (CLAUDE.md 절대 규칙).
 */
function parseRoles(rolesJson: string, providerId: string): RoleId[] {
  try {
    const arr = JSON.parse(rolesJson);
    if (!Array.isArray(arr)) {
      throw new Error(`roles JSON is not an array: ${rolesJson}`);
    }
    return arr as RoleId[];
  } catch (err) {
    throw new Error(
      `[provider-restore] failed to parse providers.roles for ${providerId}: ${rolesJson}. ` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

/**
 * R12-S: providers.skill_overrides 컬럼 (JSON-serialized
 * Record<RoleId, string> | null) 를 파싱한다. NULL 은 정상 (default
 * 카탈로그 사용 의미). 그 외 손상은 throw.
 */
function parseSkillOverrides(
  json: string | null,
  providerId: string,
): Partial<Record<RoleId, string>> | null {
  if (json === null) return null;
  try {
    const obj = JSON.parse(json);
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new Error(`skill_overrides JSON is not an object: ${json}`);
    }
    return obj as Partial<Record<RoleId, string>>;
  } catch (err) {
    throw new Error(
      `[provider-restore] failed to parse providers.skill_overrides for ${providerId}: ${json}. ` +
        `Cause: ${(err as Error).message}`,
    );
  }
}

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
      const config = JSON.parse(row.configJson) as ProviderConfig;
      const provider = createProvider({
        id: row.id,
        displayName: row.displayName,
        persona: row.persona ?? undefined,
        config,
        resolveApiKey,
        roles: parseRoles(row.roles, row.id),
        skill_overrides: parseSkillOverrides(row.skillOverrides, row.id),
      });

      providerRegistry.register(provider);
      // Warmup in background
      void provider.warmup();

      console.log(`[provider-restore] Restored: ${row.displayName} (${row.id})`);
    } catch (err) {
      console.error(`[provider-restore] Failed to restore provider ${row.id}:`, err);
    }
  }
}
