// @ts-nocheck — R6-Task10: v2 orchestrator is @deprecated; R11 deletes the
// file outright. Drift against the evolved SSM/PermissionService types
// produces ~3 errors that aren't worth surgically fixing.

/**
 * @deprecated R6-Task7 — replaced by `src/main/meetings/engine/meeting-orchestrator.ts`.
 *   New callers MUST use `MeetingOrchestrator`. This file remains only
 *   until R11 deletes the v2 engine en bloc (chat-handler still holds
 *   the last live import).
 *
 * Conversation Orchestrator -- the main AI turn loop.
 *
 * Thin coordinator that delegates to focused sub-modules:
 * - TurnExecutor:          single-turn streaming, DB persistence, deep debate
 * - MemoryCoordinator:     memory retrieval, extraction, maintenance
 * - ConsensusDriver:       consensus rounds, voting, document generation
 * - ExecutionCoordinator:  patch extraction, approval, apply/review
 *
 * Coordinates the flow:
 * 1. User sends message -> chat:send
 * 2. Orchestrator starts -> session.start()
 * 3. Loop: get next speaker -> call provider.streamCompletion() -> push tokens -> next turn
 * 4. Between turns: 2-second delay (configurable)
 * 5. Round checks -> stop when done
 *
 * Pushes events to the renderer via webContents.send():
 * - stream:token           -- individual tokens
 * - stream:message-start   -- new AI message begins
 * - stream:message-done    -- AI message complete
 * - stream:state           -- conversation state changes
 * - stream:error           -- errors during generation
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as path from 'node:path';
import type { WebContents } from 'electron';
import type { StreamEventName, StreamEventMap } from '../../shared/stream-types';
import { ConversationSession } from './conversation';
import type { MemoryFacade } from '../memory/facade';
import { TurnExecutor } from './turn-executor';
import { MemoryCoordinator } from './memory-coordinator';
import { ConsensusDriver } from './consensus-driver';
import { ExecutionCoordinator, type OrchestratorDeps } from './execution-coordinator';
import { consensusFolderService } from '../ipc/handlers/workspace-handler';

// Re-export OrchestratorDeps for backward compatibility with consumers
// that import it from './orchestrator' (e.g. chat-handler).
export type { OrchestratorDeps } from './execution-coordinator';

const INTER_TURN_DELAY_MS = 2000;

export class ConversationOrchestrator {
  private session: ConversationSession;
  private webContents: WebContents;
  private running = false;
  private _loopRunning = false;
  private abortController: AbortController | null = null;
  private personaPrimedParticipants = new Set<string>();

  /** Resolver for the arena loop's user-action waiter. */
  private _resumeResolve: (() => void) | null = null;

  /**
   * Full path to the work summary document written by the worker in the last
   * EXECUTING phase. Cleared at the start of each execution phase and passed
   * to reviewers at the start of the REVIEWING phase.
   */
  private lastWorkerSummaryFilePath: string | null = null;

  // Sub-modules
  private turnExecutor: TurnExecutor;
  private memoryCoordinator: MemoryCoordinator;
  private consensusDriver: ConsensusDriver;
  private executionCoordinator: ExecutionCoordinator;

  constructor(
    session: ConversationSession,
    webContents: WebContents,
    memoryFacade?: MemoryFacade | null,
    deps?: OrchestratorDeps,
  ) {
    this.session = session;
    this.webContents = webContents;

    // Initialize sub-modules
    this.memoryCoordinator = new MemoryCoordinator(session, memoryFacade ?? null);
    this.consensusDriver = new ConsensusDriver(session, webContents);
    this.executionCoordinator = new ExecutionCoordinator(
      session,
      webContents,
      deps ?? {},
      this.consensusDriver,
    );
    this.turnExecutor = new TurnExecutor(
      session,
      webContents,
      this.memoryCoordinator,
      this.personaPrimedParticipants,
    );
  }

  /** Shorthand accessor for the session's SSM. */
  private get sessionMachine() {
    return this.session.sessionMachine;
  }

  /** User-input-required SSM states that break the loop. */
  private static readonly WAIT_STATES = new Set([
    'MODE_TRANSITION_PENDING',
    'CONSENSUS_APPROVED',
    'USER_DECISION',
    'DONE',
    'FAILED',
    'PAUSED',
  ]);

  /** Start the conversation loop. Call after user sends the first message. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.session.start();
    this.emit('stream:state', {
      conversationId: this.session.id,
      state: 'running',
      currentRound: this.session.turnManager.currentRound,
    });

    try {
      if (this.sessionMachine) {
        // Arena mode: loop ↔ waitForUserAction cycle until terminal.
        await this.runArenaLoop();
      } else {
        // 1:1 or legacy: single loop.
        await this.loop();
      }
    } finally {
      this.running = false;
      this.consensusDriver.cleanupPhaseListener();

      // Natural completion should return to idle (waiting for the next user input),
      // while explicit user stop should remain stopped.
      if (this.session.state === 'running') {
        this.session.turnManager.reset();
      }
      this.emit('stream:state', {
        conversationId: this.session.id,
        state: this.session.state,
        currentRound: this.session.turnManager.currentRound,
      });

      // Save recovery snapshot (fire-and-forget)
      void this.saveRecoverySnapshot();

      // Post-conversation Phase 3-b maintenance (fire-and-forget)
      void this.memoryCoordinator.runPostConversationMaintenance();
    }
  }

  /** Stop the orchestrator and cancel any in-flight request. */
  stop(): void {
    this.turnExecutor.abort();
    this.abortController?.abort();
    this.abortController = null;
    this.session.stop();
    this.running = false;
    // Release the consensus waiter if active
    this.consensusDriver.releaseWaiter();
    this.consensusDriver.cleanupPhaseListener();
    // Resolve any pending execution approval as rejected (fix 4.1)
    this.executionCoordinator.resolveExecutionApproval(false);
    // Release arena waiter if active
    this.resumeFromUserAction();
  }

  /** Pause the orchestrator. The current turn finishes, then no new turns start. */
  pause(): void {
    this.session.pause();
    this.emit('stream:state', {
      conversationId: this.session.id,
      state: 'paused',
      currentRound: this.session.turnManager.currentRound,
    });
  }

  /** Resume a paused orchestrator. */
  resume(): void {
    this.session.resume();
    this.emit('stream:state', {
      conversationId: this.session.id,
      state: 'running',
      currentRound: this.session.turnManager.currentRound,
    });
  }

  /** Notify orchestrator that a user message was interjected. */
  handleUserInterjection(): void {
    this.session.interruptWithUserMessage();
    // If the arena loop is currently waiting for a user action (after a round completion),
    // wake it so the next round can begin and AIs can see the interjected message.
    this.resumeFromUserAction();
  }

  /**
   * Wake the arena loop from a user-action wait state.
   * Called from chat-handler when the user clicks "continue" after a round pause.
   * Safe to call when not in wait state — no-op if _resumeResolve is null.
   */
  wakeFromUserAction(): void {
    this.resumeFromUserAction();
  }

  /**
   * Called by the execution handler when user approves/rejects a pending execution.
   * Delegates to ExecutionCoordinator.
   */
  resolveExecutionApproval(approved: boolean): void {
    this.executionCoordinator.resolveExecutionApproval(approved);
  }

  // -- Arena loop (SSM mode) --------------------------------------------

  /**
   * Arena mode main loop.
   * Alternates between loop() and waitForUserAction() until SSM reaches
   * a terminal state (DONE/FAILED) or the session is stopped.
   */
  private async runArenaLoop(): Promise<void> {
    while (!this.sessionMachine!.isTerminal && this.session.state !== 'stopped') {
      await this.loop();

      if (this.sessionMachine!.isTerminal || this.session.state === 'stopped') break;

      this.emitSessionUpdate();

      if (this.sessionMachine!.state === 'CONSENSUS_APPROVED') {
        this.emitWorkerSelectionRequest();
      }

      // Signal renderer to show idle state while waiting for user action.
      // Without this, the renderer remains in 'running' state (sending=true),
      // which shows ThinkingIndicator and hides the mode-transition dialog buttons.
      this.emit('stream:state', {
        conversationId: this.session.id,
        state: 'idle',
        currentRound: this.session.turnManager.currentRound,
      });

      await this.waitForUserAction();

      if (this.sessionMachine!.isTerminal || this.session.state === 'stopped') break;

      // Prepare for next loop iteration and re-signal running state.
      this.session.turnManager.reset();
      this.session.start();
      this.emit('stream:state', {
        conversationId: this.session.id,
        state: 'running',
        currentRound: this.session.turnManager.currentRound,
      });
    }
  }

  /** Block until a user event handler calls resumeFromUserAction(). */
  private waitForUserAction(): Promise<void> {
    return new Promise<void>((resolve) => {
      this._resumeResolve = resolve;
    });
  }

  /** Wake up runArenaLoop() after a user event. */
  private resumeFromUserAction(): void {
    if (this._resumeResolve) {
      const resolve = this._resumeResolve;
      this._resumeResolve = null;
      resolve();
    }
  }

  // -- Main loop -------------------------------------------------------

  private async loop(): Promise<void> {
    if (this._loopRunning) return;
    this._loopRunning = true;
    this.abortController = new AbortController();
    try {
      while (this.session.state !== 'stopped' && !this.session.isComplete()) {
        if (this.session.state === 'paused') {
          await this.delay(500);
          continue;
        }
        if (this.session.state !== 'running') break;

        // No SSM → legacy 1:1 turn
        if (!this.sessionMachine) {
          await this.runLegacyTurn();
          continue;
        }

        // Arena: SSM state-based dispatch
        const ssmState = this.sessionMachine.state;

        let roundEnded = false;

        switch (ssmState) {
          case 'CONVERSATION':
            roundEnded = await this.runConversationRound();
            break;
          case 'WORK_DISCUSSING':
            await this.runWorkDiscussionRound();
            break;
          case 'SYNTHESIZING':
            await this.runSynthesisPhase();
            break;
          case 'VOTING':
            await this.consensusDriver.collectVotesForSession();
            break;
          case 'EXECUTING':
            await this.runExecutionPhase();
            break;
          case 'REVIEWING':
            await this.runReviewPhase();
            break;
          default:
            // MODE_TRANSITION_PENDING, CONSENSUS_APPROVED, USER_DECISION, DONE, FAILED, PAUSED
            break;
        }

        // User-input-required states → break out
        if (ConversationOrchestrator.WAIT_STATES.has(this.sessionMachine.state)) {
          break;
        }

        // Round ended without state transition → wait for next user message
        if (roundEnded) break;

        // Inter-turn delay
        if (this.session.state === 'running' && !this.session.isComplete()) {
          this.emit('stream:turn-wait', {
            conversationId: this.session.id,
            nextParticipantId: '',
            nextParticipantName: '',
            delayMs: INTER_TURN_DELAY_MS,
          });
          await this.delay(INTER_TURN_DELAY_MS, this.abortController?.signal);
        }
      }
    } finally {
      this._loopRunning = false;
      this.abortController = null;
    }
  }

  // -- SSM turn methods --------------------------------------------------

  /** Legacy 1:1 turn (no SSM). */
  private async runLegacyTurn(): Promise<void> {
    const speaker = this.session.getNextSpeaker();
    if (!speaker) return;
    await this.turnExecutor.executeTurn(speaker);
    if (this.session.state === 'running' && !this.session.isComplete()) {
      this.emit('stream:turn-wait', {
        conversationId: this.session.id,
        nextParticipantId: '',
        nextParticipantName: '',
        delayMs: INTER_TURN_DELAY_MS,
      });
      await this.delay(INTER_TURN_DELAY_MS, this.abortController?.signal);
    }
  }

  /** CONVERSATION: round-robin speakers → ROUND_COMPLETE on round end.
   *  Returns true when the round ended (no more speakers). */
  private async runConversationRound(): Promise<boolean> {
    const speaker = this.session.getNextSpeaker();
    if (!speaker) {
      const newState = this.sessionMachine!.transition('ROUND_COMPLETE');
      this.emitSessionUpdate();
      if (newState === 'MODE_TRANSITION_PENDING') {
        this.emit('stream:mode-transition-request', {
          conversationId: this.session.id,
          judgments: [...this.sessionMachine!.modeJudgments],
        });
      }
      return true;
    }
    await this.turnExecutor.executeTurn(speaker);
    return false;
  }

  /** WORK_DISCUSSING: discussion round → SYNTHESIZING on round end. */
  private async runWorkDiscussionRound(): Promise<void> {
    const speaker = this.session.getNextSpeaker();
    if (!speaker) {
      this.sessionMachine!.transition('ROUND_COMPLETE');
      this.emitSessionUpdate();
      return;
    }
    await this.turnExecutor.executeTurn(speaker);
  }

  /** SYNTHESIZING: aggregator-only synthesis turn. */
  private async runSynthesisPhase(): Promise<void> {
    const aggregatorId = this.sessionMachine!.selectAggregator();
    const aggregator = this.session.participants.find(p => p.id === aggregatorId);
    if (!aggregator) {
      this.sessionMachine!.transition('ERROR');
      return;
    }
    await this.turnExecutor.executeSynthesisTurn(aggregator);
    this.sessionMachine!.transition('SYNTHESIS_COMPLETE');
    this.emitSessionUpdate();
  }

  /**
   * EXECUTING: worker-only execution turn.
   *
   * After the turn completes, the worker's summary filename is captured from
   * TurnExecutor and stored as a full path so REVIEWING can pass it to reviewers.
   */
  private async runExecutionPhase(): Promise<void> {
    const workerId = this.sessionMachine!.workerId;
    if (!workerId) {
      this.sessionMachine!.transition('ERROR');
      return;
    }
    const worker = this.session.participants.find(p => p.id === workerId);
    if (!worker) {
      this.sessionMachine!.transition('ERROR');
      return;
    }

    // Clear any stale path from a previous execution phase
    this.lastWorkerSummaryFilePath = null;

    await this.turnExecutor.executeWorkerTurn(worker);

    // Capture the summary file path for use in REVIEWING
    const summaryFileName = this.turnExecutor.lastWorkerSummaryFileName;
    if (summaryFileName) {
      const consensusFolder = consensusFolderService.getFolderPath();
      if (consensusFolder) {
        this.lastWorkerSummaryFilePath = path.join(consensusFolder, summaryFileName);
      }
    }

    this.sessionMachine!.transition('WORKER_DONE');
    this.emitSessionUpdate();
  }

  /**
   * REVIEWING: all AI except worker get review turns.
   *
   * The work summary file path (set during EXECUTING) is passed to
   * MessageFormatter so reviewers are directed to read the document.
   */
  private async runReviewPhase(): Promise<void> {
    const workerId = this.sessionMachine!.workerId;
    const reviewers = this.session.participants.filter(
      p => p.isActive && p.id !== 'user' && p.id !== workerId,
    );

    // Inject the summary file path into the review format instruction.
    // TurnExecutor reads it via getFormatInstruction, but REVIEWING state
    // does not call buildExecutionFormatInstruction — we pass the path
    // directly by temporarily setting it on the formatter through the
    // getFormatInstruction override below.
    const summaryFilePath = this.lastWorkerSummaryFilePath ?? undefined;

    for (const reviewer of reviewers) {
      // Override getFormatInstruction for this turn to include the summary path.
      const originalGetFormatInstruction = this.turnExecutor.getFormatInstruction.bind(
        this.turnExecutor,
      );
      this.turnExecutor.getFormatInstruction = (state, selfName, otherNames) => {
        if (state === 'REVIEWING') {
          return this.turnExecutor['messageFormatter'].buildReviewFormatInstruction(
            selfName,
            summaryFilePath,
          );
        }
        return originalGetFormatInstruction(state, selfName, otherNames);
      };

      await this.turnExecutor.executeReviewTurn(reviewer);

      // Restore original implementation after each reviewer turn
      this.turnExecutor.getFormatInstruction = originalGetFormatInstruction;

      if (this.session.state !== 'running') break;
    }
    this.sessionMachine!.transition('REVIEW_COMPLETE');
    this.emitSessionUpdate();
    this.emit('stream:review-request', {
      conversationId: this.session.id,
      session: this.sessionMachine!.toInfo(),
    });
  }

  // -- User event handlers (called from IPC) ----------------------------

  /** User responds to mode transition popup. */
  async handleModeTransitionResponse(approved: boolean): Promise<void> {
    if (!this.sessionMachine) return;
    this.sessionMachine.transition(approved ? 'USER_APPROVE_MODE' : 'USER_REJECT_MODE');
    this.emitSessionUpdate();
    this.resumeFromUserAction();
  }

  /** User selects a worker after consensus approval. */
  async handleWorkerSelection(workerId: string): Promise<void> {
    if (!this.sessionMachine) return;
    this.sessionMachine.setWorkerId(workerId);
    this.sessionMachine.transition('USER_SELECT_WORKER');
    this.emitSessionUpdate();
    this.resumeFromUserAction();
  }

  /** User decides after review (accept/rework/reassign/stop). */
  async handleUserDecision(
    decision: 'accept' | 'rework' | 'reassign' | 'stop',
    reassignWorkerId?: string,
  ): Promise<void> {
    if (!this.sessionMachine) return;
    const eventMap = {
      accept: 'USER_ACCEPT' as const,
      rework: 'USER_REWORK' as const,
      reassign: 'USER_REASSIGN' as const,
      stop: 'USER_STOP' as const,
    };
    if (decision === 'reassign' && reassignWorkerId) {
      this.sessionMachine.setWorkerId(reassignWorkerId);
    }
    this.sessionMachine.transition(eventMap[decision]);
    this.emitSessionUpdate();
    this.resumeFromUserAction();
  }

  /**
   * Re-enter the discussion loop after a retry or user revision.
   * Resets the turn manager and runs the loop again.
   */
  private async reenterLoop(): Promise<void> {
    if (!this.running || this._loopRunning) return;

    this.session.turnManager.reset();
    if (this.session.state === 'stopped') {
      this.session.start();
    } else if (this.session.state !== 'running') {
      this.session.resume();
    }

    this.emit('stream:state', {
      conversationId: this.session.id,
      state: 'running',
      currentRound: this.session.turnManager.currentRound,
    });

    await this.loop();
  }

  // -- Recovery ---------------------------------------------------------

  /**
   * Save a recovery snapshot of the current conversation state.
   * Non-fatal: failures are logged but do not interrupt the flow.
   */
  private async saveRecoverySnapshot(): Promise<void> {
    try {
      const { getDatabase } = await import('../database/connection');
      const { RecoveryManager } = await import('../recovery/recovery-manager');
      const db = getDatabase();
      const recovery = new RecoveryManager(db);

      const messagesJson = JSON.stringify(
        this.session.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          participantId: m.participantId,
          participantName: m.participantName,
          branchId: m.branchId,
        })),
      );

      const participantsJson = JSON.stringify(
        this.session.participants.map((p) => ({
          id: p.id,
          displayName: p.displayName,
        })),
      );

      recovery.saveSnapshot({
        conversationId: this.session.id,
        participantsJson,
        roundSetting: this.session.turnManager.roundSetting,
        currentRound: this.session.turnManager.currentRound,
        totalTokensUsed: 0,
        consensusState: this.sessionMachine?.state ?? undefined,
        messagesJson,
        savedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[orchestrator:${this.session.id}] snapshot save error:`, err);
    }
  }

  // -- Helpers ----------------------------------------------------------

  /** Push SSM state update to the renderer. */
  private emitSessionUpdate(): void {
    if (!this.sessionMachine) return;
    this.emit('stream:session-update', {
      conversationId: this.session.id,
      session: this.sessionMachine.toInfo(),
    });
  }

  /** Push worker selection request to the renderer (CONSENSUS_APPROVED). */
  private emitWorkerSelectionRequest(): void {
    if (!this.sessionMachine) return;
    const candidates = this.session.participants
      .filter((p) => p.isActive && p.id !== 'user')
      .map((p) => ({ id: p.id, displayName: p.displayName }));
    this.emit('stream:worker-selection-request', {
      conversationId: this.session.id,
      candidates,
      proposal: this.sessionMachine.proposal ?? '',
    });
  }

  private emit<E extends StreamEventName>(event: E, data: StreamEventMap[E]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(event, data);
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}
