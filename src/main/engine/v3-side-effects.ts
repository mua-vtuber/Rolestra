/**
 * v3 SSM side-effect wiring (Task 20).
 *
 * The v2 SessionStateMachine stays intact — this module registers
 * optional listeners that funnel its transitions into the Rolestra v3
 * service graph:
 *
 *   SSM.onStateChange(snapshot) ─┬─► MeetingService.updateState
 *                                ├─► StreamBridge.emitMeetingStateChanged
 *                                └─► on DONE/FAILED:
 *                                      ├─► MessageService.append → #회의록
 *                                      └─► NotificationService.show(work_done|error)
 *
 *   CircuitBreaker.on('fired') ──┬─► ProjectService.setAutonomy('manual')
 *                                ├─► ApprovalService.create('failure_report')
 *                                └─► NotificationService.show('error')
 *
 * Design constraints:
 *   - Wiring is strictly additive — all v2 tests remain oblivious.
 *   - Each side-effect is guarded with try/catch so a downstream
 *     service failure never rewrites the SSM's contract (state change
 *     must complete even if meeting DB update throws). The plain
 *     console.warn fallback mirrors the pattern in MessageService /
 *     ApprovalService until the structured logger lands.
 *   - R2-bridge sentinels: `SsmContext.meetingId` / `channelId` may be
 *     empty strings on sessions that pre-date Task 18's IPC wiring
 *     (see `ssm-context-types.ts`). The wiring checks for those
 *     sentinels rather than asserting.
 *   - The caller (`main/index.ts`, eventually Task 21 smoke) owns the
 *     service graph. This module is a pure wiring helper with NO
 *     module-level state — each SSM gets its own wire + disposer.
 */

import type { SessionSnapshot } from '../../shared/session-state-types';
import type { SessionStateMachine } from './session-state-machine';
import type { MessageService } from '../channels/message-service';
import type { MeetingService } from '../meetings/meeting-service';
import type { ApprovalService } from '../approvals/approval-service';
import type { NotificationService } from '../notifications/notification-service';
import type { ProjectService } from '../projects/project-service';
import type { ChannelService } from '../channels/channel-service';
import type { StreamBridge } from '../streams/stream-bridge';
import {
  CIRCUIT_BREAKER_FIRED_EVENT,
  type CircuitBreaker,
  type CircuitBreakerFiredEvent,
} from '../queue/circuit-breaker';

/**
 * Service references passed to {@link wireV3SideEffects}. Every field
 * is required — tests that want to mute a side-effect pass a vi.fn()
 * mock with a no-op implementation rather than omitting the service.
 */
export interface V3SideEffectDeps {
  messages: MessageService;
  meetings: MeetingService;
  approvals: ApprovalService;
  notifications: NotificationService;
  projects: ProjectService;
  channels: ChannelService;
  bridge: StreamBridge;
  breaker: CircuitBreaker;
}

/**
 * Disposer returned by {@link wireV3SideEffects}. Calling it unwires
 * every listener registered by that call. Idempotent — calling twice
 * is a no-op.
 */
export type V3SideEffectDisposer = () => void;

/**
 * Summary ceiling for the work_done notification body. The SSM
 * proposal can be multi-paragraph; the notification center truncates
 * cleanly if we pre-cap here (and avoids sending multi-KB strings
 * through the OS notification surface).
 */
const NOTIFICATION_BODY_LIMIT = 200;

/**
 * Wire the v3 side-effect listeners for a single SSM instance. Call
 * this once per SSM, after construction, before any transition. The
 * returned disposer removes every listener when the session ends
 * (caller is expected to invoke it on SSM teardown / DONE handler
 * completion).
 */
export function wireV3SideEffects(
  ssm: SessionStateMachine,
  deps: V3SideEffectDeps,
): V3SideEffectDisposer {
  const ctx = ssm.ctx;
  const disposers: Array<() => void> = [];

  // ── 1. State changes ─────────────────────────────────────────────
  const unsubState = ssm.onStateChange((snapshot) => {
    // (a) Meeting DB update — only when we have a real meeting id.
    if (ctx.meetingId) {
      try {
        deps.meetings.updateState(
          ctx.meetingId,
          snapshot.state,
          JSON.stringify(snapshot),
        );
      } catch (err) {
        warn('meetings.updateState failed', err);
      }
    }

    // (b) Renderer push.
    try {
      deps.bridge.emitMeetingStateChanged({
        meetingId: ctx.meetingId,
        channelId: ctx.channelId,
        state: snapshot.state,
      });
    } catch (err) {
      warn('bridge.emitMeetingStateChanged failed', err);
    }

    // (c) Terminal state post + notification.
    if (snapshot.state === 'DONE' || snapshot.state === 'FAILED') {
      postTerminalSideEffects(snapshot, ctx, deps);
    }
  });
  disposers.push(unsubState);

  // ── 2. Permission actions ────────────────────────────────────────
  // Permission grants/revocations for the worker are already handled by
  // the PermissionService runtime. We listen here purely to keep the
  // contract shape stable for future audit-log hooks (Task 21+).
  const unsubPerm = ssm.onPermissionAction(() => {
    // Intentional no-op today. See header for rationale.
  });
  disposers.push(unsubPerm);

  // ── 3. Circuit breaker fired ─────────────────────────────────────
  const breakerHandler = (event: CircuitBreakerFiredEvent): void => {
    handleBreakerFired(event, ctx, deps);
  };
  deps.breaker.on(CIRCUIT_BREAKER_FIRED_EVENT, breakerHandler);
  disposers.push(() => {
    deps.breaker.off(CIRCUIT_BREAKER_FIRED_EVENT, breakerHandler);
  });

  // ── Disposer ─────────────────────────────────────────────────────
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const d of disposers) {
      try {
        d();
      } catch (err) {
        warn('disposer threw', err);
      }
    }
  };
}

// ── Helpers ────────────────────────────────────────────────────────

/** Locate the `system_minutes` (`#회의록`) channel id for a project. */
function findMinutesChannelId(
  channels: ChannelService,
  projectId: string,
): string | null {
  if (!projectId) return null;
  const rows = channels.listByProject(projectId);
  const minutes = rows.find((c) => c.kind === 'system_minutes');
  return minutes?.id ?? null;
}

/**
 * Build the system summary message appended to `#회의록` when the SSM
 * reaches DONE / FAILED. The body is intentionally terse — detailed
 * state (snapshots, votes) lives in the meeting row snapshot column.
 */
function buildTerminalMessageContent(snapshot: SessionSnapshot): string {
  if (snapshot.state === 'DONE') {
    const proposal = snapshot.proposal?.trim();
    return proposal && proposal.length > 0
      ? `회의 종료 — 합의 결과:\n${proposal}`
      : '회의 종료 — 합의 결과 없음';
  }
  // FAILED
  const previous = snapshot.previousState ?? 'UNKNOWN';
  return `회의 실패 — 이전 상태: ${previous}`;
}

/**
 * Runs after a DONE / FAILED transition:
 *   1. Appends a system-authored summary to the project's `#회의록`.
 *   2. Fires a work_done (DONE) or error (FAILED) notification.
 *
 * Each sub-step is guarded so a single failure (missing channel,
 * closed DB handle during shutdown) does not skip the others. The
 * channel lookup itself is defensive: if the project has no
 * `system_minutes` row we skip the post silently and still fire the
 * notification so the user isn't left without signal.
 */
function postTerminalSideEffects(
  snapshot: SessionSnapshot,
  ctx: SessionStateMachine['ctx'],
  deps: V3SideEffectDeps,
): void {
  let minutesChannelId: string | null = null;
  try {
    minutesChannelId = findMinutesChannelId(deps.channels, ctx.projectId);
  } catch (err) {
    warn('findMinutesChannelId failed', err);
  }

  // R7-Task9: the DONE branch is now approval-gated. MeetingOrchestrator
  // opens a `consensus_decision` approval when SSM reaches DONE and posts
  // the final #회의록 entry only after the user decides (approve →
  // composed minutes, reject → rejection message, timeout → expired).
  // Firing a post here would land the terse "합의 결과" message BEFORE
  // the user has approved, breaking the gate. FAILED stays unchanged —
  // failures are not approval-gated.
  if (minutesChannelId && snapshot.state === 'FAILED') {
    try {
      deps.messages.append({
        channelId: minutesChannelId,
        meetingId: ctx.meetingId || null,
        authorId: 'system',
        authorKind: 'system',
        role: 'system',
        content: buildTerminalMessageContent(snapshot),
        meta: null,
      });
    } catch (err) {
      warn('messages.append (#회의록) failed', err);
    }
  }

  try {
    if (snapshot.state === 'DONE') {
      const body =
        snapshot.proposal?.slice(0, NOTIFICATION_BODY_LIMIT) ??
        '회의가 완료되었습니다';
      deps.notifications.show({
        kind: 'work_done',
        title: '작업 완료',
        body,
        channelId: minutesChannelId,
      });
    } else {
      const previous = snapshot.previousState ?? 'UNKNOWN';
      deps.notifications.show({
        kind: 'error',
        title: '작업 실패',
        body: `${previous} 상태에서 종료되었습니다`,
        channelId: minutesChannelId,
      });
    }
  } catch (err) {
    warn('notifications.show (terminal) failed', err);
  }
}

/**
 * Runs when the circuit breaker trips. Downgrades autonomy, files a
 * `circuit_breaker` approval row for audit, and fires an OS notification.
 *
 * We downgrade autonomy BEFORE filing the approval so that if the
 * approval write fails the project still exits auto mode — the manual
 * downgrade is the primary safety valve; the approval is the receipt.
 *
 * R9-Task6: approval kind is now `circuit_breaker` (was `failure_report`).
 * Kind values are `TEXT` in `approval_items` so no migration is needed.
 * The payload carries `{source: 'circuit_breaker', tripwire, detail}`
 * — `tripwire` mirrors the `event.reason` literal; `detail` is the
 * tripwire-specific diagnostic (file count / elapsed ms / streak /
 * error category) minted inside `CircuitBreaker.fire`.
 *
 * Notification title/body are keyed per tripwire so the future i18n
 * populate (R9-Task11) can swap them to localized copy. Today the
 * helper returns the literal fallback strings — identical shape to
 * the terminal-state notification so NotificationService treats them
 * uniformly.
 */
function handleBreakerFired(
  event: CircuitBreakerFiredEvent,
  ctx: SessionStateMachine['ctx'],
  deps: V3SideEffectDeps,
): void {
  // (a) Autonomy downgrade — the primary safety action.
  if (ctx.projectId) {
    try {
      deps.projects.setAutonomy(ctx.projectId, 'manual');
    } catch (err) {
      warn('projects.setAutonomy(manual) failed', err);
    }
  }

  // (b) Approval row (audit receipt). `kind='circuit_breaker'` lets
  //     AutonomyGate + renderer ApprovalInbox filter the row without
  //     mining the payload. Meta shape `{tripwire, detail}` matches
  //     the plan wording for R9-Task6.
  try {
    deps.approvals.create({
      kind: 'circuit_breaker',
      projectId: ctx.projectId || null,
      channelId: ctx.channelId || null,
      meetingId: ctx.meetingId || null,
      requesterId: null,
      payload: {
        source: 'circuit_breaker',
        tripwire: event.reason,
        detail: event.detail,
      },
    });
  } catch (err) {
    warn('approvals.create(circuit_breaker) failed', err);
  }

  // (c) User-facing alert. Title/body pivot on the tripwire so the OS
  //     toast describes the specific safety trip (file cap vs. CLI time
  //     vs. queue streak vs. error repeat) rather than a generic
  //     "breaker fired" line.
  try {
    const { title, body } = breakerNotificationCopy(event);
    deps.notifications.show({
      kind: 'error',
      title,
      body,
      channelId: ctx.channelId || null,
    });
  } catch (err) {
    warn('notifications.show (breaker) failed', err);
  }
}

/**
 * Pivot title + body on `event.reason`. Strings are Korean fallbacks;
 * R9-Task11 swaps them for `t(...)` lookups through the main-process
 * notification-labels dictionary (i18next is not imported in the Main
 * bundle — see Decision Log D8). The word "breaker" is kept in the
 * title so the existing v3-side-effects test (match-on-title) keeps
 * working without being pinned to a specific Korean phrase.
 */
function breakerNotificationCopy(
  event: CircuitBreakerFiredEvent,
): { title: string; body: string } {
  switch (event.reason) {
    case 'files_per_turn': {
      const count = readNumberField(event.detail, 'count');
      return {
        title: 'Circuit breaker 발동 — 파일 변경 한계',
        body:
          count !== null
            ? `한 턴에 파일 ${count}개를 변경했습니다. 자율 모드가 manual로 변경되었습니다.`
            : '파일 변경이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
      };
    }
    case 'cumulative_cli_ms': {
      const ms = readNumberField(event.detail, 'ms');
      const minutes = ms !== null ? Math.round(ms / 60000) : null;
      return {
        title: 'Circuit breaker 발동 — CLI 누적 시간 한계',
        body:
          minutes !== null
            ? `CLI 누적 실행 시간이 ${minutes}분을 넘었습니다. 자율 모드가 manual로 변경되었습니다.`
            : 'CLI 누적 실행 시간이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
      };
    }
    case 'queue_streak': {
      const count = readNumberField(event.detail, 'count');
      return {
        title: 'Circuit breaker 발동 — 연속 큐 실행',
        body:
          count !== null
            ? `연속으로 ${count}개의 큐 항목을 실행했습니다. 자율 모드가 manual로 변경되었습니다.`
            : '연속 큐 실행이 한계에 도달했습니다. 자율 모드가 manual로 변경되었습니다.',
      };
    }
    case 'same_error': {
      const category = readStringField(event.detail, 'category');
      return {
        title: 'Circuit breaker 발동 — 같은 오류 반복',
        body:
          category !== null
            ? `같은 오류(${category})가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.`
            : '같은 오류가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.',
      };
    }
    default: {
      // Exhaustive fallback — a future CircuitBreakerReason would land
      // here until the switch is extended. Keep the word "breaker" in
      // the title so legacy string-match assertions stay green.
      return {
        title: 'Circuit breaker 발동',
        body: '자율 모드가 manual로 변경되었습니다.',
      };
    }
  }
}

/** Read `key` from `detail` when it is a plain object + number value. */
function readNumberField(detail: unknown, key: string): number | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read `key` from `detail` when it is a plain object + string value. */
function readStringField(detail: unknown, key: string): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ── R9-Task8: post-finalise work-done side-effect ────────────────────

/**
 * Minimum project shape needed by {@link postGeneralMeetingDoneMessage}.
 * The helper only reads `autonomyMode` — widening the contract would pull
 * every Project consumer into the v3-side-effects bundle.
 */
interface MeetingDoneProject {
  autonomyMode: 'manual' | 'auto_toggle' | 'queue';
}

/**
 * Service surface the R9-Task8 `#일반` work-done helper consumes. Split
 * out from {@link V3SideEffectDeps} so MeetingOrchestrator can pass an
 * ad-hoc object without constructing an SSM context.
 */
export interface WorkDoneHandlerDeps {
  channels: Pick<ChannelService, 'listByProject'>;
  messages: Pick<MessageService, 'append'>;
  projects: { get(id: string): MeetingDoneProject | null };
}

/** Identifying info forwarded to the work-done helper. */
export interface WorkDoneEventInfo {
  projectId: string;
  meetingId: string;
  /** Human-readable meeting subject used in the `#일반` message body. */
  meetingTitle: string;
}

/**
 * Append a system-authored "meeting done" message to the project's
 * `#일반` (`system_general`) channel — but only when the project is in
 * `auto_toggle` / `queue` autonomy mode (spec §8).
 *
 * R9-Task8 design:
 *   - The `#회의록` post + the OS-level `work_done` notification are
 *     already owned elsewhere (MeetingOrchestrator.postMinutes and
 *     postTerminalSideEffects, respectively). This helper is strictly
 *     additive so manual-mode flows regress at zero.
 *   - Called from {@link MeetingOrchestrator.finishMeeting} when the
 *     meeting settles with `outcome='accepted'`. Rejected / aborted
 *     meetings do NOT trigger a `#일반` post — the channel is reserved
 *     for positive completions.
 *   - Error-tolerant: project lookup, channel lookup, and message
 *     append each run inside try/catch so a downstream failure (missing
 *     `#일반`, closed DB) does not resurface at the finalise path.
 *   - Today the message text is a Korean literal. R9-Task11 swaps it
 *     for a main-process i18n dictionary lookup (Decision Log D8).
 */
export function postGeneralMeetingDoneMessage(
  deps: WorkDoneHandlerDeps,
  info: WorkDoneEventInfo,
): void {
  if (!info.projectId) return;

  let project: MeetingDoneProject | null = null;
  try {
    project = deps.projects.get(info.projectId);
  } catch (err) {
    warn('projects.get (work-done) failed', err);
    return;
  }
  if (!project) return;
  if (
    project.autonomyMode !== 'auto_toggle' &&
    project.autonomyMode !== 'queue'
  ) {
    return;
  }

  let generalChannelId: string | null = null;
  try {
    const rows = deps.channels.listByProject(info.projectId);
    generalChannelId =
      rows.find((c) => c.kind === 'system_general')?.id ?? null;
  } catch (err) {
    warn('channels.listByProject (work-done) failed', err);
    return;
  }
  if (!generalChannelId) return;

  const title = info.meetingTitle.trim();
  const content =
    title.length > 0
      ? `회의 "${title}" 이(가) 완료되었습니다.`
      : '회의가 완료되었습니다.';

  try {
    deps.messages.append({
      channelId: generalChannelId,
      meetingId: info.meetingId || null,
      authorId: 'system',
      authorKind: 'system',
      role: 'system',
      content,
      meta: null,
    });
  } catch (err) {
    warn('messages.append (#일반 work-done) failed', err);
  }
}

/**
 * Local logger — swap for the structured logger when it lands.
 * Marker: "rolestra.v3-side-effects" keeps grep-ability across a
 * future unification pass.
 */
function warn(stage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // TODO R2-log: swap for structured logger (src/main/log/)
  console.warn('[rolestra.v3-side-effects]', stage, {
    name: err instanceof Error ? err.name : undefined,
    message,
  });
}
