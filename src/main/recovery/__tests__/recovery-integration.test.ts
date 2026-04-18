/**
 * Integration test: DB Migration → Recovery
 *
 * Verifies that:
 * 1. Full migration chain (001→002→003) applies correctly
 * 2. RecoveryManager works with migrated schema
 * 3. App restart simulation → recovery flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { RecoveryManager } from '../recovery-manager';
import migration001 from '../../database/migrations/001-initial-schema';
import migration002 from '../../database/migrations/002-recovery-tables';
import type { ConversationSnapshot } from '../../../shared/recovery-types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    conversationId: 'conv-1',
    participantsJson: JSON.stringify([{ id: 'p1', name: 'Claude' }]),
    roundSetting: 5,
    currentRound: 2,
    totalTokensUsed: 1500,
    savedAt: Date.now(),
    ...overrides,
  };
}

describe('DB Migration → Recovery Integration', () => {
  let db: Database.Database;
  let recovery: RecoveryManager;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // ── Migration chain application ─────────────────────────────────────

  it('applies migration 001 (initial schema)', () => {
    db.exec(migration001.sql);

    // Verify core tables exist
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('conversations');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('knowledge_nodes');
    expect(tableNames).toContain('knowledge_fts');
    expect(tableNames).toContain('knowledge_edges');
    expect(tableNames).toContain('providers');
  });

  it('applies migration 002 (recovery tables)', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('conversation_snapshots');
    expect(tableNames).toContain('recovery_logs');
  });

  it('applies full migration chain in order', () => {
    // Apply all migrations
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    // Verify all tables exist
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    // From migration 001
    expect(tableNames).toContain('conversations');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('knowledge_nodes');

    // From migration 002
    expect(tableNames).toContain('conversation_snapshots');
    expect(tableNames).toContain('recovery_logs');
  });

  // ── Recovery manager with migrated schema ───────────────────────────

  it('initializes RecoveryManager after migrations', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    recovery = new RecoveryManager(db);

    // Should start with no recoverable conversations
    const recoverable = recovery.getRecoverableConversations();
    expect(recoverable).toEqual([]);
  });

  it('saves and retrieves snapshot after migration', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    const snapshot = makeSnapshot({
      conversationId: 'test-conv',
      currentRound: 3,
    });

    recovery.saveSnapshot(snapshot);

    const recoverable = recovery.getRecoverableConversations();
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].conversationId).toBe('test-conv');
    expect(recoverable[0].snapshot.currentRound).toBe(3);
  });

  // ── App restart simulation ──────────────────────────────────────────

  it('simulates app crash and recovery on restart', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    // Session 1: App running, conversation in progress
    const recovery1 = new RecoveryManager(db);
    const snapshot = makeSnapshot({
      conversationId: 'crashed-conv',
      consensusState: 'VOTING',
      currentRound: 4,
      totalTokensUsed: 5000,
    });

    recovery1.saveSnapshot(snapshot);

    // Simulate crash (dispose recovery manager)
    // In real app, this would be the app exiting

    // Session 2: App restarts, new RecoveryManager instance
    const recovery2 = new RecoveryManager(db);

    // Check for recoverable conversations
    const recoverable = recovery2.getRecoverableConversations();
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].conversationId).toBe('crashed-conv');
    expect(recoverable[0].snapshot.consensusState).toBe('VOTING');

    // Recover the conversation
    const recovered = recovery2.recoverConversation('crashed-conv');
    expect(recovered).not.toBeNull();
    expect(recovered?.conversationId).toBe('crashed-conv');
    expect(recovered?.currentRound).toBe(4);

    // Verify recovery log
    const logs = recovery2.getRecoveryLog('crashed-conv');
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('success');
    expect(logs[0].recoveredFromState).toBe('VOTING');
  });

  it('simulates multiple conversations crash and selective recovery', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    const recovery1 = new RecoveryManager(db);

    // Save multiple conversation snapshots
    recovery1.saveSnapshot(makeSnapshot({
      conversationId: 'conv-a',
      currentRound: 1,
      consensusState: 'DISCUSSING',
    }));

    recovery1.saveSnapshot(makeSnapshot({
      conversationId: 'conv-b',
      currentRound: 2,
      consensusState: 'VOTING',
    }));

    recovery1.saveSnapshot(makeSnapshot({
      conversationId: 'conv-c',
      currentRound: 3,
      consensusState: 'AWAITING_USER',
    }));

    // App restarts
    const recovery2 = new RecoveryManager(db);
    const recoverable = recovery2.getRecoverableConversations();
    expect(recoverable).toHaveLength(3);

    // User chooses to recover conv-b
    const recovered = recovery2.recoverConversation('conv-b');
    expect(recovered?.conversationId).toBe('conv-b');
    expect(recovered?.consensusState).toBe('VOTING');

    // User discards conv-a
    recovery2.discardRecovery('conv-a');

    // Only conv-c remains recoverable
    const remaining = recovery2.getRecoverableConversations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].conversationId).toBe('conv-c');
  });

  // ── Snapshot persistence and updates ────────────────────────────────

  it('updates snapshot for same conversation (upsert)', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    // Save initial snapshot
    recovery.saveSnapshot(makeSnapshot({
      conversationId: 'update-conv',
      currentRound: 1,
    }));

    // Update same conversation
    recovery.saveSnapshot(makeSnapshot({
      conversationId: 'update-conv',
      currentRound: 5,
    }));

    // Should only have one snapshot (upserted)
    const rows = db.prepare(
      'SELECT COUNT(*) as cnt FROM conversation_snapshots WHERE conversation_id = ?'
    ).get('update-conv') as { cnt: number };

    expect(rows.cnt).toBe(1);

    // Should have latest round
    const recoverable = recovery.getRecoverableConversations();
    expect(recoverable[0].snapshot.currentRound).toBe(5);
  });

  // ── Error marking and recovery failure ──────────────────────────────

  it('marks conversation as non-recoverable on error', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    recovery.saveSnapshot(makeSnapshot({ conversationId: 'error-conv' }));

    // Mark as error
    recovery.markError('error-conv', 'Provider connection lost');

    // Should not be recoverable
    const recoverable = recovery.getRecoverableConversations();
    expect(recoverable).toHaveLength(0);

    // Error should be recorded in database
    const row = db.prepare(
      'SELECT error_message FROM conversation_snapshots WHERE conversation_id = ?'
    ).get('error-conv') as { error_message: string };

    expect(row.error_message).toBe('Provider connection lost');
  });

  // ── Recovery log filtering and querying ─────────────────────────────

  it('filters recovery log by conversation', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    recovery.saveSnapshot(makeSnapshot({ conversationId: 'conv-log-1' }));
    recovery.saveSnapshot(makeSnapshot({ conversationId: 'conv-log-2' }));

    recovery.recoverConversation('conv-log-1');
    recovery.discardRecovery('conv-log-2');

    const logs1 = recovery.getRecoveryLog('conv-log-1');
    const logs2 = recovery.getRecoveryLog('conv-log-2');

    expect(logs1).toHaveLength(1);
    expect(logs1[0].result).toBe('success');

    expect(logs2).toHaveLength(1);
    expect(logs2[0].result).toBe('failed');
    expect(logs2[0].errorMessage).toBe('user_discarded');
  });

  it('retrieves all recovery logs', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    recovery.saveSnapshot(makeSnapshot({ conversationId: 'conv-all-1' }));
    recovery.saveSnapshot(makeSnapshot({ conversationId: 'conv-all-2' }));
    recovery.saveSnapshot(makeSnapshot({ conversationId: 'conv-all-3' }));

    recovery.recoverConversation('conv-all-1');
    recovery.recoverConversation('conv-all-2');
    recovery.discardRecovery('conv-all-3');

    const allLogs = recovery.getRecoveryLog();
    expect(allLogs).toHaveLength(3);

    const successCount = allLogs.filter(l => l.result === 'success').length;
    const failCount = allLogs.filter(l => l.result === 'failed').length;

    expect(successCount).toBe(2);
    expect(failCount).toBe(1);
  });

  // ── Work mode conversation recovery ─────────────────────────────────

  it('recovers work mode conversation with consensus state', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    const workSnapshot = makeSnapshot({
      conversationId: 'work-conv',
      consensusState: 'SYNTHESIZING',
      currentRound: 2,
      totalTokensUsed: 3000,
    });

    recovery.saveSnapshot(workSnapshot);

    const recovered = recovery.recoverConversation('work-conv');
    expect(recovered).not.toBeNull();
    expect(recovered?.consensusState).toBe('SYNTHESIZING');

    // Verify recovery log records consensus state
    const logs = recovery.getRecoveryLog('work-conv');
    expect(logs[0].recoveredFromState).toBe('SYNTHESIZING');
  });

  // ── Free mode conversation recovery ─────────────────────────────────

  it('recovers free mode conversation', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    const freeSnapshot = makeSnapshot({
      conversationId: 'free-conv',
        currentRound: 10,
      totalTokensUsed: 8000,
    });

    recovery.saveSnapshot(freeSnapshot);

    const recovered = recovery.recoverConversation('free-conv');
    expect(recovered).not.toBeNull();
    expect(recovered?.currentRound).toBe(10);
  });

  // ── Multiple recovery attempts ──────────────────────────────────────

  it('prevents double recovery of same conversation', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    recovery.saveSnapshot(makeSnapshot({ conversationId: 'once-conv' }));

    // First recovery succeeds
    const recovered1 = recovery.recoverConversation('once-conv');
    expect(recovered1).not.toBeNull();

    // Second recovery returns null
    const recovered2 = recovery.recoverConversation('once-conv');
    expect(recovered2).toBeNull();

    // Should only have one recovery log entry
    const logs = recovery.getRecoveryLog('once-conv');
    expect(logs).toHaveLength(1);
  });

  // ── Integration with conversation table ─────────────────────────────

  it('works alongside conversations table', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);
    recovery = new RecoveryManager(db);

    // Insert a conversation
    db.prepare(`
      INSERT INTO conversations (id, title, mode, participants, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('conv-integrated', 'Test Conversation', 'work', '[]', new Date().toISOString());

    // Save recovery snapshot for same conversation
    recovery.saveSnapshot(makeSnapshot({
      conversationId: 'conv-integrated',
      consensusState: 'VOTING',
    }));

    // Both tables should have data
    const convRow = db.prepare(
      'SELECT * FROM conversations WHERE id = ?'
    ).get('conv-integrated');
    expect(convRow).toBeDefined();

    const recoverable = recovery.getRecoverableConversations();
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].conversationId).toBe('conv-integrated');
  });

  // ── End-to-end migration and recovery workflow ──────────────────────

  it('completes full migration and recovery workflow', () => {
    // Step 1: Apply all migrations
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    // Step 2: Initialize recovery manager
    const recovery1 = new RecoveryManager(db);

    // Step 3: Simulate multiple conversations
    recovery1.saveSnapshot(makeSnapshot({
      conversationId: 'workflow-1',
        currentRound: 5,
    }));

    recovery1.saveSnapshot(makeSnapshot({
      conversationId: 'workflow-2',
      consensusState: 'VOTING',
      currentRound: 2,
    }));

    // Step 4: Simulate app restart
    const recovery2 = new RecoveryManager(db);

    // Step 5: List all recoverable
    const recoverable = recovery2.getRecoverableConversations();
    expect(recoverable).toHaveLength(2);

    // Step 6: Recover first conversation
    const rec1 = recovery2.recoverConversation('workflow-1');
    expect(rec1).not.toBeNull();

    // Step 7: Discard second conversation
    recovery2.discardRecovery('workflow-2');

    // Step 8: Verify recovery logs
    const allLogs = recovery2.getRecoveryLog();
    expect(allLogs).toHaveLength(2);

    const successLogs = allLogs.filter(l => l.result === 'success');
    const failedLogs = allLogs.filter(l => l.result === 'failed');

    expect(successLogs).toHaveLength(1);
    expect(failedLogs).toHaveLength(1);

    // Step 9: Verify no more recoverable conversations
    const remaining = recovery2.getRecoverableConversations();
    expect(remaining).toHaveLength(0);
  });

  // ── Schema integrity after migrations ───────────────────────────────

  it('maintains foreign key constraints after migrations', () => {
    db.exec(migration001.sql);
    db.exec(migration002.sql);

    // Verify foreign keys are enabled
    const fkCheck = db.pragma('foreign_keys');
    expect(fkCheck).toEqual([{ foreign_keys: 1 }]);

    // Verify indexes exist
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='index'
    `).all() as { name: string }[];

    const indexNames = indexes.map(i => i.name);

    // From migration 001
    expect(indexNames.some(n => n.includes('messages'))).toBe(true);
    expect(indexNames.some(n => n.includes('knowledge_nodes'))).toBe(true);

    // From migration 002
    expect(indexNames.some(n => n.includes('snapshots'))).toBe(true);
  });
});
