/**
 * SQLite connection management using better-sqlite3.
 *
 * Provides a singleton database instance with WAL mode enabled. The concrete
 * file path is resolved from the active {@link ArenaRootService} (set at app
 * bootstrap via {@link initDatabaseRoot}); the DB therefore lives at
 * `<ArenaRoot>/db/arena.sqlite` instead of the Electron userData directory.
 *
 * Legacy fallback: if a v2 database (`<userData>/arena.db`) is still present
 * on disk at first connection attempt, the app refuses to start. Rolestra v3
 * uses an incompatible schema chain and cannot safely migrate a v2 DB in
 * place; users must move that file aside or point to a fresh ArenaRoot.
 */

import Database from 'better-sqlite3';

import { DB_BUSY_TIMEOUT_MS } from '../../shared/timeouts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ArenaRootService } from '../arena/arena-root-service';

/** Legacy v2 DB filename (previously stored under userData). */
const LEGACY_DB_FILENAME = 'arena.db';

let db: Database.Database | null = null;
let arenaRoot: ArenaRootService | null = null;

/**
 * Wires the ArenaRootService that {@link getDatabase} will query for the DB
 * file location. Clears any previously opened handle so the next
 * {@link getDatabase} call re-opens against the new path. Must be called
 * during app bootstrap after {@link ArenaRootService.ensure} completes.
 */
export function initDatabaseRoot(service: ArenaRootService): void {
  if (db !== null) {
    db.close();
  }
  arenaRoot = service;
  db = null;
}

/**
 * Best-effort detection of a v2 userData-based DB. Returns silently when
 * Electron's `app` module is unavailable (e.g. unit tests) or when no legacy
 * file exists. Throws only when a legacy file is actually present.
 */
function detectLegacyDatabase(): void {
  let legacyPath: string | null = null;
  try {
    // Lazy-require to keep the module importable in non-Electron contexts
    // (vitest specs that construct their own DB and never call getDatabase()).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    const userData = app.getPath('userData');
    legacyPath = join(userData, LEGACY_DB_FILENAME);
  } catch {
    // Electron not available — skip legacy detection.
    return;
  }

  if (legacyPath !== null && existsSync(legacyPath)) {
    throw new Error(
      `Legacy v2 DB detected at ${legacyPath}. v2 migration is not supported ` +
        `in Rolestra v3. Move this file aside or choose a fresh ArenaRoot ` +
        `before restarting.`,
    );
  }
}

/**
 * Returns the singleton database instance.
 *
 * Creates and configures the connection on first call:
 * - WAL journal mode for concurrent read performance
 * - Foreign keys enabled for referential integrity
 * - Busy timeout to handle brief lock contention
 *
 * @throws {Error} If {@link initDatabaseRoot} has not been called.
 * @throws {Error} If a legacy v2 DB is detected at `<userData>/arena.db`.
 */
export function getDatabase(): Database.Database {
  if (db !== null) {
    return db;
  }

  if (!arenaRoot) {
    throw new Error(
      'Database access before ArenaRootService initialization. ' +
        'Call initDatabaseRoot() during app bootstrap before invoking getDatabase().',
    );
  }

  detectLegacyDatabase();

  const dbPath = arenaRoot.dbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');

  // Set busy timeout to handle brief lock contention. Value sourced
  // from src/shared/timeouts.ts so the renderer parity test can assert
  // the same constant without re-deriving it.
  db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);

  return db;
}

/**
 * Closes the database connection and releases resources.
 * Safe to call multiple times; subsequent calls are no-ops.
 * Should be called during app shutdown (e.g., 'before-quit' event).
 */
export function closeDatabase(): void {
  if (db !== null) {
    db.close();
    db = null;
  }
}
