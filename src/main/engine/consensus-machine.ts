/**
 * ConsensusStateMachine — drives work-mode conversation through
 * the seven-phase consensus lifecycle.
 *
 * State transitions:
 *   DISCUSSING  ──ROUND_DONE──>  SYNTHESIZING
 *   DISCUSSING  ──TIMEOUT────>   SYNTHESIZING
 *   SYNTHESIZING ─SYNTHESIS_COMPLETE─> VOTING
 *   SYNTHESIZING ─ERROR/TIMEOUT──>     FAILED
 *   VOTING      ──ALL_AGREE──>   AWAITING_USER
 *   VOTING      ──DISAGREE───>   DISCUSSING  (if retries < maxRetries)
 *   VOTING      ──DISAGREE───>   FAILED      (if retries >= maxRetries)
 *   VOTING      ──TIMEOUT────>   FAILED
 *   AWAITING_USER─USER_APPROVE─> APPLYING
 *   AWAITING_USER─USER_REVISE──> DISCUSSING
 *   AWAITING_USER─USER_REJECT──> FAILED
 *   APPLYING    ──APPLY_SUCCESS─> REVIEWING
 *   APPLYING    ──APPLY_FAILED──> FAILED
 *   APPLYING    ──ERROR────────> FAILED
 *   REVIEWING   ──REVIEW_SUCCESS-> DONE
 *   REVIEWING   ──REVIEW_FAILED─> FAILED
 *   REVIEWING   ──ERROR────────> FAILED
 *
 * Every transition saves an immutable ConsensusSnapshot.
 * Phase timeouts are managed externally; the machine exposes
 * handleTimeout() for the orchestrator to call.
 */

import type {
  ConsensusPhase,
  ConsensusEvent,
  ConsensusConfig,
  ConsensusSnapshot,
  ConsensusInfo,
  VoteRecord,
} from '../../shared/consensus-types';
import { DEFAULT_CONSENSUS_CONFIG } from '../../shared/consensus-types';
import type { Participant } from '../../shared/engine-types';
import { MAX_SNAPSHOTS } from '../../shared/timeouts';
import { createHash } from 'node:crypto';

/** Callback signature for phase-change listeners. */
export type PhaseChangeListener = (
  snapshot: ConsensusSnapshot,
) => void;

/** Callback signature for snapshot persistence. */
export type SnapshotPersister = (
  snapshot: ConsensusSnapshot,
) => void | Promise<void>;

/**
 * Valid transitions: Map<currentPhase, Map<event, nextPhase>>.
 *
 * DISAGREE from VOTING is handled specially (retry logic),
 * so it's not in this static table.
 */
const TRANSITIONS: ReadonlyMap<ConsensusPhase, ReadonlyMap<ConsensusEvent, ConsensusPhase>> =
  new Map([
    ['DISCUSSING', new Map<ConsensusEvent, ConsensusPhase>([
      ['ROUND_DONE', 'SYNTHESIZING'],
      ['TIMEOUT', 'SYNTHESIZING'],
      ['ERROR', 'FAILED'],
    ])],
    ['SYNTHESIZING', new Map<ConsensusEvent, ConsensusPhase>([
      ['SYNTHESIS_COMPLETE', 'VOTING'],
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['VOTING', new Map<ConsensusEvent, ConsensusPhase>([
      ['ALL_AGREE', 'AWAITING_USER'],
      // DISAGREE is handled in transition() with retry logic
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['AWAITING_USER', new Map<ConsensusEvent, ConsensusPhase>([
      ['USER_APPROVE', 'APPLYING'],
      ['USER_REVISE', 'DISCUSSING'],
      ['USER_REJECT', 'DISCUSSING'],
      ['USER_ABORT', 'FAILED'],
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['APPLYING', new Map<ConsensusEvent, ConsensusPhase>([
      ['APPLY_SUCCESS', 'REVIEWING'],
      ['APPLY_FAILED', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['REVIEWING', new Map<ConsensusEvent, ConsensusPhase>([
      ['REVIEW_SUCCESS', 'DONE'],
      ['REVIEW_FAILED', 'FAILED'],
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    // DONE and FAILED are terminal — no transitions out
  ]);

/**
 * @deprecated Use {@link SessionStateMachine} from `./session-state-machine.ts` instead.
 * This class is kept for backward compatibility during the migration period.
 * All new code should use SessionStateMachine which provides a unified 12-state
 * lifecycle covering conversation, work mode, and execution phases.
 */
export class ConsensusStateMachine {
  private static readonly MAX_SNAPSHOTS = MAX_SNAPSHOTS;

  private _phase: ConsensusPhase = 'DISCUSSING';
  private _previousPhase: ConsensusPhase | null = null;
  private _round = 1;
  private _retryCount = 0;
  private _proposal: string | null = null;
  private _proposalHash: string | null = null;
  private _aggregatorId: string | null = null;
  private _votes: VoteRecord[] = [];
  private _humanVote: VoteRecord | null = null;
  private _config: ConsensusConfig;
  private _conversationId: string;
  private _snapshots: ConsensusSnapshot[] = [];

  private _phaseListeners: PhaseChangeListener[] = [];
  private _snapshotPersister: SnapshotPersister | null = null;

  /** Timer handle for the current phase timeout. */
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** Participants available for aggregator selection. */
  private _participants: Participant[] = [];

  /** Round-robin index for aggregator selection. */

  constructor(options: {
    conversationId: string;
    participants: Participant[];
    config?: Partial<ConsensusConfig>;
  }) {
    this._conversationId = options.conversationId;
    this._participants = [...options.participants];
    this._config = { ...DEFAULT_CONSENSUS_CONFIG, ...options.config };

    // Save initial snapshot
    this.saveSnapshot(null);
  }

  // ── Read-only accessors ──────────────────────────────────────────

  get phase(): ConsensusPhase {
    return this._phase;
  }

  get round(): number {
    return this._round;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  get proposal(): string | null {
    return this._proposal;
  }

  get proposalHash(): string | null {
    return this._proposalHash;
  }

  get aggregatorId(): string | null {
    return this._aggregatorId;
  }

  get votes(): readonly VoteRecord[] {
    return this._votes;
  }

  get humanVote(): VoteRecord | null {
    return this._humanVote;
  }

  get aiVotes(): readonly VoteRecord[] {
    return this._votes.filter(v => v.source !== 'human');
  }

  get config(): Readonly<ConsensusConfig> {
    return this._config;
  }

  get snapshots(): readonly ConsensusSnapshot[] {
    return this._snapshots;
  }

  get isTerminal(): boolean {
    return this._phase === 'DONE' || this._phase === 'FAILED';
  }

  // ── Configuration ────────────────────────────────────────────────

  updateConfig(config: Partial<ConsensusConfig>): void {
    this._config = { ...this._config, ...config };
  }

  updateParticipants(participants: Participant[]): void {
    this._participants = [...participants];
  }

  /** Set the designated aggregator for the 'designated' strategy. */
  setDesignatedAggregator(id: string): void {
    this._config = {
      ...this._config,
      aggregatorStrategy: 'designated',
      designatedAggregatorId: id,
    };
  }

  // ── Event listeners ──────────────────────────────────────────────

  /** Register a listener for phase changes. Returns an unsubscribe function. */
  onPhaseChange(listener: PhaseChangeListener): () => void {
    this._phaseListeners.push(listener);
    return () => {
      this._phaseListeners = this._phaseListeners.filter(l => l !== listener);
    };
  }

  /** Set the snapshot persister (called on every transition). */
  setSnapshotPersister(persister: SnapshotPersister): void {
    this._snapshotPersister = persister;
  }

  // ── Core transition ──────────────────────────────────────────────

  /**
   * Attempt a state transition.
   *
   * @param event - The event that occurred.
   * @returns The new phase after the transition, or null if the transition is invalid.
   * @throws Error if the machine is in a terminal state.
   */
  transition(event: ConsensusEvent): ConsensusPhase | null {
    if (this.isTerminal) {
      throw new Error(
        `Cannot transition from terminal state "${this._phase}" with event "${event}"`,
      );
    }

    // Special handling for DISAGREE in VOTING phase
    if (this._phase === 'VOTING' && event === 'DISAGREE') {
      return this.handleDisagree();
    }

    const phaseTransitions = TRANSITIONS.get(this._phase);
    if (!phaseTransitions) {
      return null;
    }

    const nextPhase = phaseTransitions.get(event);
    if (nextPhase === undefined) {
      return null;
    }

    // Execute transition
    return this.moveTo(nextPhase, event);
  }

  // ── Phase-specific actions ───────────────────────────────────────

  /**
   * Set the synthesized proposal text.
   * Should be called during SYNTHESIZING phase before SYNTHESIS_COMPLETE.
   */
  setProposal(proposal: string): void {
    const nextHash = createHash('sha256').update(proposal).digest('hex');
    if (this._proposalHash && this._proposalHash !== nextHash) {
      this.invalidateVotes();
    }
    this._proposal = proposal;
    this._proposalHash = nextHash;
  }

  /**
   * Record a vote from a participant during the VOTING phase.
   */
  recordVote(record: VoteRecord): void {
    if (this._phase !== 'VOTING') {
      throw new Error(`Cannot record votes in phase "${this._phase}"`);
    }

    // Replace existing vote from same participant
    this._votes = this._votes.filter(
      v => v.participantId !== record.participantId,
    );
    this._votes.push(record);
  }

  /**
   * Check if all active AI participants have voted.
   */
  allVotesReceived(): boolean {
    const activeAiIds = this._participants
      .filter(p => p.isActive && p.id !== 'user')
      .map(p => p.id);

    return activeAiIds.every(id =>
      this._votes.some(v => v.participantId === id),
    );
  }

  /**
   * Check if all votes are "agree".
   */
  isUnanimous(): boolean {
    if (!this.allVotesReceived()) return false;
    return this._votes.every(v => v.vote === 'agree');
  }

  getValidVoteCount(): number {
    return this._votes.filter(v => v.vote !== 'abstain').length;
  }

  getMinValidVotes(): number {
    const activeAiCount = this._participants.filter(
      p => p.isActive && p.id !== 'user',
    ).length;
    return Math.ceil(activeAiCount / 2);
  }

  hasHardBlock(): boolean {
    return this._votes.some(v =>
      v.vote === 'block' && (v.blockReasonType === 'security' || v.blockReasonType === 'data_loss'),
    );
  }

  hasSoftBlock(): boolean {
    return this._votes.some(v =>
      v.vote === 'block' && (v.blockReasonType === 'spec_conflict' || v.blockReasonType === 'unknown'),
    );
  }

  invalidateVotes(): void {
    this._votes = [];
    this._humanVote = null;
  }

  setHumanVote(vote: VoteRecord): void {
    this._humanVote = vote;
    this._votes = this._votes.filter(v => v.participantId !== vote.participantId);
    this._votes.push(vote);
  }

  getTaskPhase(): import('../../shared/consensus-types').TaskModePhase {
    switch (this._phase) {
      case 'DISCUSSING':
        return 'FREE_TALK';
      case 'SYNTHESIZING':
      case 'VOTING':
        return 'CONSENSUS_CHECK';
      case 'AWAITING_USER':
        return 'APPROVAL';
      case 'APPLYING':
        return 'EXECUTE';
      case 'REVIEWING':
        return 'REVIEW';
      case 'DONE':
        return 'DONE';
      case 'FAILED':
        return 'FAIL_REPORT';
      default:
        return 'FREE_TALK';
    }
  }

  retryFromFailure(): void {
    if (this._phase !== 'FAILED') {
      throw new Error('retryFromFailure is only valid in FAILED phase');
    }
    this._previousPhase = this._phase;
    this._phase = 'DISCUSSING';
    this._proposal = null;
    this._proposalHash = null;
    this._votes = [];
    this._humanVote = null;
    this._round++;
    this.saveSnapshot('DISAGREE');
  }

  /**
   * Select the aggregator participant based on the configured strategy.
   *
   * @returns The selected participant's ID, or null if no valid candidate.
   */
  selectAggregator(): string | null {
    const activeAi = this._participants.filter(
      p => p.isActive && p.id !== 'user',
    );

    if (activeAi.length === 0) return null;

    let selectedId: string | null = null;

    if (this._config.designatedAggregatorId) {
      const found = activeAi.find(
        p => p.id === this._config.designatedAggregatorId,
      );
      selectedId = found ? found.id : activeAi[0].id;
    } else {
      selectedId = activeAi[0].id;
    }

    this._aggregatorId = selectedId;
    return selectedId;
  }

  // ── Timeout management ───────────────────────────────────────────

  /**
   * Start the phase timeout timer.
   * The orchestrator should call this after each transition.
   */
  startPhaseTimeout(): void {
    this.clearPhaseTimeout();

    if (this._config.phaseTimeout <= 0) return;
    if (this.isTerminal) return;

    this._timeoutHandle = setTimeout(() => {
      this._timeoutHandle = null;
      this.transition('TIMEOUT');
    }, this._config.phaseTimeout);
  }

  /** Clear any active phase timeout. */
  clearPhaseTimeout(): void {
    if (this._timeoutHandle !== null) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
  }

  // ── Serialization ────────────────────────────────────────────────

  /** Get serializable info for IPC transport. */
  toInfo(): ConsensusInfo {
    return {
      phase: this._phase,
      taskPhase: this.getTaskPhase(),
      round: this._round,
      retryCount: this._retryCount,
      maxRetries: this._config.maxRetries,
      proposal: this._proposal,
      proposalHash: this._proposalHash,
      votes: [...this._votes],
      humanVote: this._humanVote,
      aiVotes: this.aiVotes.slice(),
      minValidVotes: this.getMinValidVotes(),
      validVoteCount: this.getValidVoteCount(),
      hasHardBlock: this.hasHardBlock(),
      failureStage: this.getFailureStage(),
      aggregatorId: this._aggregatorId,
      aggregatorStrategy: this._config.aggregatorStrategy,
      facilitatorId: this._config.designatedAggregatorId ?? this._aggregatorId,
    };
  }

  /** Restore from a snapshot (for crash recovery). */
  restoreFromSnapshot(snapshot: ConsensusSnapshot): void {
    this._phase = snapshot.phase;
    this._previousPhase = snapshot.previousPhase;
    this._round = snapshot.round;
    this._retryCount = snapshot.retryCount;
    this._proposal = snapshot.proposal;
    this._proposalHash = snapshot.proposalHash ?? null;
    this._aggregatorId = snapshot.aggregatorId;
    this._votes = [...snapshot.votes];
    this._humanVote = snapshot.humanVote ?? null;
    this._conversationId = snapshot.conversationId;
  }

  /** Clean up timers on disposal. */
  dispose(): void {
    this.clearPhaseTimeout();
    this._phaseListeners = [];
    this._snapshotPersister = null;
  }

  // ── Private ──────────────────────────────────────────────────────

  private handleDisagree(): ConsensusPhase {
    this._retryCount++;

    if (this._retryCount >= this._config.maxRetries) {
      return this.moveTo('FAILED', 'DISAGREE');
    }

    // Go back to DISCUSSING for another round
    this._votes = [];
    this._humanVote = null;
    this._proposal = null;
    this._proposalHash = null;
    this._aggregatorId = null;
    this._round++;
    return this.moveTo('DISCUSSING', 'DISAGREE');
  }

  private moveTo(
    nextPhase: ConsensusPhase,
    event: ConsensusEvent,
  ): ConsensusPhase {
    this._previousPhase = this._phase;
    this._phase = nextPhase;

    // Clear timeout on transition
    this.clearPhaseTimeout();

    // Phase-specific resets
    if (nextPhase === 'DISCUSSING') {
      this._votes = [];
      this._humanVote = null;
      this._proposal = null;
      this._proposalHash = null;
    }
    if (nextPhase === 'VOTING') {
      this._votes = [];
    }

    // Save snapshot
    this.saveSnapshot(event);

    // Notify listeners
    const snapshot = this._snapshots[this._snapshots.length - 1];
    for (const listener of this._phaseListeners) {
      listener(snapshot);
    }

    return nextPhase;
  }

  private saveSnapshot(event: ConsensusEvent | null): void {
    const snapshot: ConsensusSnapshot = {
      phase: this._phase,
      taskPhase: this.getTaskPhase(),
      previousPhase: this._previousPhase,
      event,
      round: this._round,
      retryCount: this._retryCount,
      proposal: this._proposal,
      proposalHash: this._proposalHash,
      aggregatorId: this._aggregatorId,
      votes: [...this._votes],
      humanVote: this._humanVote,
      aiVotes: this.aiVotes.slice(),
      minValidVotes: this.getMinValidVotes(),
      validVoteCount: this.getValidVoteCount(),
      failureStage: this.getFailureStage(),
      timestamp: Date.now(),
      conversationId: this._conversationId,
    };

    this._snapshots.push(snapshot);

    // Cap snapshot array to prevent unbounded memory growth
    if (this._snapshots.length > ConsensusStateMachine.MAX_SNAPSHOTS) {
      this._snapshots.splice(0, this._snapshots.length - ConsensusStateMachine.MAX_SNAPSHOTS);
    }

    // Persist asynchronously (fire-and-forget)
    if (this._snapshotPersister) {
      void Promise.resolve(this._snapshotPersister(snapshot));
    }
  }

  getFailureStage(): 'EXECUTE' | 'REVIEW' | null {
    if (this._phase !== 'FAILED') return null;
    if (this._previousPhase === 'REVIEWING') return 'REVIEW';
    if (this._previousPhase === 'APPLYING') return 'EXECUTE';
    return null;
  }
}
