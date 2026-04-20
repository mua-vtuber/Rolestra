/**
 * Provider Repository — DB persistence for provider configurations.
 *
 * Reads and writes provider data to the v3 `providers` SQLite table (schema
 * defined in src/main/database/migrations/001-core.ts — spec §5.2 001_core).
 * The registry (in-memory) and repository (DB) are synchronized by
 * provider-handler.ts during add/remove operations.
 */

import { getDatabase } from '../database/connection';
import type { ProviderConfig, ProviderType } from '../../shared/provider-types';

/** Row shape returned by SELECT from the v3 providers table. */
export interface ProviderRow {
  id: string;
  kind: ProviderType;
  displayName: string;
  persona: string | null;
  /** JSON-serialized ProviderConfig; model lives inside the config. */
  configJson: string;
}

/** Save a provider to the database. Upserts (insert or replace). */
export function saveProvider(
  id: string,
  kind: ProviderType,
  displayName: string,
  persona: string | undefined,
  config: ProviderConfig,
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO providers (id, display_name, kind, config_json, persona, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      kind         = excluded.kind,
      config_json  = excluded.config_json,
      persona      = excluded.persona,
      updated_at   = unixepoch()
  `);
  stmt.run(id, displayName, kind, JSON.stringify(config), persona ?? '');
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
      `SELECT id, kind, display_name AS displayName, persona, config_json AS configJson
         FROM providers`,
    )
    .all() as ProviderRow[];
}
