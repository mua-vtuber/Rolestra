/**
 * In-memory SQLite test database utilities.
 *
 * Creates disposable in-memory databases with real migrations applied,
 * ready for integration testing of repository and memory layers.
 */

import Database from 'better-sqlite3';
import { migrations } from '../main/database/migrations/index';
import { ConversationRepository } from '../main/database/conversation-repository';
import type { Migration } from '../main/database/migrator';

/**
 * Create an in-memory SQLite database with all migrations applied.
 * Caller is responsible for calling db.close() in afterEach.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureMigrationsTable(db);
  for (const migration of migrations) {
    applyMigration(db, migration);
  }

  return db;
}

/**
 * Create an in-memory SQLite database with migrations applied up to
 * (and including) the given migration ID.
 *
 * Useful for testing migration chain behaviour.
 */
export function createTestDbUpTo(migrationId: string): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureMigrationsTable(db);
  for (const migration of migrations) {
    applyMigration(db, migration);
    if (migration.id === migrationId) break;
  }

  return db;
}

/**
 * Create a ConversationRepository backed by an in-memory test DB,
 * pre-seeded with a conversation and a few messages.
 */
export function createTestRepo(db: Database.Database): {
  repo: ConversationRepository;
  conversationId: string;
} {
  const repo = new ConversationRepository(db);
  const conversationId = 'test-conv-1';

  repo.createConversation(
    conversationId,
    'Test Conversation',
    'arena',
    JSON.stringify([
      { id: 'ai-1', displayName: 'Claude' },
      { id: 'ai-2', displayName: 'Gemini' },
      { id: 'user', displayName: 'User' },
    ]),
  );

  return { repo, conversationId };
}

// ── Internal helpers ──────────────────────────────────────────────────

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function applyMigration(db: Database.Database, migration: Migration): void {
  const tx = db.transaction(() => {
    db.exec(migration.sql);
    db.prepare('INSERT OR IGNORE INTO migrations (id) VALUES (?)').run(migration.id);
  });
  tx();
}
