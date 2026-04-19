/**
 * DatabaseManager — export, import, and stats for the SQLite database.
 *
 * - exportDatabase: VACUUM INTO a copy at user-chosen path.
 * - importDatabase: validate then replace the DB file (requires app restart).
 * - getStats: table names + row counts + file size.
 *
 * The live DB path is resolved through the ArenaRoot-backed connection module
 * ({@link getDatabase}); better-sqlite3 exposes it via `.name`. This avoids
 * duplicating the `<ArenaRoot>/db/arena.sqlite` computation here.
 */

import * as fs from 'node:fs';
import { getDatabase } from './connection';

/** Return the path to the live database file (resolved from ArenaRoot). */
export function getDatabasePath(): string {
  return getDatabase().name;
}

/** Export (VACUUM INTO) to targetPath. Returns the written path. */
export function exportDatabase(targetPath: string): string {
  const db = getDatabase();
  db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  return targetPath;
}

/**
 * Import a database from sourcePath.
 * Validates it is a valid SQLite file before replacing the live DB.
 * The caller must restart the app after a successful import.
 */
export function importDatabase(sourcePath: string): void {
  // Basic validation: check magic header (first 16 bytes)
  const fd = fs.openSync(sourcePath, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);

  const header = buf.toString('utf8', 0, 15);
  if (header !== 'SQLite format 3') {
    throw new Error('Invalid SQLite database file');
  }

  const dbPath = getDatabasePath();
  // Copy the import file over the live DB location
  fs.copyFileSync(sourcePath, dbPath);
  // Also remove WAL/SHM files if they exist
  for (const ext of ['-wal', '-shm']) {
    const walPath = dbPath + ext;
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  }
}

/** Return per-table row counts and total file size. */
export function getDatabaseStats(): {
  tables: Array<{ name: string; count: number }>;
  sizeBytes: number;
} {
  const db = getDatabase();
  const dbPath = getDatabasePath();

  // Get all user tables
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;

  const tables = tableRows.map((row) => {
    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM "${row.name}"`).get() as { cnt: number };
    return { name: row.name, count: countRow.cnt };
  });

  let sizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    sizeBytes = stat.size;
    // Include WAL file size if exists
    const walPath = dbPath + '-wal';
    if (fs.existsSync(walPath)) {
      sizeBytes += fs.statSync(walPath).size;
    }
  } catch {
    // File may not exist in test environments
  }

  return { tables, sizeBytes };
}
