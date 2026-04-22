/**
 * MeetingOrchestrator — v3 replacement for the legacy
 * `ConversationOrchestrator`. Owns the run-loop that walks a
 * MeetingSession through the 12-state SSM, dispatches turns to
 * MeetingTurnExecutor, and posts the final minutes to `#회의록` when the
 * SSM reaches DONE / FAILED.
 *
 * R6 scope (plan D1 / D2 / D3):
 *   - Fully DI-wired — no `workspace-handler` singletons. Receives every
 *     service it touches through the constructor.
 *   - Emits **only** v3 `stream:meeting-*` events. The v2 `stream:token`
 *     / `stream:message-start` / `stream:state` naming is dead — this
 *     file imports neither.
 *   - `wireV3SideEffects` is called per meeting and the returned
 *     disposer is stored on `this.sideEffectDisposer` so a re-run or
 *     abort tears the listeners down cleanly.
 *   - On `SSM.state === 'DONE'` or `'FAILED'`, the orchestrator composes
 *     minutes via `MeetingMinutesComposer` and appends them to the
 *     project's `#회의록` (`system_minutes`) channel. If the channel is
 *     missing we still finish the meeting row and emit the terminal
 *     state event — the minutes post is a side-effect on top, not a
 *     gating step.
 *   - SSM synthesis / voting / execution branches are NOT re-implemented
 *     here. The R6 loop covers the "AI speaks in turn" slice that R5
 *     needs to demo; the synthesis-voting-executing path stays in the
 *     existing `ConsensusDriver` asset and lands in R6-Task7 when
 *     execution-coordinator is absorbed. The loop here breaks on
 *     WAIT_STATES so the synthesiser and voting paths can hook in
 *     without double-spending turns.
 *
 * Scope notes:
 *   - Inter-turn delay is fixed at 2s (matches v2). Configurable delay
 *     is a knob R10 can add.
 *   - User-interjection re-entry is a TurnManager concern; the
 *     orchestrator calls `session.interruptWithUserMessage()` when the
 *     channel-handler signals a mid-meeting user message and leaves the
 *     turn-manager to decide when the next AI gets the mic.
 */

import type { VoteRecord } from '../../../shared/consensus-types';
import type { SessionSnapshot, SessionState } from '../../../shared/session-state-types';
import type { MeetingService } from '../meeting-service';
import type { MessageService } from '../../channels/message-service';
import type { ChannelService } from '../../channels/channel-service';
import type { ProjectService } from '../../projects/project-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import type { ApprovalService } from '../../approvals/approval-service';
import type { NotificationService } from '../../notifications/notification-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import {
  wireV3SideEffects,
  type V3SideEffectDisposer,
} from '../../engine/v3-side-effects';
import type { MeetingSession } from './meeting-session';
import type { MeetingTurnExecutor } from './meeting-turn-executor';
import { composeMinutes, type MinutesTranslator } from './meeting-minutes-composer';

const INTER_TURN_DELAY_MS = 2000;

/**
 * SSM states that need user input — the loop hands control back to the
 * renderer (or to R7 ApprovalService) and pauses until the caller
 * resumes via `handleModeTransitionResponse` / `handleWorkerSelection`
 * / `handleUserDecision`. `PAUSED` and terminals are trivially WAIT.
 */
const WAIT_STATES: ReadonlySet<SessionState> = new Set([
  'MODE_TRANSITION_PENDING',
  'CONSENSUS_APPROVED',
  'USER_DECISION',
  'DONE',
  'FAILED',
  'PAUSED',
]);

export interface MeetingOrchestratorDeps {
  session: MeetingSession;
  turnExecutor: MeetingTurnExecutor;
  streamBridge: StreamBridge;
  messageService: MessageService;
  meetingService: MeetingService;
  channelService: ChannelService;
  projectService: ProjectService;
  approvalService: ApprovalService;
  notificationService: NotificationService;
  circuitBreaker: CircuitBreaker;
  /** Optional i18n translator threaded into `composeMinutes`. */
  t?: MinutesTranslator;
  /** Opt-out hook for tests — disables the inter-turn delay so loop
   *  unit tests don't wait 2s between speakers. */
  interTurnDelayMs?: number;
}

export class MeetingOrchestrator {
  private readonly session: MeetingSession;
  private readonly turnExecutor: MeetingTurnExecutor;
  private readonly streamBridge: StreamBridge;
  private readonly messageService: MessageService;
  private readonly meetingService: MeetingService;
  private readonly channelService: ChannelService;
  private readonly projectService: ProjectService;
  private readonly approvalService: ApprovalService;
  private readonly notificationService: NotificationService;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly t?: MinutesTranslator;
  private readonly interTurnDelayMs: number;

  private running = false;
  private abortController: AbortController | null = null;
  private sideEffectDisposer: V3SideEffectDisposer | null = null;
  /** Latches the TERMINAL state so the async SSM listener only posts
   *  minutes / finishes the meeting row once per run, even if the SSM
   *  emits the same state twice (e.g. re-enter the loop after a
   *  retry). */
  private terminalHandled = false;

  constructor(deps: MeetingOrchestratorDeps) {
    this.session = deps.session;
    this.turnExecutor = deps.turnExecutor;
    this.streamBridge = deps.streamBridge;
    this.messageService = deps.messageService;
    this.meetingService = deps.meetingService;
    this.channelService = deps.channelService;
    this.projectService = deps.projectService;
    this.approvalService = deps.approvalService;
    this.notificationService = deps.notificationService;
    this.circuitBreaker = deps.circuitBreaker;
    this.t = deps.t;
    this.interTurnDelayMs =
      deps.interTurnDelayMs ?? INTER_TURN_DELAY_MS;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Kick off the meeting loop. Idempotent — calling twice is a no-op
   *  until the previous run exits. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.terminalHandled = false;
    this.abortController = new AbortController();

    // Per-meeting wiring: SSM transitions → meetings DB + stream-bridge
    // state-changed + terminal #회의록 post + notifications.
    this.sideEffectDisposer = wireV3SideEffects(this.session.sessionMachine, {
      messages: this.messageService,
      meetings: this.meetingService,
      approvals: this.approvalService,
      notifications: this.notificationService,
      projects: this.projectService,
      channels: this.channelService,
      bridge: this.streamBridge,
      breaker: this.circuitBreaker,
    });

    // Local terminal listener — v3-side-effects owns the #회의록 post
    // with the terse "합의 결과" format, but the R6 minutes contract is
    // the richer MinutesComposer output. We subscribe here so we can
    // REPLACE the default post with the composed minutes.
    const unsubTerminal = this.session.sessionMachine.onStateChange(
      (snapshot) => {
        if (snapshot.state === 'DONE' || snapshot.state === 'FAILED') {
          void this.handleTerminal(snapshot);
        }
      },
    );

    try {
      if (this.session.turnManager.state !== 'running') {
        this.session.start();
      }
      await this.loop();
    } finally {
      unsubTerminal();
      this.running = false;
      this.abortController = null;
      this.sideEffectDisposer?.();
      this.sideEffectDisposer = null;
    }
  }

  /** Stop the loop. Cancels the in-flight provider request and freezes
   *  the SSM at whatever state it reached. The meeting row is NOT
   *  finished here — aborting via IPC (meeting:abort) sets outcome
   *  separately. */
  stop(): void {
    this.turnExecutor.abort();
    this.abortController?.abort();
    this.session.stop();
    this.running = false;
  }

  /** Pause the loop; the current turn finishes then the loop idles. */
  pause(): void {
    if (this.session.turnManager.state === 'running') {
      this.session.pause();
    }
  }

  /** Resume a paused meeting. */
  resume(): void {
    if (this.session.turnManager.state === 'paused') {
      this.session.resume();
    }
  }

  /** Signal from the channel-handler that the user sent a message
   *  mid-meeting. Interrupts the turn rotation so the user message
   *  lands before the next AI turn. */
  handleUserInterjection(): void {
    this.session.interruptWithUserMessage();
  }

  // ── Main loop ───────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    const ssm = this.session.sessionMachine;
    while (!ssm.isTerminal && this.session.state !== 'stopped') {
      if (this.session.state === 'paused') {
        await this.delay(500);
        continue;
      }

      if (WAIT_STATES.has(ssm.state)) {
        // Wait states exit the loop — the R7 approval path (or the
        // user-decision IPC) will transition SSM forward and, if the
        // caller wants, call `run()` again to resume.
        break;
      }

      if (this.session.state !== 'running') break;

      // The R6 orchestrator only drives the "AI speaks in turn" slice
      // of the SSM. Synthesis / voting / execution / review loops land
      // in R6-Task7 when ConsensusDriver / ExecutionCoordinator are
      // absorbed. For non-speaker states we surface them via the
      // stream-bridge and break so the R7 work can resume the loop.
      let roundEnded = false;
      switch (ssm.state) {
        case 'CONVERSATION':
        case 'WORK_DISCUSSING':
          roundEnded = await this.runSpeakerRound();
          break;
        default:
          // SYNTHESIZING / VOTING / EXECUTING / REVIEWING — hand off
          // to a future ConsensusDriver-style subscriber. Return so we
          // don't spin.
          return;
      }

      // Round finished without a state transition out of the speaker
      // phase (e.g. CONVERSATION → CONVERSATION with no work-majority,
      // or WORK_DISCUSSING when no next speaker is available yet).
      // Break out of the loop so the SSM sits idle until the next
      // IPC-driven resume, mirroring the v2 orchestrator contract.
      if (roundEnded) break;

      if (this.session.state === 'running') {
        await this.delay(this.interTurnDelayMs, this.abortController?.signal);
      }
    }
  }

  /** Run one speaker turn. Returns true when the round ended — either
   *  because the SSM transitioned out of the speaker phase, or because
   *  the round is finished and no further speaker is available. */
  private async runSpeakerRound(): Promise<boolean> {
    const speaker = this.session.getNextSpeaker();
    if (!speaker) {
      // Round boundary: transition SSM out of the speaker state. The
      // SSM's transition map handles CONVERSATION → CONVERSATION
      // (no-mode-judgment majority) vs → MODE_TRANSITION_PENDING.
      this.session.sessionMachine.transition('ROUND_COMPLETE');
      return true;
    }
    await this.turnExecutor.executeTurn(speaker);
    return false;
  }

  // ── Terminal handling ───────────────────────────────────────────────

  private async handleTerminal(snapshot: SessionSnapshot): Promise<void> {
    if (this.terminalHandled) return;
    this.terminalHandled = true;

    // (a) Compose minutes and post to #회의록. v3-side-effects already
    //     appended a terse "합의 결과" placeholder — we REPLACE it
    //     semantically by writing the richer composed minutes as a
    //     second system message. The v2-style placeholder is cheap to
    //     leave in place; readers see the full minutes immediately
    //     after. R10 can collapse the two into a single richer post
    //     once the LLM-summary path lands.
    try {
      await this.postMinutes(snapshot);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] minutes post failed',
        errorPayload(err),
      );
    }

    // (b) Close the meeting row. v3-side-effects updated the state
    //     column on every transition; here we stamp ended_at + outcome
    //     so the R4 dashboard TasksWidget surfaces the meeting as
    //     finished.
    try {
      const outcome =
        snapshot.state === 'DONE'
          ? 'accepted'
          : snapshot.state === 'FAILED'
            ? 'rejected'
            : 'aborted';
      this.meetingService.finish(
        this.session.meetingId,
        outcome,
        JSON.stringify(snapshot),
      );
    } catch (err) {
      // finish() throws MeetingNotFoundError when the row was already
      // finished (e.g. user clicked "abort" moments before DONE). Log
      // + swallow — the meeting reaching a terminal state is the
      // authoritative signal.
      console.warn(
        '[MeetingOrchestrator] meeting finish failed',
        errorPayload(err),
      );
    }
  }

  private async postMinutes(snapshot: SessionSnapshot): Promise<void> {
    const minutesChannelId = this.findMinutesChannelId();
    if (!minutesChannelId) return;

    const meeting = this.meetingService.get(this.session.meetingId);
    const startedAt = meeting?.startedAt ?? Date.now();

    const body = composeMinutes({
      meetingId: this.session.meetingId,
      topic: this.session.topic,
      participants: this.session.participants,
      snapshot: this.asSnapshotWithVotes(snapshot),
      startedAt,
      endedAt: Date.now(),
      t: this.t,
    });

    this.messageService.append({
      channelId: minutesChannelId,
      meetingId: this.session.meetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: body,
      meta: null,
    });
  }

  /** Look up the `#회의록` (`system_minutes`) channel for the project
   *  owning this meeting. Returns null when the channel is missing
   *  (test fixtures or archived projects). */
  private findMinutesChannelId(): string | null {
    const projectId = this.session.projectId;
    if (!projectId) return null;
    try {
      const rows = this.channelService.listByProject(projectId);
      const minutes = rows.find((c) => c.kind === 'system_minutes');
      return minutes?.id ?? null;
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] listByProject failed',
        errorPayload(err),
      );
      return null;
    }
  }

  /** Ensure the snapshot we hand to composeMinutes carries the `votes`
   *  array even when the SSM emits a FAILED snapshot with an empty
   *  record (SSM snapshots always have votes:[]; this is a defensive
   *  copy). */
  private asSnapshotWithVotes(snapshot: SessionSnapshot): SessionSnapshot {
    const votes: VoteRecord[] = [...(snapshot.votes ?? [])];
    return { ...snapshot, votes };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

function errorPayload(err: unknown): { name?: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { message: String(err) };
}
