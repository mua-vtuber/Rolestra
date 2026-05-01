/**
 * Provider Repository — DB persistence for provider configurations.
 *
 * Reads and writes provider data to the v3 `providers` SQLite table (schema
 * defined in src/main/database/migrations/001-core.ts — spec §5.2 001_core).
 * The registry (in-memory) and repository (DB) are synchronized by
 * provider-handler.ts during add/remove operations.
 *
 * R12-S (Task 5): roles + skill_overrides 두 컬럼 read/write 추가.
 * 두 필드는 JSON 문자열로 저장되며 parsing 은 provider-restore 에서
 * 수행한다 (silent fallback 금지 — JSON 깨지면 throw).
 */

import { getDatabase } from '../database/connection';
import type { ProviderConfig, ProviderType } from '../../shared/provider-types';
import type { RoleId } from '../../shared/role-types';

/** Row shape returned by SELECT from the v3 providers table. */
export interface ProviderRow {
  id: string;
  kind: ProviderType;
  displayName: string;
  persona: string | null;
  /** JSON-serialized ProviderConfig; model lives inside the config. */
  configJson: string;
  /** R12-S: JSON-serialized RoleId[]. */
  roles: string;
  /** R12-S: JSON-serialized Record<RoleId, string> | null. */
  skillOverrides: string | null;
}

/** Save a provider to the database. Upserts (insert or replace). */
export function saveProvider(
  id: string,
  kind: ProviderType,
  displayName: string,
  persona: string | undefined,
  config: ProviderConfig,
  roles: RoleId[],
  skillOverrides: Partial<Record<RoleId, string>> | null,
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO providers (id, display_name, kind, config_json, persona, roles, skill_overrides, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      display_name    = excluded.display_name,
      kind            = excluded.kind,
      config_json     = excluded.config_json,
      persona         = excluded.persona,
      roles           = excluded.roles,
      skill_overrides = excluded.skill_overrides,
      updated_at      = unixepoch()
  `);
  stmt.run(
    id,
    displayName,
    kind,
    JSON.stringify(config),
    persona ?? '',
    JSON.stringify(roles),
    skillOverrides === null ? null : JSON.stringify(skillOverrides),
  );
}

/** Remove a provider from the database by ID. */
export function removeProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/** Load all providers from the database. */
export function loadAllProviders(): ProviderRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, kind, display_name AS displayName, persona, config_json AS configJson,
              roles, skill_overrides AS skillOverrides
         FROM providers`,
    )
    .all() as ProviderRow[];
}
