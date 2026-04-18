/**
 * SQLite connection management using better-sqlite3.
 *
 * Provides a singleton database instance with WAL mode enabled.
 * The database file is stored in the Electron userData directory.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';

const DB_FILENAME = 'arena.db';

let db: Database.Database | null = null;

/**
 * Returns the singleton database instance.
 * Creates and configures the connection on first call:
 * - WAL journal mode for concurrent read performance
 * - Foreign keys enabled for referential integrity
 * - Busy timeout to handle brief lock contention
 *
 * @throws {Error} If the database connection cannot be established
 */
export function getDatabase(): Database.Database {
  if (db !== null) {
    return db;
  }

  const dbPath = join(app.getPath('userData'), DB_FILENAME);

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');

  // Set busy timeout to 5 seconds to handle brief lock contention
  db.pragma('busy_timeout = 5000');

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
