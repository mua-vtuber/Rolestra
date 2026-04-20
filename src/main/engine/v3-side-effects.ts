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

  if (minutesChannelId) {
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
 * failure_report approval for audit, and fires an OS notification.
 *
 * We downgrade autonomy BEFORE filing the approval so that if the
 * approval write fails the project still exits auto mode — the manual
 * downgrade is the primary safety valve; the approval is the receipt.
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

  // (b) Approval row (audit receipt).
  try {
    deps.approvals.create({
      kind: 'failure_report',
      projectId: ctx.projectId || null,
      channelId: ctx.channelId || null,
      meetingId: ctx.meetingId || null,
      requesterId: null,
      payload: {
        source: 'circuit_breaker',
        reason: event.reason,
        detail: event.detail,
      },
    });
  } catch (err) {
    warn('approvals.create(failure_report) failed', err);
  }

  // (c) User-facing alert.
  try {
    deps.notifications.show({
      kind: 'error',
      title: 'Circuit breaker 발동',
      body: `${event.reason}: 자율 모드가 manual로 변경되었습니다`,
      channelId: ctx.channelId || null,
    });
  } catch (err) {
    warn('notifications.show (breaker) failed', err);
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
