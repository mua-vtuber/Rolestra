/**
 * Forward-only, idempotent database migration runner.
 *
 * Design principles:
 * - Forward-only: no rollback scripts, migrations only move forward.
 * - Idempotent: uses IF NOT EXISTS so re-running applied migrations is safe.
 * - Startup blocking: throws on failure, preventing the app from starting
 *   with an inconsistent schema.
 * - Migration files are immutable once applied.
 * - Legacy guard: Rolestra v3 refuses to run against a v2 DB; users must
 *   start from a fresh ArenaRoot. See `assertNoLegacyMigrations` below.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from './connection';
import { migrations as defaultMigrations } from './migrations/index';

export interface Migration {
  /** Unique sequential identifier, e.g. '001-initial-schema' */
  readonly id: string;
  /** SQL statements to execute for this migration */
  readonly sql: string;
}

/**
 * v2 (AI Chat Arena) migration IDs.
 * Presence of any of these in the `migrations` table indicates a DB that was
 * migrated by v2 and is incompatible with the Rolestra v3 schema chain.
 */
const LEGACY_V2_IDS: ReadonlySet<string> = new Set([
  '001-initial-schema',
  '002-recovery-tables',
  '003-remote-tables',
  '004-memory-enhancement',
  '005-consensus-records',
  '006-consensus-summary',
  '007-session-mode-columns',
]);

/**
 * Ensures the migrations tracking table exists.
 * Uses IF NOT EXISTS so it is safe to call repeatedly.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Returns the set of migration IDs that have already been applied.
 */
function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/**
 * Records a migration as successfully applied.
 */
function recordMigration(db: Database.Database, migrationId: string): void {
  db.prepare('INSERT INTO migrations (id) VALUES (?)').run(migrationId);
}

/**
 * Refuses to boot against a v2 (AI Chat Arena) database.
 *
 * Rolestra v3 uses an incompatible schema chain; silently re-migrating a v2 DB
 * could corrupt user data. This guard throws with a clear guidance message
 * when any known v2 migration row is present.
 *
 * Safe to call on fresh installs — the `migrations` table is created on demand
 * and will be empty, so no legacy rows can match.
 *
 * @throws {Error} If a v2 migration id is found in the `migrations` table.
 */
export function assertNoLegacyMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);
  const rows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  const hit = rows.find((r) => LEGACY_V2_IDS.has(r.id));
  if (hit) {
    throw new Error(
      `Legacy v2 migration detected: ${hit.id}. ` +
        `Rolestra v3 requires a fresh DB. Move <ArenaRoot>/db/arena.sqlite aside ` +
        `or create a new ArenaRoot.`,
    );
  }
}

/**
 * Runs all pending migrations in order.
 *
 * Each migration is executed within a transaction:
 * - If the migration SQL succeeds, it is recorded in the migrations table.
 * - If it fails, the transaction is rolled back and an error is thrown,
 *   blocking app startup.
 *
 * Already-applied migrations are skipped (idempotent behavior).
 *
 * Overloads:
 * - `runMigrations()` — production path; uses the singleton DB from
 *   {@link getDatabase} and the module-level migration chain.
 * - `runMigrations(db)` — explicit DB, default chain; used by the singleton
 *   wrapper and simple tests.
 * - `runMigrations(db, migrations)` — explicit DB and chain; used by unit
 *   tests that want to inject a minimal or alternate migration set.
 *
 * @throws {Error} If any migration fails, with a message indicating which
 *   migration caused the failure. This is intentionally fatal to prevent
 *   the app from running with an inconsistent schema.
 */
export function runMigrations(
  db?: Database.Database,
  migrations: readonly Migration[] = defaultMigrations,
): void {
  const database = db ?? getDatabase();

  assertNoLegacyMigrations(database);
  ensureMigrationsTable(database);

  const applied = getAppliedMigrations(database);
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    const runInTransaction = database.transaction(() => {
      database.exec(migration.sql);
      recordMigration(database, migration.id);
    });

    try {
      runInTransaction();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Startup blocked: migration '${migration.id}' failed — ${message}`,
      );
    }
  }
}
