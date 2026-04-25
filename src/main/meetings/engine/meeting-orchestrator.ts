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

import { createHash } from 'node:crypto';

import type { VoteRecord } from '../../../shared/consensus-types';
import type { SessionSnapshot, SessionState } from '../../../shared/session-state-types';
import type {
  ApprovalDecision,
  ConsensusDecisionApprovalPayload,
} from '../../../shared/approval-types';
import type { MeetingService } from '../meeting-service';
import type { MessageService } from '../../channels/message-service';
import type { ChannelService } from '../../channels/channel-service';
import type { ProjectService } from '../../projects/project-service';
import type { StreamBridge } from '../../streams/stream-bridge';
import {
  APPROVAL_DECIDED_EVENT,
  type ApprovalDecidedPayload,
  type ApprovalService,
} from '../../approvals/approval-service';
import type { NotificationService } from '../../notifications/notification-service';
import type { CircuitBreaker } from '../../queue/circuit-breaker';
import {
  wireV3SideEffects,
  postGeneralMeetingDoneMessage,
  type V3SideEffectDisposer,
} from '../../engine/v3-side-effects';
import type { MeetingSession } from './meeting-session';
import type { MeetingTurnExecutor } from './meeting-turn-executor';
import { composeMinutes, type MinutesTranslator } from './meeting-minutes-composer';
import { resolveNotificationLabel } from '../../notifications/notification-labels';

const INTER_TURN_DELAY_MS = 2000;

/**
 * Default wait for the user to decide on the consensus approval (spec §7.5).
 * Spec R7 plan: 24h — long enough that an offline user still has a chance
 * to review, short enough that the meeting row does not linger indefinitely
 * if the user abandons the app.
 */
const CONSENSUS_DECISION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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
  /**
   * R10-Task11: optional LLM summary appender. When provided, the
   * orchestrator calls `summarize(body)` after composing the minutes and
   * appends the result as a final paragraph. Failure is silent — the
   * minutes message is posted regardless.
   */
  meetingSummaryService?: {
    summarize(
      content: string,
      opts?: { preferredProviderId?: string | null; signal?: AbortSignal },
    ): Promise<{ summary: string | null; providerId: string | null }>;
  };
  /** Optional i18n translator threaded into `composeMinutes`. */
  t?: MinutesTranslator;
  /** Opt-out hook for tests — disables the inter-turn delay so loop
   *  unit tests don't wait 2s between speakers. */
  interTurnDelayMs?: number;
  /**
   * R7-Task9: consensus_decision approval timeout. Default 24h. Tests
   * pass a small value (e.g. 10ms) so the timeout branch fires without
   * stalling the suite.
   */
  consensusDecisionTimeoutMs?: number;
  /**
   * R9-Task7: optional post-finalise callback. Invoked exactly once per
   * run, immediately after {@link MeetingService.finish} settles the
   * meeting row (accepted / rejected / aborted). The autonomy-queue
   * loop uses this to drive `QueueService.complete(item, ...)` +
   * `startNext(projectId)` when the owning project is in `queue` mode.
   *
   * Errors are logged and swallowed — the meeting is already final
   * before the callback runs, so a broken queue hand-off must not
   * resurface as a meeting error. The callback runs asynchronously
   * (fire-and-forget) so the finalise path does not block on a slow
   * queue-side side-effect.
   */
  onFinalized?: (info: {
    meetingId: string;
    projectId: string;
    channelId: string;
    outcome: 'accepted' | 'rejected' | 'aborted';
  }) => void | Promise<void>;
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
  private readonly meetingSummaryService:
    | MeetingOrchestratorDeps['meetingSummaryService']
    | undefined;
  private readonly t?: MinutesTranslator;
  private readonly interTurnDelayMs: number;
  private readonly consensusDecisionTimeoutMs: number;
  private readonly onFinalized?: MeetingOrchestratorDeps['onFinalized'];
  /**
   * Per-run listener/timeout pair for the consensus approval gate. Kept so
   * `stop()` can tear down the wait without leaving an open listener
   * after an abort.
   */
  private consensusGateDisposer: (() => void) | null = null;

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
    this.meetingSummaryService = deps.meetingSummaryService;
    this.t = deps.t;
    this.interTurnDelayMs =
      deps.interTurnDelayMs ?? INTER_TURN_DELAY_MS;
    this.consensusDecisionTimeoutMs =
      deps.consensusDecisionTimeoutMs ?? CONSENSUS_DECISION_TIMEOUT_MS;
    this.onFinalized = deps.onFinalized;
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
    // R7-Task9: if the consensus approval gate was open, tear it down so
    // the listener + 24h timer do not outlive the aborted meeting.
    this.disposeConsensusGate();
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

    if (snapshot.state === 'FAILED') {
      // FAILED path — no approval gate. v3-side-effects posted the terse
      // fail line; we add the composed minutes + close the meeting row.
      try {
        await this.postMinutes(snapshot);
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] minutes post failed',
          errorPayload(err),
        );
      }
      this.finishMeeting(snapshot, 'rejected');
      return;
    }

    // DONE — R7-Task9 consensus-decision approval gate (spec §7.5).
    // The run() Promise resolves here; the user's decision (or the 24h
    // timeout) fires asynchronously on the approval service and drives
    // the final #회의록 post + meeting.finish() via the listener set up
    // below. The orchestrator instance stays alive via the closure.
    this.openConsensusDecisionGate(snapshot);
  }

  /**
   * Build the `consensus_decision` payload, open the approval row, and
   * subscribe to the `'decided'` event with a {@link consensusDecisionTimeoutMs}
   * safety timer. Idempotent per-run via `terminalHandled`.
   */
  private openConsensusDecisionGate(snapshot: SessionSnapshot): void {
    const payload = this.buildConsensusDecisionPayload(snapshot);

    let approvalId: string;
    try {
      const created = this.approvalService.create({
        kind: 'consensus_decision',
        projectId: this.session.projectId,
        channelId: this.session.channelId,
        meetingId: this.session.meetingId,
        requesterId: null,
        payload,
      });
      approvalId = created.id;
    } catch (err) {
      // ApprovalService.create failure must not strand the meeting in
      // limbo — fall back to the pre-R7 behaviour (immediate post +
      // accepted). Log loudly so the wiring bug surfaces.
      console.warn(
        '[MeetingOrchestrator] consensus approval create failed — falling back to immediate post',
        errorPayload(err),
      );
      void this.fallbackImmediateFinish(snapshot);
      return;
    }

    let settled = false;
    const onDecided = (event: ApprovalDecidedPayload): void => {
      if (event.item.id !== approvalId) return;
      if (settled) return;
      settled = true;
      this.disposeConsensusGate();
      void this.handleConsensusDecision(snapshot, event.decision, event.comment);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.disposeConsensusGate();
      try {
        this.approvalService.expire(approvalId);
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] consensus approval expire failed',
          errorPayload(err),
        );
      }
      void this.handleConsensusTimeout(snapshot);
    }, this.consensusDecisionTimeoutMs);
    // Let the app exit even if the 24h timer is still pending.
    if (typeof timer.unref === 'function') timer.unref();

    this.approvalService.on(APPROVAL_DECIDED_EVENT, onDecided);

    this.consensusGateDisposer = (): void => {
      clearTimeout(timer);
      this.approvalService.off(APPROVAL_DECIDED_EVENT, onDecided);
    };
  }

  private disposeConsensusGate(): void {
    if (this.consensusGateDisposer) {
      try {
        this.consensusGateDisposer();
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] consensus gate disposer threw',
          errorPayload(err),
        );
      }
      this.consensusGateDisposer = null;
    }
  }

  private async handleConsensusDecision(
    snapshot: SessionSnapshot,
    decision: ApprovalDecision,
    comment: string | null,
  ): Promise<void> {
    if (decision === 'reject') {
      // Reject — write the rejection message to #회의록 and close the
      // meeting as rejected. The reject comment (if any) is also
      // injected as a system message by ApprovalSystemMessageInjector
      // (Task 6); we don't duplicate it here.
      try {
        const minutesChannelId = this.findMinutesChannelId();
        if (minutesChannelId) {
          const trimmed = comment?.trim() ?? '';
          const body =
            trimmed.length > 0
              ? resolveNotificationLabel(
                  'meetingMinutes.rejectionWithComment',
                  { comment: trimmed },
                )
              : resolveNotificationLabel('meetingMinutes.rejection');
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
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] consensus rejection post failed',
          errorPayload(err),
        );
      }
      this.finishMeeting(snapshot, 'rejected');
      return;
    }

    // approve / conditional → composed minutes + accepted. Conditional
    // comment is already injected into the next turn's system prompt by
    // ApprovalSystemMessageInjector(Task 6) — here we only need the
    // minutes post + outcome stamp.
    try {
      await this.postMinutes(snapshot);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] consensus minutes post failed',
        errorPayload(err),
      );
    }
    this.finishMeeting(snapshot, 'accepted');
  }

  private async handleConsensusTimeout(
    snapshot: SessionSnapshot,
  ): Promise<void> {
    try {
      const minutesChannelId = this.findMinutesChannelId();
      if (minutesChannelId) {
        this.messageService.append({
          channelId: minutesChannelId,
          meetingId: this.session.meetingId,
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: '회의 합의 승인 대기 시간 초과 — 회의가 아카이브되었습니다.',
          meta: null,
        });
      }
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] consensus timeout post failed',
        errorPayload(err),
      );
    }
    this.finishMeeting(snapshot, 'aborted');
  }

  private async fallbackImmediateFinish(
    snapshot: SessionSnapshot,
  ): Promise<void> {
    try {
      await this.postMinutes(snapshot);
    } catch (err) {
      console.warn(
        '[MeetingOrchestrator] fallback minutes post failed',
        errorPayload(err),
      );
    }
    this.finishMeeting(snapshot, 'accepted');
  }

  private finishMeeting(
    snapshot: SessionSnapshot,
    outcome: 'accepted' | 'rejected' | 'aborted',
  ): void {
    try {
      this.meetingService.finish(
        this.session.meetingId,
        outcome,
        JSON.stringify(snapshot),
      );
    } catch (err) {
      // finish() throws MeetingNotFoundError when the row was already
      // finished. Log + swallow — terminal state is authoritative.
      console.warn(
        '[MeetingOrchestrator] meeting finish failed',
        errorPayload(err),
      );
    }

    // R9-Task8: post the autonomy-mode `#일반` completion message when
    // the meeting settled as accepted. The helper is a no-op for manual
    // projects and for missing `#일반` channels, so the call is safe to
    // issue unconditionally on the accepted branch. Rejected / aborted
    // outcomes skip this post — `#일반` is reserved for positive
    // completions (rejection / timeout already wrote to `#회의록`).
    if (outcome === 'accepted' && this.session.projectId) {
      try {
        postGeneralMeetingDoneMessage(
          {
            channels: this.channelService,
            messages: this.messageService,
            projects: this.projectService,
          },
          {
            projectId: this.session.projectId,
            meetingId: this.session.meetingId,
            meetingTitle: this.session.topic,
          },
        );
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] #일반 work-done post threw',
          errorPayload(err),
        );
      }
    }

    // R9-Task7: fire the post-finalise hook (if any). Fire-and-forget —
    // the queue hand-off must not resurface as a meeting error.
    const hook = this.onFinalized;
    if (hook) {
      const info = {
        meetingId: this.session.meetingId,
        projectId: this.session.projectId,
        channelId: this.session.channelId,
        outcome,
      };
      try {
        void Promise.resolve(hook(info)).catch((err) => {
          console.warn(
            '[MeetingOrchestrator] onFinalized callback threw',
            errorPayload(err),
          );
        });
      } catch (err) {
        console.warn(
          '[MeetingOrchestrator] onFinalized sync threw',
          errorPayload(err),
        );
      }
    }
  }

  private buildConsensusDecisionPayload(
    snapshot: SessionSnapshot,
  ): ConsensusDecisionApprovalPayload {
    const finalText = (snapshot.proposal ?? '').trim();
    const votes: VoteRecord[] = snapshot.votes ?? [];
    let yes = 0;
    let no = 0;
    let pending = 0;
    for (const v of votes) {
      if (v.vote === 'agree') yes += 1;
      else if (v.vote === 'disagree' || v.vote === 'block') no += 1;
      else pending += 1; // 'abstain'
    }
    const hashInput = `${finalText}|${JSON.stringify(votes)}`;
    const snapshotHash = createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .slice(0, 32);
    return {
      kind: 'consensus_decision',
      snapshotHash,
      finalText,
      votes: { yes, no, pending },
    };
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

    // R10-Task11: best-effort LLM summary appended as a final paragraph.
    // The summarize call is bounded internally (timeout + max chars) and
    // never throws — a null result preserves the deterministic body.
    let finalContent = body;
    if (this.meetingSummaryService !== undefined) {
      try {
        const result = await this.meetingSummaryService.summarize(body);
        if (result.summary !== null) {
          const provider = result.providerId ?? '?';
          const prefix = resolveNotificationLabel(
            'meetingMinutes.summaryPrefix',
            { provider },
          );
          finalContent = `${body}\n\n---\n${prefix} ${result.summary}`;
        }
      } catch (err) {
        // Defensive — summarize() should never throw, but if it does we
        // log and fall back to the deterministic body.
        console.warn(
          '[MeetingOrchestrator] llm summary failed',
          errorPayload(err),
        );
      }
    }

    this.messageService.append({
      channelId: minutesChannelId,
      meetingId: this.session.meetingId,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content: finalContent,
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
