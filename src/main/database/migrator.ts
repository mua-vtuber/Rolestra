/**
 * Forward-only, idempotent database migration runner.
 *
 * Design principles:
 * - Forward-only: no rollback scripts, migrations only move forward.
 * - Idempotent: uses IF NOT EXISTS so re-running applied migrations is safe.
 * - Startup blocking: throws on failure, preventing the app from starting
 *   with an inconsistent schema.
 * - Migration files are immutable once applied.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from './connection';
import { migrations } from './migrations/index';

export interface Migration {
  /** Unique sequential identifier, e.g. '001-initial-schema' */
  readonly id: string;
  /** SQL statements to execute for this migration */
  readonly sql: string;
}

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
 * Runs all pending migrations in order.
 *
 * Each migration is executed within a transaction:
 * - If the migration SQL succeeds, it is recorded in the migrations table.
 * - If it fails, the transaction is rolled back and an error is thrown,
 *   blocking app startup.
 *
 * Already-applied migrations are skipped (idempotent behavior).
 *
 * @throws {Error} If any migration fails, with a message indicating which
 *   migration caused the failure. This is intentionally fatal to prevent
 *   the app from running with an inconsistent schema.
 */
export function runMigrations(): void {
  const db = getDatabase();

  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    const runInTransaction = db.transaction(() => {
      db.exec(migration.sql);
      recordMigration(db, migration.id);
    });

    try {
      runInTransaction();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Startup blocked: migration '${migration.id}' failed — ${message}`
      );
    }
  }
}
