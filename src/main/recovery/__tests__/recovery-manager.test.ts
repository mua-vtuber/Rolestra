import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RecoveryManager } from '../recovery-manager';
import migration001 from '../../database/migrations/001-initial-schema';
import migration002 from '../../database/migrations/002-recovery-tables';
import type { ConversationSnapshot } from '../../../shared/recovery-types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(migration001.sql);
  db.exec(migration002.sql);
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

describe('RecoveryManager', () => {
  let db: Database.Database;
  let manager: RecoveryManager;

  beforeEach(() => {
    db = createTestDb();
    manager = new RecoveryManager(db);
  });

  // ── saveSnapshot ─────────────────────────────────────────────────

  it('should store snapshot data correctly', () => {
    const snapshot = makeSnapshot();
    manager.saveSnapshot(snapshot);

    const row = db
      .prepare('SELECT * FROM conversation_snapshots WHERE conversation_id = ?')
      .get('conv-1') as Record<string, unknown>;

    expect(row).toBeDefined();
    expect(row['conversation_id']).toBe('conv-1');
    expect(row['is_recoverable']).toBe(1);
    expect(row['error_message']).toBeNull();

    const stored = JSON.parse(row['state_json'] as string) as ConversationSnapshot;
    expect(stored.conversationId).toBe('conv-1');
    expect(stored.currentRound).toBe(2);
    expect(stored.totalTokensUsed).toBe(1500);
  });

  it('should upsert: second save for same conversation overwrites', () => {
    const snapshot1 = makeSnapshot({ currentRound: 1 });
    manager.saveSnapshot(snapshot1);

    const snapshot2 = makeSnapshot({ currentRound: 3 });
    manager.saveSnapshot(snapshot2);

    const rows = db
      .prepare('SELECT * FROM conversation_snapshots WHERE conversation_id = ?')
      .all('conv-1');

    expect(rows).toHaveLength(1);

    const stored = JSON.parse(
      (rows[0] as Record<string, unknown>)['state_json'] as string
    ) as ConversationSnapshot;
    expect(stored.currentRound).toBe(3);
  });

  it('should store consensus_state from work mode snapshot', () => {
    const snapshot = makeSnapshot({
      consensusState: 'DISCUSSING',
    });
    manager.saveSnapshot(snapshot);

    const row = db
      .prepare('SELECT consensus_state FROM conversation_snapshots WHERE conversation_id = ?')
      .get('conv-1') as Record<string, unknown>;

    expect(row['consensus_state']).toBe('DISCUSSING');
  });

  // ── getRecoverableConversations ──────────────────────────────────

  it('should return only recoverable snapshots', () => {
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-1' }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-2' }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-3' }));

    // Mark conv-2 as not recoverable
    db.prepare(
      'UPDATE conversation_snapshots SET is_recoverable = 0 WHERE conversation_id = ?'
    ).run('conv-2');

    const recoverable = manager.getRecoverableConversations();
    expect(recoverable).toHaveLength(2);

    const ids = recoverable.map((r) => r.conversationId);
    expect(ids).toContain('conv-1');
    expect(ids).toContain('conv-3');
    expect(ids).not.toContain('conv-2');
  });

  it('should return empty array when no recoverable snapshots exist', () => {
    const result = manager.getRecoverableConversations();
    expect(result).toEqual([]);
  });

  it('should deserialize snapshot correctly in recovery data', () => {
    const snapshot = makeSnapshot({
      conversationId: 'conv-1',
      participantsJson: JSON.stringify([{ id: 'p1' }, { id: 'p2' }]),
    });
    manager.saveSnapshot(snapshot);

    const recoverable = manager.getRecoverableConversations();
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].snapshot.conversationId).toBe('conv-1');
    expect(recoverable[0].isRecoverable).toBe(true);
    expect(recoverable[0].lastError).toBeUndefined();
  });

  // ── recoverConversation ──────────────────────────────────────────

  it('should return snapshot and mark as not recoverable', () => {
    manager.saveSnapshot(makeSnapshot({ currentRound: 4 }));

    const recovered = manager.recoverConversation('conv-1');
    expect(recovered).not.toBeNull();
    expect(recovered?.currentRound).toBe(4);

    // Should no longer be recoverable
    const remaining = manager.getRecoverableConversations();
    expect(remaining).toHaveLength(0);
  });

  it('should return null for non-existent conversation', () => {
    const result = manager.recoverConversation('non-existent');
    expect(result).toBeNull();
  });

  it('should return null for already-recovered conversation', () => {
    manager.saveSnapshot(makeSnapshot());
    manager.recoverConversation('conv-1');

    const secondAttempt = manager.recoverConversation('conv-1');
    expect(secondAttempt).toBeNull();
  });

  it('should record success in recovery_logs', () => {
    manager.saveSnapshot(
      makeSnapshot({ consensusState: 'VOTING' })
    );
    manager.recoverConversation('conv-1');

    const logs = manager.getRecoveryLog('conv-1');
    expect(logs).toHaveLength(1);
    expect(logs[0].conversationId).toBe('conv-1');
    expect(logs[0].result).toBe('success');
    expect(logs[0].recoveredFromState).toBe('VOTING');
    expect(logs[0].errorMessage).toBeUndefined();
  });

  // ── discardRecovery ──────────────────────────────────────────────

  it('should mark as not recoverable with user_discarded reason', () => {
    manager.saveSnapshot(makeSnapshot());
    manager.discardRecovery('conv-1');

    // Snapshot should no longer be recoverable
    const recoverable = manager.getRecoverableConversations();
    expect(recoverable).toHaveLength(0);

    // Log should record the discard
    const logs = manager.getRecoveryLog('conv-1');
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('failed');
    expect(logs[0].errorMessage).toBe('user_discarded');
  });

  // ── markError ────────────────────────────────────────────────────

  it('should update error and mark not recoverable', () => {
    manager.saveSnapshot(makeSnapshot());
    manager.markError('conv-1', 'Provider connection lost');

    const recoverable = manager.getRecoverableConversations();
    expect(recoverable).toHaveLength(0);

    const row = db
      .prepare('SELECT * FROM conversation_snapshots WHERE conversation_id = ?')
      .get('conv-1') as Record<string, unknown>;

    expect(row['is_recoverable']).toBe(0);
    expect(row['error_message']).toBe('Provider connection lost');
  });

  // ── getRecoveryLog ───────────────────────────────────────────────

  it('should return all entries when no filter is given', () => {
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-1' }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-2' }));

    manager.recoverConversation('conv-1');
    manager.discardRecovery('conv-2');

    const allLogs = manager.getRecoveryLog();
    expect(allLogs).toHaveLength(2);
  });

  it('should filter by conversationId', () => {
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-1' }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-2' }));

    manager.recoverConversation('conv-1');
    manager.discardRecovery('conv-2');

    const logsForConv1 = manager.getRecoveryLog('conv-1');
    expect(logsForConv1).toHaveLength(1);
    expect(logsForConv1[0].result).toBe('success');

    const logsForConv2 = manager.getRecoveryLog('conv-2');
    expect(logsForConv2).toHaveLength(1);
    expect(logsForConv2[0].result).toBe('failed');
  });

  // ── Full workflow ────────────────────────────────────────────────

  it('should handle full workflow: save → recover → verify log → verify not recoverable', () => {
    // Step 1: Save a snapshot
    const snapshot = makeSnapshot({
      conversationId: 'workflow-conv',
      consensusState: 'DISCUSSING',
      currentRound: 3,
    });
    manager.saveSnapshot(snapshot);

    // Step 2: Verify it appears in recoverable list
    const recoverableBeforeRecovery = manager.getRecoverableConversations();
    expect(recoverableBeforeRecovery).toHaveLength(1);
    expect(recoverableBeforeRecovery[0].conversationId).toBe('workflow-conv');

    // Step 3: Recover
    const recovered = manager.recoverConversation('workflow-conv');
    expect(recovered).not.toBeNull();
    expect(recovered?.conversationId).toBe('workflow-conv');
    expect(recovered?.consensusState).toBe('DISCUSSING');
    expect(recovered?.currentRound).toBe(3);

    // Step 4: Verify recovery log
    const logs = manager.getRecoveryLog('workflow-conv');
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('success');
    expect(logs[0].recoveredFromState).toBe('DISCUSSING');

    // Step 5: Verify no longer recoverable
    const recoverableAfterRecovery = manager.getRecoverableConversations();
    expect(recoverableAfterRecovery).toHaveLength(0);

    // Step 6: Second recovery attempt returns null
    const secondAttempt = manager.recoverConversation('workflow-conv');
    expect(secondAttempt).toBeNull();
  });

  it('should handle multiple conversations independently', () => {
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-a', currentRound: 1 }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-b', currentRound: 2 }));
    manager.saveSnapshot(makeSnapshot({ conversationId: 'conv-c', currentRound: 3 }));

    // Recover only conv-a
    const recoveredA = manager.recoverConversation('conv-a');
    expect(recoveredA?.currentRound).toBe(1);

    // Discard conv-b
    manager.discardRecovery('conv-b');

    // conv-c should still be recoverable
    const remaining = manager.getRecoverableConversations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].conversationId).toBe('conv-c');

    // Total logs: 2 (recover + discard)
    const allLogs = manager.getRecoveryLog();
    expect(allLogs).toHaveLength(2);
  });
});
