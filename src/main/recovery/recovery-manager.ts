/**
 * Recovery manager for conversation state persistence and restoration.
 *
 * Handles saving conversation snapshots to SQLite, querying recoverable
 * conversations, performing recovery, and maintaining an audit log.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ConversationSnapshot,
  StateRecoveryData,
  RecoveryLogEntry,
} from '../../shared/recovery-types';

/** Raw row shape returned from the conversation_snapshots table. */
interface SnapshotRow {
  id: string;
  conversation_id: string;
  state_json: string;
  consensus_state: string | null;
  saved_at: string;
  is_recoverable: number;
  error_message: string | null;
}

/** Raw row shape returned from the recovery_logs table. */
interface RecoveryLogRow {
  id: string;
  conversation_id: string;
  recovered_at: string;
  recovered_from_state: string | null;
  result: string;
  error_message: string | null;
}

export class RecoveryManager {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Saves (upserts) a conversation snapshot.
   *
   * If a snapshot already exists for the same conversation_id,
   * it is replaced entirely (INSERT OR REPLACE on the unique index).
   */
  saveSnapshot(snapshot: ConversationSnapshot): void {
    const id = randomUUID();
    const stateJson = JSON.stringify(snapshot);
    const consensusState = snapshot.consensusState ?? null;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO conversation_snapshots
           (id, conversation_id, state_json, consensus_state, saved_at, is_recoverable, error_message)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1, NULL)`
      )
      .run(id, snapshot.conversationId, stateJson, consensusState);
  }

  /**
   * Returns all conversations that can be recovered.
   */
  getRecoverableConversations(): StateRecoveryData[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_snapshots WHERE is_recoverable = 1`
      )
      .all() as SnapshotRow[];

    return rows.map((row) => ({
      conversationId: row.conversation_id,
      snapshot: JSON.parse(row.state_json) as ConversationSnapshot,
      isRecoverable: row.is_recoverable === 1,
      lastError: row.error_message ?? undefined,
    }));
  }

  /**
   * Recovers a conversation by its ID.
   *
   * Returns the snapshot and records success in the recovery log.
   * Marks the snapshot as no longer recoverable so it is not offered again.
   *
   * Returns `null` if no recoverable snapshot exists for the given ID.
   */
  recoverConversation(conversationId: string): ConversationSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT * FROM conversation_snapshots
         WHERE conversation_id = ? AND is_recoverable = 1`
      )
      .get(conversationId) as SnapshotRow | undefined;

    if (!row) {
      return null;
    }

    const snapshot = JSON.parse(row.state_json) as ConversationSnapshot;

    // Mark as no longer recoverable
    this.db
      .prepare(
        `UPDATE conversation_snapshots
         SET is_recoverable = 0
         WHERE conversation_id = ?`
      )
      .run(conversationId);

    // Record in recovery log
    this.db
      .prepare(
        `INSERT INTO recovery_logs
           (id, conversation_id, recovered_at, recovered_from_state, result, error_message)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'success', NULL)`
      )
      .run(randomUUID(), conversationId, row.consensus_state);

    return snapshot;
  }

  /**
   * Discards a recovery opportunity for a conversation.
   *
   * Marks the snapshot as not recoverable and logs the discard
   * with result 'failed' and reason 'user_discarded'.
   */
  discardRecovery(conversationId: string): void {
    this.db
      .prepare(
        `UPDATE conversation_snapshots
         SET is_recoverable = 0
         WHERE conversation_id = ?`
      )
      .run(conversationId);

    this.db
      .prepare(
        `INSERT INTO recovery_logs
           (id, conversation_id, recovered_at, recovered_from_state, result, error_message)
         VALUES (?, ?, CURRENT_TIMESTAMP, NULL, 'failed', 'user_discarded')`
      )
      .run(randomUUID(), conversationId);
  }

  /**
   * Marks a conversation snapshot as errored and not recoverable.
   */
  markError(conversationId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE conversation_snapshots
         SET is_recoverable = 0, error_message = ?
         WHERE conversation_id = ?`
      )
      .run(error, conversationId);
  }

  /**
   * Returns recovery log entries, optionally filtered by conversation ID.
   */
  getRecoveryLog(conversationId?: string): RecoveryLogEntry[] {
    let rows: RecoveryLogRow[];

    if (conversationId) {
      rows = this.db
        .prepare(`SELECT * FROM recovery_logs WHERE conversation_id = ?`)
        .all(conversationId) as RecoveryLogRow[];
    } else {
      rows = this.db
        .prepare(`SELECT * FROM recovery_logs`)
        .all() as RecoveryLogRow[];
    }

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      recoveredAt: row.recovered_at,
      recoveredFromState: row.recovered_from_state ?? '',
      result: row.result as RecoveryLogEntry['result'],
      errorMessage: row.error_message ?? undefined,
    }));
  }
}
