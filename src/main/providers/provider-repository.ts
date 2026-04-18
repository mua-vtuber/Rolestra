/**
 * Provider Repository — DB persistence for provider configurations.
 *
 * Reads and writes provider data to the `providers` SQLite table.
 * The registry (in-memory) and repository (DB) are synchronized
 * by provider-handler.ts during add/remove operations.
 */

import { getDatabase } from '../database/connection';
import type { ProviderConfig, ProviderType } from '../../shared/provider-types';

/** Row shape returned by SELECT from the providers table. */
export interface ProviderRow {
  id: string;
  type: ProviderType;
  name: string;
  model: string;
  persona: string | null;
  config: string; // JSON-serialized ProviderConfig
}

/** Save a provider to the database. Upserts (insert or replace). */
export function saveProvider(
  id: string,
  type: ProviderType,
  displayName: string,
  model: string,
  persona: string | undefined,
  config: ProviderConfig,
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO providers (id, type, name, model, persona, config, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(id, type, displayName, model, persona ?? null, JSON.stringify(config));
}

/** Remove a provider from the database by ID. */
export function removeProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/** Load all providers from the database. */
export function loadAllProviders(): ProviderRow[] {
  const db = getDatabase();
  return db.prepare('SELECT id, type, name, model, persona, config FROM providers').all() as ProviderRow[];
}
