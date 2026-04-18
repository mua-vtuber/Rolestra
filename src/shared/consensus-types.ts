/**
 * Consensus engine type definitions shared between main and renderer.
 *
 * The ConsensusStateMachine drives the work-mode conversation flow:
 *   DISCUSSING -> SYNTHESIZING -> VOTING -> AWAITING_USER -> APPLYING -> REVIEWING -> DONE
 *
 * Each transition is event-driven with guards, timeouts, and retry limits.
 */

/** Unified conversation-task flow phases from the final mode agreement. */
export type TaskModePhase =
  | 'FREE_TALK'
  | 'CONSENSUS_CHECK'
  | 'APPROVAL'
  | 'EXECUTE'
  | 'REVIEW'
  | 'FAIL_REPORT'
  | 'DONE';

/** User decision required after execute/review failure. */
export type FailureResolution = 'retry' | 'stop' | 'reassign';

/** Structured AI decision schema version. */
export type DecisionSchemaVersion = 'v1';

/** Decision values in the structured voting schema. */
export type DecisionValue = 'AGREE' | 'DISAGREE' | 'BLOCK' | 'ABSTAIN';

/** Block reason categories for structured decisions. */
export type BlockReasonType = 'security' | 'data_loss' | 'spec_conflict' | 'unknown';

/** Structured AI decision payload (v1). */
export interface AiDecisionSchemaV1 {
  decision_schema_version: DecisionSchemaVersion;
  decision: Exclude<DecisionValue, 'ABSTAIN'>;
  block_reason_type?: BlockReasonType;
  reason: string;
}

/** The seven consensus lifecycle states. */
export type ConsensusPhase =
  | 'DISCUSSING'
  | 'SYNTHESIZING'
  | 'VOTING'
  | 'AWAITING_USER'
  | 'APPLYING'
  | 'REVIEWING'
  | 'DONE'
  | 'FAILED';

/** Events that trigger state transitions. */
export type ConsensusEvent =
  | 'ROUND_DONE'
  | 'SYNTHESIS_COMPLETE'
  | 'ALL_AGREE'
  | 'DISAGREE'
  | 'USER_APPROVE'
  | 'USER_REVISE'
  | 'USER_REJECT'
  | 'USER_ABORT'
  | 'APPLY_SUCCESS'
  | 'APPLY_FAILED'
  | 'REVIEW_SUCCESS'
  | 'REVIEW_FAILED'
  | 'TIMEOUT'
  | 'ERROR';

/** Strategy for selecting who synthesizes the final proposal. */
export type AggregatorStrategy = 'designated';

/** Configuration for a consensus session. */
export interface ConsensusConfig {
  /** Maximum times voting can retry on disagreement before FAILED. */
  maxRetries: number;
  /** Per-phase timeout in milliseconds. 0 = disabled. */
  phaseTimeout: number;
  /** Strategy for choosing the aggregator/synthesizer. */
  aggregatorStrategy: AggregatorStrategy;
  /** ID of the designated aggregator (only used when strategy is 'designated'). */
  designatedAggregatorId?: string;
  /** Parse retries before assigning ABSTAIN to malformed AI decision output. */
  parseRetryLimit?: number;
  /** Maximum turns allowed while user requests deep-debate continuation. */
  deepDebateTurnBudget?: number;
}

/** A single participant's vote during the VOTING phase. */
export interface VoteRecord {
  participantId: string;
  participantName: string;
  vote: 'agree' | 'disagree' | 'block' | 'abstain';
  source?: 'human' | 'ai';
  blockReasonType?: BlockReasonType;
  comment?: string;
  timestamp: number;
}

/** Immutable snapshot of consensus state, persisted on every transition. */
export interface ConsensusSnapshot {
  phase: ConsensusPhase;
  taskPhase?: TaskModePhase;
  previousPhase: ConsensusPhase | null;
  event: ConsensusEvent | null;
  round: number;
  retryCount: number;
  proposal: string | null;
  proposalHash?: string | null;
  aggregatorId: string | null;
  votes: VoteRecord[];
  humanVote?: VoteRecord | null;
  aiVotes?: VoteRecord[];
  minValidVotes?: number;
  validVoteCount?: number;
  failureStage?: 'EXECUTE' | 'REVIEW' | null;
  timestamp: number;
  conversationId: string;
}

/** Serializable consensus info for IPC transport. */
export interface ConsensusInfo {
  phase: ConsensusPhase;
  taskPhase?: TaskModePhase;
  round: number;
  retryCount: number;
  maxRetries: number;
  proposal: string | null;
  proposalHash?: string | null;
  votes: VoteRecord[];
  humanVote?: VoteRecord | null;
  aiVotes?: VoteRecord[];
  minValidVotes?: number;
  validVoteCount?: number;
  hasHardBlock?: boolean;
  failureStage?: 'EXECUTE' | 'REVIEW' | null;
  aggregatorId: string | null;
  aggregatorStrategy: AggregatorStrategy;
  facilitatorId?: string | null;
}

/** Default consensus configuration. */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  maxRetries: 3,
  phaseTimeout: 300_000, // 5 minutes
  aggregatorStrategy: 'designated',
  parseRetryLimit: 2,
  deepDebateTurnBudget: 30,
};
