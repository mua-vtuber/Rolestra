/**
 * SessionStateMachine — drives the full session lifecycle through
 * a 12-state machine covering conversation, work mode, and execution.
 *
 * Replaces ConsensusStateMachine with a unified state graph:
 *   CONVERSATION → MODE_TRANSITION_PENDING → WORK_DISCUSSING →
 *   SYNTHESIZING → VOTING → CONSENSUS_APPROVED → EXECUTING →
 *   REVIEWING → USER_DECISION → DONE
 *
 * Permission changes are side effects of state transitions,
 * emitted via onPermissionAction listeners.
 *
 * Every transition saves an immutable SessionSnapshot.
 */

import type {
  SessionState,
  SessionEvent,
  SessionConfig,
  SessionSnapshot,
  SessionInfo,
  ModeJudgment,
  PermissionAction,
  VoteRecord,
} from '../../shared/session-state-types';
import { DEFAULT_SESSION_CONFIG } from '../../shared/session-state-types';
import type { Participant } from '../../shared/engine-types';
import type { SsmContext } from '../../shared/ssm-context-types';
import { ModeJudgmentCollector } from './mode-judgment-collector';
import { createHash } from 'node:crypto';

/** Callback signature for state-change listeners. */
export type StateChangeListener = (snapshot: SessionSnapshot) => void;

/** Callback signature for permission action listeners. */
export type PermissionActionListener = (action: PermissionAction) => void;

/** Callback signature for snapshot persistence. */
export type SnapshotPersister = (snapshot: SessionSnapshot) => void | Promise<void>;

/**
 * Valid transitions: Map<currentState, Map<event, nextState>>.
 *
 * ROUND_COMPLETE from CONVERSATION uses a guard (mode judgment majority).
 * DISAGREE from VOTING uses retry logic.
 * Both are handled in transition() before table lookup.
 */
const TRANSITIONS: ReadonlyMap<SessionState, ReadonlyMap<SessionEvent, SessionState>> =
  new Map([
    ['CONVERSATION', new Map<SessionEvent, SessionState>([
      // ROUND_COMPLETE uses guard: if majority "work" → MODE_TRANSITION_PENDING, else → CONVERSATION
      ['ROUND_COMPLETE', 'CONVERSATION'],
      ['USER_PAUSE', 'PAUSED'],
      ['ERROR', 'FAILED'],
    ])],
    ['MODE_TRANSITION_PENDING', new Map<SessionEvent, SessionState>([
      ['USER_APPROVE_MODE', 'WORK_DISCUSSING'],
      ['USER_REJECT_MODE', 'CONVERSATION'],
      ['TIMEOUT', 'CONVERSATION'],
    ])],
    ['WORK_DISCUSSING', new Map<SessionEvent, SessionState>([
      ['ROUND_COMPLETE', 'SYNTHESIZING'],
      ['TIMEOUT', 'SYNTHESIZING'],
      ['USER_PAUSE', 'PAUSED'],
      ['ERROR', 'FAILED'],
    ])],
    ['SYNTHESIZING', new Map<SessionEvent, SessionState>([
      ['SYNTHESIS_COMPLETE', 'VOTING'],
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['VOTING', new Map<SessionEvent, SessionState>([
      ['ALL_AGREE', 'CONSENSUS_APPROVED'],
      // DISAGREE handled specially (retry logic)
      ['TIMEOUT', 'FAILED'],
      ['ERROR', 'FAILED'],
    ])],
    ['CONSENSUS_APPROVED', new Map<SessionEvent, SessionState>([
      ['USER_SELECT_WORKER', 'EXECUTING'],
      ['USER_STOP', 'DONE'],
      ['TIMEOUT', 'FAILED'],
    ])],
    ['EXECUTING', new Map<SessionEvent, SessionState>([
      ['WORKER_DONE', 'REVIEWING'],
      ['ERROR', 'USER_DECISION'],
      ['TIMEOUT', 'USER_DECISION'],
    ])],
    ['REVIEWING', new Map<SessionEvent, SessionState>([
      ['REVIEW_COMPLETE', 'USER_DECISION'],
      ['ERROR', 'USER_DECISION'],
      ['TIMEOUT', 'USER_DECISION'],
    ])],
    ['USER_DECISION', new Map<SessionEvent, SessionState>([
      ['USER_ACCEPT', 'DONE'],
      ['USER_REWORK', 'EXECUTING'],
      ['USER_REASSIGN', 'CONSENSUS_APPROVED'],
      ['USER_STOP', 'DONE'],
    ])],
    ['PAUSED', new Map<SessionEvent, SessionState>([
      ['USER_RESUME', 'CONVERSATION'],
    ])],
    // DONE and FAILED are terminal — no transitions out
  ]);

export class SessionStateMachine {
  private static readonly MAX_SNAPSHOTS = 100;

  private _state: SessionState = 'CONVERSATION';
  private _previousState: SessionState | null = null;
  private _conversationRound = 0;
  private _workRound = 0;
  private _retryCount = 0;
  private _proposal: string | null = null;
  private _proposalHash: string | null = null;
  private _aggregatorId: string | null = null;
  private _votes: VoteRecord[] = [];
  private _workerId: string | null = null;
  private _projectPath: string | null;
  private _config: SessionConfig;
  private _conversationId: string;
  private _snapshots: SessionSnapshot[] = [];
  private readonly _ctx: SsmContext;

  private readonly _modeJudgmentCollector = new ModeJudgmentCollector();

  private _stateListeners: StateChangeListener[] = [];
  private _permissionListeners: PermissionActionListener[] = [];
  private _snapshotPersister: SnapshotPersister | null = null;

  /** Timer handle for the current phase timeout. */
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** Participants available for aggregator selection. */
  private _participants: Participant[] = [];

  /** Round-robin index for aggregator selection. */

  constructor(options: {
    conversationId: string;
    participants: Participant[];
    /**
     * v3 execution context — required. Carries meetingId/channelId/
     * projectId/projectPath + permission & autonomy modes. See
     * `src/shared/ssm-context-types.ts` for semantics.
     */
    ctx: SsmContext;
    projectPath?: string | null;
    config?: Partial<SessionConfig>;
  }) {
    this._conversationId = options.conversationId;
    this._participants = [...options.participants];
    this._ctx = options.ctx;
    // `projectPath` kept as a separate field because the v2 code paths
    // (tests, turn-executor legacy branches) still read
    // `machine.projectPath` directly. We source the default from the
    // ctx when the caller doesn't provide one, so the two views stay
    // consistent. Explicit `projectPath: null` wins — used in tests
    // that need to exercise the "no workspace" branch.
    this._projectPath =
      options.projectPath === undefined
        ? (options.ctx.projectPath || null)
        : options.projectPath;
    this._config = { ...DEFAULT_SESSION_CONFIG, ...options.config };

    // Save initial snapshot
    this.saveSnapshot(null);
  }

  /** v3 execution context — immutable for the life of the SSM. */
  get ctx(): SsmContext {
    return this._ctx;
  }

  // ── Read-only accessors ──────────────────────────────────────────

  get state(): SessionState {
    return this._state;
  }

  get conversationRound(): number {
    return this._conversationRound;
  }

  get workRound(): number {
    return this._workRound;
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

  get workerId(): string | null {
    return this._workerId;
  }

  get projectPath(): string | null {
    return this._projectPath;
  }

  /** Set the project path (called after workspace initialization). */
  setProjectPath(projectPath: string): void {
    this._projectPath = projectPath;
  }

  get config(): Readonly<SessionConfig> {
    return this._config;
  }

  get snapshots(): readonly SessionSnapshot[] {
    return this._snapshots;
  }

  get modeJudgments(): readonly ModeJudgment[] {
    return this._modeJudgmentCollector.judgments;
  }

  get isTerminal(): boolean {
    return this._state === 'DONE' || this._state === 'FAILED';
  }

  // ── Configuration ────────────────────────────────────────────────

  updateConfig(config: Partial<SessionConfig>): void {
    this._config = { ...this._config, ...config };
  }

  updateParticipants(participants: Participant[]): void {
    this._participants = [...participants];
  }

  // ── Event listeners ──────────────────────────────────────────────

  /** Register a listener for state changes. Returns an unsubscribe function. */
  onStateChange(listener: StateChangeListener): () => void {
    this._stateListeners.push(listener);
    return () => {
      this._stateListeners = this._stateListeners.filter(l => l !== listener);
    };
  }

  /** Register a listener for permission actions. Returns an unsubscribe function. */
  onPermissionAction(listener: PermissionActionListener): () => void {
    this._permissionListeners.push(listener);
    return () => {
      this._permissionListeners = this._permissionListeners.filter(l => l !== listener);
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
   * @returns The new state after the transition, or null if the transition is invalid.
   * @throws Error if the machine is in a terminal state.
   */
  transition(event: SessionEvent): SessionState | null {
    if (this.isTerminal) {
      throw new Error(
        `Cannot transition from terminal state "${this._state}" with event "${event}"`,
      );
    }

    // Guard: CONVERSATION + ROUND_COMPLETE → check mode judgments
    if (this._state === 'CONVERSATION' && event === 'ROUND_COMPLETE') {
      return this.handleConversationRoundComplete();
    }

    // Special: VOTING + DISAGREE → retry logic
    if (this._state === 'VOTING' && event === 'DISAGREE') {
      return this.handleDisagree();
    }

    const stateTransitions = TRANSITIONS.get(this._state);
    if (!stateTransitions) {
      return null;
    }

    const nextState = stateTransitions.get(event);
    if (nextState === undefined) {
      return null;
    }

    return this.moveTo(nextState, event);
  }

  // ── Phase-specific actions ───────────────────────────────────────

  /** Record a mode judgment from an AI participant in conversation mode. */
  recordModeJudgment(judgment: ModeJudgment): void {
    this._modeJudgmentCollector.record(judgment);
  }

  /** Set the designated worker AI for execution. */
  setWorkerId(id: string): void {
    this._workerId = id;
  }

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
    if (this._state !== 'VOTING') {
      throw new Error(`Cannot record votes in state "${this._state}"`);
    }
    // Replace existing vote from same participant
    this._votes = this._votes.filter(
      v => v.participantId !== record.participantId,
    );
    this._votes.push(record);
  }

  /** Check if all active AI participants have voted. */
  allVotesReceived(): boolean {
    const activeAiIds = this._participants
      .filter(p => p.isActive && p.id !== 'user')
      .map(p => p.id);
    return activeAiIds.every(id =>
      this._votes.some(v => v.participantId === id),
    );
  }

  /** Check if all votes are "agree". */
  isUnanimous(): boolean {
    if (!this.allVotesReceived()) return false;
    return this._votes.every(v => v.vote === 'agree');
  }

  hasHardBlock(): boolean {
    return this._votes.some(v =>
      v.vote === 'block' && (v.blockReasonType === 'security' || v.blockReasonType === 'data_loss'),
    );
  }

  invalidateVotes(): void {
    this._votes = [];
  }

  /**
   * Select the aggregator participant based on the configured strategy.
   */
  selectAggregator(): string | null {
    const activeAi = this._participants.filter(
      p => p.isActive && p.id !== 'user',
    );
    if (activeAi.length === 0) return null;

    let selectedId: string | null = null;

    if (this._config.designatedAggregatorId) {
      const found = activeAi.find(p => p.id === this._config.designatedAggregatorId);
      selectedId = found ? found.id : activeAi[0].id;
    } else {
      selectedId = activeAi[0].id;
    }

    this._aggregatorId = selectedId;
    return selectedId;
  }

  // ── Timeout management ───────────────────────────────────────────

  /** Start the phase timeout timer. */
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
  toInfo(): SessionInfo {
    return {
      state: this._state,
      projectPath: this._projectPath,
      conversationRound: this._conversationRound,
      modeJudgments: [...this._modeJudgmentCollector.judgments],
      workRound: this._workRound,
      retryCount: this._retryCount,
      maxRetries: this._config.maxRetries,
      proposal: this._proposal,
      proposalHash: this._proposalHash,
      votes: [...this._votes],
      workerId: this._workerId,
      aggregatorId: this._aggregatorId,
      aggregatorStrategy: this._config.aggregatorStrategy,
    };
  }

  /** Restore from a snapshot (for crash recovery). */
  restoreFromSnapshot(snapshot: SessionSnapshot): void {
    this._state = snapshot.state;
    this._previousState = snapshot.previousState;
    this._conversationRound = snapshot.conversationRound;
    this._workRound = snapshot.workRound;
    this._retryCount = snapshot.retryCount;
    this._proposal = snapshot.proposal;
    this._proposalHash = snapshot.proposalHash;
    this._aggregatorId = snapshot.aggregatorId;
    this._votes = [...snapshot.votes];
    this._workerId = snapshot.workerId;
    this._projectPath = snapshot.projectPath;
    this._conversationId = snapshot.conversationId;
  }

  /** Clean up timers and listeners on disposal. */
  dispose(): void {
    this.clearPhaseTimeout();
    this._stateListeners = [];
    this._permissionListeners = [];
    this._snapshotPersister = null;
  }

  // ── Private ──────────────────────────────────────────────────────

  private handleConversationRoundComplete(): SessionState {
    this._conversationRound++;

    if (this._modeJudgmentCollector.hasMajorityWork()) {
      return this.moveTo('MODE_TRANSITION_PENDING', 'ROUND_COMPLETE');
    }

    // Stay in CONVERSATION, reset judgments for next round
    this._modeJudgmentCollector.reset();
    return this.moveTo('CONVERSATION', 'ROUND_COMPLETE');
  }

  private handleDisagree(): SessionState {
    this._retryCount++;

    if (this._retryCount >= this._config.maxRetries) {
      return this.moveTo('FAILED', 'DISAGREE');
    }

    // Go back to WORK_DISCUSSING for another round
    this._votes = [];
    this._proposal = null;
    this._proposalHash = null;
    this._aggregatorId = null;
    this._workRound++;
    return this.moveTo('WORK_DISCUSSING', 'DISAGREE');
  }

  private moveTo(
    nextState: SessionState,
    event: SessionEvent,
  ): SessionState {
    const previousState = this._state;
    this._previousState = previousState;
    this._state = nextState;

    // Clear timeout on transition
    this.clearPhaseTimeout();

    // State-specific resets
    if (nextState === 'WORK_DISCUSSING' && previousState === 'MODE_TRANSITION_PENDING') {
      this._modeJudgmentCollector.reset();
    }
    if (nextState === 'VOTING') {
      this._votes = [];
    }

    // Permission side effects
    this.emitPermissionSideEffects(previousState, nextState, event);

    // Save snapshot
    this.saveSnapshot(event);

    // Notify state listeners
    const snapshot = this._snapshots[this._snapshots.length - 1];
    for (const listener of this._stateListeners) {
      listener(snapshot);
    }

    return nextState;
  }

  private emitPermissionSideEffects(
    previousState: SessionState,
    nextState: SessionState,
    event: SessionEvent,
  ): void {
    // Grant worker on CONSENSUS_APPROVED → EXECUTING
    if (previousState === 'CONSENSUS_APPROVED' && nextState === 'EXECUTING' && this._workerId) {
      this.emitPermissionAction({ type: 'grant_worker', workerId: this._workerId });
    }

    // Revoke worker on EXECUTING → REVIEWING
    if (previousState === 'EXECUTING' && nextState === 'REVIEWING' && this._workerId) {
      this.emitPermissionAction({ type: 'revoke_worker', workerId: this._workerId });
    }

    // Re-grant worker on USER_REWORK
    if (event === 'USER_REWORK' && this._workerId) {
      this.emitPermissionAction({ type: 'grant_worker', workerId: this._workerId });
    }

    // Revoke old worker on USER_REASSIGN
    if (event === 'USER_REASSIGN') {
      const oldWorker = this._workerId;
      this._workerId = null;
      if (oldWorker) {
        this.emitPermissionAction({ type: 'revoke_worker', workerId: oldWorker });
      }
    }

    // Revoke all on terminal state from work mode
    if ((nextState === 'DONE' || nextState === 'FAILED') && previousState !== 'CONVERSATION') {
      this.emitPermissionAction({ type: 'revoke_all' });
    }
  }

  private emitPermissionAction(action: PermissionAction): void {
    for (const listener of this._permissionListeners) {
      listener(action);
    }
  }

  private saveSnapshot(event: SessionEvent | null): void {
    const snapshot: SessionSnapshot = {
      state: this._state,
      previousState: this._previousState,
      event,
      conversationRound: this._conversationRound,
      modeJudgments: [...this._modeJudgmentCollector.judgments],
      workRound: this._workRound,
      retryCount: this._retryCount,
      proposal: this._proposal,
      proposalHash: this._proposalHash,
      aggregatorId: this._aggregatorId,
      votes: [...this._votes],
      workerId: this._workerId,
      projectPath: this._projectPath,
      timestamp: Date.now(),
      conversationId: this._conversationId,
    };

    this._snapshots.push(snapshot);

    // Cap snapshot array to prevent unbounded memory growth
    if (this._snapshots.length > SessionStateMachine.MAX_SNAPSHOTS) {
      this._snapshots.splice(0, this._snapshots.length - SessionStateMachine.MAX_SNAPSHOTS);
    }

    // Persist asynchronously (fire-and-forget)
    if (this._snapshotPersister) {
      void Promise.resolve(this._snapshotPersister(snapshot));
    }
  }
}
