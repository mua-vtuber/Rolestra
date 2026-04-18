/**
 * Conversation recovery type definitions.
 *
 * Supports state snapshot persistence and recovery
 * on app restart (graceful or crash).
 */

// ── Conversation Snapshot ──────────────────────────────────────────

/** Serializable snapshot of a conversation's state. */
export interface ConversationSnapshot {
  conversationId: string;
  /** JSON-serialized participant list. */
  participantsJson: string;
  roundSetting: number | 'unlimited';
  currentRound: number;
  totalTokensUsed: number;

  // ── Consensus ──────────────────────────────────────────────────
  consensusState?: string;
  aggregatorStrategy?: string;
  maxRetries?: number;

  // ── Last message reference ─────────────────────────────────────
  lastMessageId?: string;
  lastMessageTime?: number;

  /** JSON-serialized message history for UI restoration. */
  messagesJson?: string;

  /** When this snapshot was saved. */
  savedAt: number;
}

// ── Recovery Data ──────────────────────────────────────────────────

/** Recovery information for a conversation. */
export interface StateRecoveryData {
  conversationId: string;
  snapshot: ConversationSnapshot;
  isRecoverable: boolean;
  lastError?: string;
}

/** Result of a recovery attempt. */
export type RecoveryResult = 'success' | 'partial' | 'failed';

/** Recovery log entry stored in DB. */
export interface RecoveryLogEntry {
  id: string;
  conversationId: string;
  recoveredAt: string;
  recoveredFromState: string;
  result: RecoveryResult;
  errorMessage?: string;
}
