/**
 * Session state machine types — shared between main and renderer.
 *
 * The SessionStateMachine replaces ConsensusStateMachine with a unified
 * 12-state lifecycle covering conversation mode, work mode, and execution.
 */

// VoteRecord, AiDecisionSchemaV1 등 투표 관련 타입은 기존 consensus-types.ts에서 재사용.
// VOTING 상태에서는 기존 AiDecisionSchemaV1 형식을 그대로 사용 (별도 투표 프로토콜 불필요).
import type { VoteRecord, AggregatorStrategy, DecisionSchemaVersion, DecisionValue, BlockReasonType } from './consensus-types';
import type { JudgmentReason } from './message-protocol-types';

// Re-export for convenience
export type { VoteRecord, AggregatorStrategy, DecisionSchemaVersion, DecisionValue, BlockReasonType };

// ── Session States ─────────────────────────────────────────────────

/** The 12 session lifecycle states. */
export type SessionState =
  | 'CONVERSATION'
  | 'MODE_TRANSITION_PENDING'
  | 'WORK_DISCUSSING'
  | 'SYNTHESIZING'
  | 'VOTING'
  | 'CONSENSUS_APPROVED'
  | 'EXECUTING'
  | 'REVIEWING'
  | 'USER_DECISION'
  | 'DONE'
  | 'FAILED'
  | 'PAUSED';

/** Events that trigger state transitions. */
export type SessionEvent =
  | 'ROUND_COMPLETE'
  | 'USER_APPROVE_MODE'
  | 'USER_REJECT_MODE'
  | 'SYNTHESIS_COMPLETE'
  | 'ALL_AGREE'
  | 'DISAGREE'
  | 'USER_SELECT_WORKER'
  | 'WORKER_DONE'
  | 'REVIEW_COMPLETE'
  | 'USER_ACCEPT'
  | 'USER_REWORK'
  | 'USER_REASSIGN'
  | 'USER_STOP'
  | 'USER_PAUSE'
  | 'USER_RESUME'
  | 'TIMEOUT'
  | 'ERROR';

// ── Mode Judgment ──────────────────────────────────────────────────

/** Mode judgment from a single AI in conversation mode. */
export interface ModeJudgment {
  participantId: string;
  participantName: string;
  judgment: 'conversation' | 'work';
  reason?: JudgmentReason;
}

// ── Permission Hooks ───────────────────────────────────────────────

/** Permission action triggered by state transition. */
export type PermissionAction =
  | { type: 'grant_worker'; workerId: string }
  | { type: 'revoke_worker'; workerId: string }
  | { type: 'revoke_all' };

// ── Snapshots ──────────────────────────────────────────────────────

/**
 * Immutable snapshot of session state, saved on every transition.
 *
 * Compared to the old ConsensusSnapshot:
 * - humanVote → subsumed into votes[] (user is a participant)
 * - failureStage → derivable from previousState at FAILED transition
 * - taskPhase → replaced by SessionState directly
 * - minValidVotes/validVoteCount → computed at evaluation time, not persisted
 */
export interface SessionSnapshot {
  state: SessionState;
  previousState: SessionState | null;
  event: SessionEvent | null;
  // Conversation mode
  conversationRound: number;
  modeJudgments: ModeJudgment[];
  // Work mode
  workRound: number;
  retryCount: number;
  proposal: string | null;
  proposalHash: string | null;
  aggregatorId: string | null;
  votes: VoteRecord[];
  // Worker
  workerId: string | null;
  // Project context
  projectPath: string | null;
  // Meta
  timestamp: number;
  conversationId: string;
}

/** Serializable session info for IPC transport. */
export interface SessionInfo {
  state: SessionState;
  projectPath: string | null;
  conversationRound: number;
  modeJudgments: ModeJudgment[];
  workRound: number;
  retryCount: number;
  maxRetries: number;
  proposal: string | null;
  proposalHash: string | null;
  votes: VoteRecord[];
  workerId: string | null;
  aggregatorId: string | null;
  aggregatorStrategy: AggregatorStrategy;
}

// ── Configuration ──────────────────────────────────────────────────

/** Configuration for the session state machine. */
export interface SessionConfig {
  /** Maximum voting retries before FAILED. */
  maxRetries: number;
  /** Per-phase timeout in milliseconds. 0 = disabled. */
  phaseTimeout: number;
  /** Strategy for choosing the aggregator/synthesizer. */
  aggregatorStrategy: AggregatorStrategy;
  /** Designated aggregator ID (only used with 'designated' strategy). */
  designatedAggregatorId?: string;
  /** Parse retries before ABSTAIN for malformed AI decisions. */
  parseRetryLimit: number;
  /** Mode transition timeout in milliseconds (MODE_TRANSITION_PENDING). */
  modeTransitionTimeout: number;
  /** Worker selection timeout in milliseconds (CONSENSUS_APPROVED). */
  workerSelectionTimeout: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxRetries: 3,
  phaseTimeout: 300_000,
  aggregatorStrategy: 'designated',
  parseRetryLimit: 2,
  modeTransitionTimeout: 60_000,
  workerSelectionTimeout: 120_000,
};
