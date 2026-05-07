/**
 * StreamBridge — central Main → Renderer push hub.
 *
 * Rolestra services (MessageService, ApprovalService, QueueService, …)
 * emit their own EventEmitter events for in-process subscribers. The
 * bridge funnels the subset that needs to reach the renderer into a
 * single outbound stream shaped by `StreamEvent` (spec §6, `stream-events.ts`).
 *
 * Wire contract:
 *   - `connect(services)`        — subscribe to whatever events the
 *                                  passed services actually expose today.
 *                                  Services that do not emit the right
 *                                  shape themselves (project updates,
 *                                  meeting state, member status, queue
 *                                  progress with full item, notification
 *                                  shown) are reached via the `emitXxx`
 *                                  methods below; Task 20 SSM side-
 *                                  effects will call those directly.
 *   - `onOutbound(fn)`           — register 1..N renderer delivery hooks
 *                                  (Electron `webContents.send`).
 *                                  Multiple listeners are allowed so
 *                                  tests / mirrors / diagnostics can
 *                                  piggyback.
 *   - `emit(event)`              — single funnel: shape-validates,
 *                                  honours the per-type cooldown, and
 *                                  fans out to every outbound listener.
 *
 * Production hardening (spec §6 CC-2):
 *   - **Shape validation runs in every build** — dev AND prod.
 *     Invalid events are dropped + logged; they do not crash the bridge.
 *   - **5 consecutive invalid emits per event type → 30-second cooldown**.
 *     During cooldown, any emit of that type is silently dropped so a
 *     malformed producer cannot flood the renderer. The counter is
 *     reset the next time a VALID event of the same type lands — a
 *     single recovery flushes the suspicion. Cooldown itself resets the
 *     count once the 30s window expires.
 *   - **Listener exceptions are isolated** — a throwing outbound hook
 *     does not break other hooks and does not mark the event as invalid.
 *     Matches how the upstream services emit (MessageService / ApprovalService).
 */

import type { EventEmitter } from 'node:events';
import type { QueueItem } from '../../shared/queue-types';
import type {
  StreamEvent,
  StreamEventType,
  StreamChannelMessagePayload,
  StreamApprovalCreatedPayload,
  StreamApprovalDecidedPayload,
  StreamProjectUpdatedPayload,
  StreamMeetingStateChangedPayload,
  StreamMeetingPhaseChangedPayload,
  StreamNextStepClassifiedPayload,
  StreamMeetingTurnStartPayload,
  StreamMeetingTurnTokenPayload,
  StreamMeetingTurnDonePayload,
  StreamMeetingErrorPayload,
  StreamMeetingTurnSkippedPayload,
  StreamQueueUpdatedPayload,
  StreamMemberStatusChangedPayload,
  StreamNotificationPayload,
  StreamNotificationClickedPayload,
  StreamNotificationPrefsChangedPayload,
  StreamAutonomyModeChangedPayload,
  StreamIdeaPickSnapshotPayload,
  StreamDesignedTaskAssignedPayload,
  StreamDesignSnapshotReadyPayload,
  StreamDashboardProgressChangedPayload,
} from '../../shared/stream-events';
import type { RunStep } from '../../shared/run-step-types';

/** Renderer-delivery hook. */
export type StreamOutboundListener = (event: StreamEvent) => void;

/** Consecutive-failure threshold before the cooldown kicks in. */
export const STREAM_FAILURE_THRESHOLD = 5;
/** Duration of the cooldown window triggered by the threshold (ms). */
export const STREAM_COOLDOWN_MS = 30_000;

/** Synthetic bucket key used when the event arrives too malformed to carry a valid `type`. */
const UNKNOWN_TYPE_BUCKET = '__unknown__';

/**
 * The full set of event types the bridge knows how to validate. New
 * types must be added here AND to the discriminated union in
 * `stream-events.ts` — otherwise `emit()` will reject them at runtime.
 */
const KNOWN_EVENT_TYPES: ReadonlySet<StreamEventType> = new Set<StreamEventType>([
  'stream:channel-message',
  'stream:member-status-changed',
  'stream:approval-created',
  'stream:approval-decided',
  'stream:project-updated',
  'stream:meeting-state-changed',
  'stream:meeting-phase-changed',
  'stream:next-step-classified',
  'stream:meeting-turn-start',
  'stream:meeting-turn-token',
  'stream:meeting-turn-done',
  'stream:meeting-error',
  'stream:meeting-turn-skipped',
  'stream:queue-updated',
  'stream:notification',
  'stream:notification-clicked',
  'stream:notification-prefs-changed',
  'stream:autonomy-mode-changed',
  'stream:idea-pick-snapshot',
  'stream:designed-task-assigned',
  'stream:design-snapshot-ready',
  'stream:dashboard-progress-changed',
  'stream:handoff-required',
  'stream:handoff-dispatched',
  'stream:handoff-rejected',
]);

interface FailureState {
  count: number;
  /** Epoch-ms at which the cooldown ends; 0 when not cooling down. */
  until: number;
}

/**
 * Lightweight structural subset of the services the bridge connects to.
 * We only rely on EventEmitter.on, so keeping the surface narrow lets
 * tests pass plain `new EventEmitter()` instances.
 */
export interface StreamBridgeServices {
  messages?: EventEmitter;
  approvals?: EventEmitter;
  queue?: EventEmitter;
  /**
   * R7-Task11: NotificationService whose `'clicked'` event feeds
   * `stream:notification-clicked`. Bridged here (rather than via
   * `emitXxx` helpers) because the event is a pure in-process signal —
   * no side-effect logic needs to run before it reaches the renderer.
   */
  notifications?: EventEmitter;
  /**
   * R10-Task10: MemberProfileService whose `'status-changed'` event
   * feeds `stream:member-status-changed`. The service emits the full
   * payload shape (providerId + member view + status + cause) so the
   * bridge forwards verbatim — no payload adapter needed (mirrors the
   * R8 D8 stub spec, now activated).
   *
   * D9 coexistence (plan R10): the existing R8 mutation-after-invalidation
   * pattern (renderer surfaces calling `notifyChannelsChanged()` after
   * `member:set-status` / `member:update-profile`) keeps working as a
   * fallback when the bridge is offline. The stream is an ADDITIVE
   * layer — see `use-member-status-stream.ts` for the renderer-side
   * dual-path note.
   */
  members?: EventEmitter;
  /**
   * R9-Task5: ProjectService whose `'autonomy-changed'` event feeds
   * `stream:autonomy-mode-changed`. Fires on both user-initiated
   * toggles (`project:set-autonomy` IPC) and system-initiated
   * downgrades (AutonomyGate fail path / CircuitBreaker fire), with the
   * `reason` carried through so the renderer can distinguish the two.
   */
  projects?: EventEmitter;
  /**
   * Resolves a `{id}`-form `changed` hint to its owning `projectId` so
   * the snapshot lookup below can fire. Required because single-row
   * mutations (complete / in_progress cancel) carry `{id}` only — the
   * project scope is implicit. Returns null when the id is unknown
   * (already-removed row); the bridge then drops the event.
   */
  queueItemLookup?: (id: string) => { projectId: string; id: string } | null;
  /**
   * R9-Task7: full-snapshot lookup. `changed` events fan out as
   * `stream:queue-updated` (project-level list + paused flag) — the
   * renderer's `useQueue` hook subscribes to `stream:queue-updated`
   * only, so this is the authoritative surface. The F6 cleanup retired
   * the legacy per-item `stream:queue-progress` fall-back; bridge
   * connections now require `queueSnapshot` to surface queue events.
   */
  queueSnapshot?: (projectId: string) => {
    items: QueueItem[];
    paused: boolean;
  };
  /**
   * R12-C2 T19: RunStepService whose `'appended'` event (RunStep payload)
   * fans out as `stream:dashboard-progress-changed` — H1 패널의 1 분 TTL
   * 캐시 invalidate 신호. payload 자체는 RunStep row 이지만 stream 으로
   * 나가는 건 `{ projectId, sourceChannelId }` 뿐 (renderer 가 `dashboard:
   * progress-snapshot` 로 별도 fetch — spec §11.21.4).
   *
   * `runStepProjectLookup` 가 channelId → projectId 변환을 담당. DM /
   * legacy user 채널 (project_id IS NULL) 은 H1 패널 surface 대상이
   * 아니므로 lookup 이 null 돌려주면 본 bridge 가 silent skip.
   */
  runStep?: EventEmitter;
  /**
   * 채널 → 프로젝트 룩업. RunStep `appended` 이벤트의 channelId 를
   * dashboard 패널의 projectId 로 변환. null = 그 채널이 어떤 프로젝트에도
   * 속하지 않음 (DM / legacy user / 글로벌 system) → bridge 는 본
   * 이벤트 skip. lookup 없이 `runStep` 만 주입되면 connect 가 silent
   * skip — 본 lookup 이 채널 진실원천 (NoSilentFallback 위반 X — 도메인
   * 적으로 "해당 채널은 H1 surface 와 무관" 이 의미 있는 정상 분기).
   */
  runStepChannelToProject?: (channelId: string) => string | null;
}

export class StreamBridge {
  private readonly outbound: StreamOutboundListener[] = [];
  private readonly failures = new Map<string, FailureState>();

  /**
   * Register an outbound delivery hook. Returns a disposer that removes
   * the listener so callers (tests, components that mount/unmount) can
   * unwire without poking internals.
   */
  onOutbound(fn: StreamOutboundListener): () => void {
    this.outbound.push(fn);
    return () => {
      const idx = this.outbound.indexOf(fn);
      if (idx >= 0) this.outbound.splice(idx, 1);
    };
  }

  /**
   * Submit an event to the renderer pipeline. Invalid events are
   * dropped; cooled-down types are silently skipped. Returns true when
   * the event was actually fanned out, false otherwise — handy for
   * tests but nothing in production logic branches on this.
   */
  emit(event: StreamEvent | unknown): boolean {
    if (!this.isShapeValid(event)) {
      const bucket = this.extractTypeBucket(event);
      this.recordFailure(bucket);
      console.warn('[rolestra.stream-bridge] dropped invalid event', {
        bucket,
      });
      return false;
    }

    const typed = event as StreamEvent;
    if (this.isCoolingDown(typed.type)) {
      return false;
    }

    // Valid event → clear this type's failure streak so a transient
    // upstream hiccup doesn't accumulate into a cooldown over minutes.
    this.failures.delete(typed.type);

    for (const fn of this.outbound) {
      try {
        fn(typed);
      } catch (err) {
        // Isolate listener failures — one buggy hook must not stop
        // other hooks from delivering or mark the event as invalid.
        const message = err instanceof Error ? err.message : String(err);
        // TODO R2-log: swap for structured logger (src/main/log/)
        console.warn('[rolestra.stream-bridge] outbound listener threw:', {
          type: typed.type,
          name: err instanceof Error ? err.name : undefined,
          message,
        });
      }
    }
    return true;
  }

  /**
   * Subscribe to the in-process service events that already have the
   * shape we need. Services without a direct emit (ProjectService,
   * MeetingService, MemberProfileService, NotificationService,
   * per-item QueueService progress) are fed via the `emitXxx` helpers
   * below — Task 20 SSM side-effects own those call sites.
   */
  connect(services: StreamBridgeServices): void {
    if (services.messages) {
      services.messages.on('message', (msg: unknown) => {
        this.emit({
          type: 'stream:channel-message',
          payload: { message: msg } as StreamChannelMessagePayload,
        });
      });
    }

    if (services.approvals) {
      services.approvals.on('created', (payload: unknown) => {
        this.emit({
          type: 'stream:approval-created',
          payload: this.asApprovalCreated(payload),
        });
      });
      services.approvals.on('decided', (payload: unknown) => {
        this.emit({
          type: 'stream:approval-decided',
          payload: this.asApprovalDecided(payload),
        });
      });
    }

    if (services.queue) {
      services.queue.on('changed', (hint: unknown) => {
        const h = (hint ?? {}) as { id?: string; projectId?: string };

        // R9-Task7 authoritative path: emit a full `stream:queue-updated`
        // snapshot so the renderer reconciles items + paused state in
        // one hop. Resolve projectId from either hint form — for the
        // `{id}`-only form we still need `queueItemLookup` as the id →
        // projectId indirection, because the snapshot query is
        // project-scoped. Without `queueSnapshot` the bridge cannot
        // produce a usable event and silently drops the hint.
        if (!services.queueSnapshot) return;
        let projectId: string | null = h.projectId ?? null;
        if (!projectId && h.id) {
          const resolved = services.queueItemLookup?.(h.id);
          projectId = resolved?.projectId ?? null;
        }
        if (!projectId) return;
        const snapshot = services.queueSnapshot(projectId);
        this.emit({
          type: 'stream:queue-updated',
          payload: {
            projectId,
            items: snapshot.items,
            paused: snapshot.paused,
          } as StreamQueueUpdatedPayload,
        });
      });
    }

    if (services.notifications) {
      services.notifications.on('clicked', (payload: unknown) => {
        this.emit({
          type: 'stream:notification-clicked',
          payload: payload as StreamNotificationClickedPayload,
        });
      });
    }

    if (services.members) {
      services.members.on('status-changed', (payload: unknown) => {
        // MemberProfileService emits the full StreamMemberStatusChangedPayload
        // shape (Task 10), so we forward verbatim. Shape validation in
        // emit() catches any drift from a future refactor.
        this.emit({
          type: 'stream:member-status-changed',
          payload: payload as StreamMemberStatusChangedPayload,
        });
      });
    }

    if (services.projects) {
      services.projects.on('autonomy-changed', (payload: unknown) => {
        // ProjectService emits `{projectId, mode, reason}` — shape already
        // matches StreamAutonomyModeChangedPayload, but we coerce defensively
        // so a stray emitter that forgets `reason` still produces a valid
        // stream event (default 'user' mirrors the ProjectService default).
        const record = (payload ?? {}) as Record<string, unknown>;
        this.emit({
          type: 'stream:autonomy-mode-changed',
          payload: {
            projectId: String(record.projectId ?? ''),
            mode: record.mode as StreamAutonomyModeChangedPayload['mode'],
            reason:
              typeof record.reason === 'string'
                ? (record.reason as StreamAutonomyModeChangedPayload['reason'])
                : 'user',
          },
        });
      });
    }

    if (services.runStep) {
      // R12-C2 T19: RunStepService.appended (RunStep row) → projectId 룩업
      // → stream:dashboard-progress-changed (signal-only, payload는 projectId
      // + sourceChannelId 만). lookup 없이 runStep 만 주입되면 silent skip
      // (테스트 / 부분 wiring 안전망). projectId null 이면 dashboard 패널과
      // 무관한 채널 (DM / legacy) 이므로 skip.
      const lookup = services.runStepChannelToProject;
      services.runStep.on('appended', (payload: unknown) => {
        if (!lookup) return;
        const step = payload as RunStep | null | undefined;
        if (!step || typeof step !== 'object') return;
        const channelId = step.channelId;
        if (typeof channelId !== 'string' || channelId.length === 0) return;
        const projectId = lookup(channelId);
        if (projectId === null) return;
        this.emit({
          type: 'stream:dashboard-progress-changed',
          payload: { projectId, sourceChannelId: channelId },
        });
      });
    }
  }

  // ── Direct emit helpers (Task 20 side-effects) ────────────────────

  emitChannelMessage(payload: StreamChannelMessagePayload): void {
    this.emit({ type: 'stream:channel-message', payload });
  }

  emitApprovalCreated(payload: StreamApprovalCreatedPayload): void {
    this.emit({ type: 'stream:approval-created', payload });
  }

  emitApprovalDecided(payload: StreamApprovalDecidedPayload): void {
    this.emit({ type: 'stream:approval-decided', payload });
  }

  emitProjectUpdated(payload: StreamProjectUpdatedPayload): void {
    this.emit({ type: 'stream:project-updated', payload });
  }

  emitMeetingStateChanged(
    payload: StreamMeetingStateChangedPayload,
  ): void {
    this.emit({ type: 'stream:meeting-state-changed', payload });
  }

  /**
   * R12-C2 T10a — 새 phase 전환 신호. 옛 `state-changed` 와 *함께* 호출 (orchestrator
   * 가 양쪽 emit). schema 호환은 `state-changed` 의 `state` 필드에 phase 문자열을
   * 그대로 dispatch 하는 것으로 유지 — 본 신호는 prev/round/현재 의견 정보 추가용.
   */
  emitMeetingPhaseChanged(
    payload: StreamMeetingPhaseChangedPayload,
  ): void {
    this.emit({ type: 'stream:meeting-phase-changed', payload });
  }

  /**
   * R12-C2 T13 — B1 NextStep 카드 분류 결과 통지. orchestrator 가 매 turn
   * (그리고 phase 경계) 호출 후 발사. payload.capOverride 가 true 면 §11.18.8d
   * cap interlock 발동 — renderer 가 사용자 호출 Notification + auto-end UX.
   */
  emitNextStepClassified(
    payload: StreamNextStepClassifiedPayload,
  ): void {
    this.emit({ type: 'stream:next-step-classified', payload });
  }

  emitMeetingTurnStart(payload: StreamMeetingTurnStartPayload): void {
    this.emit({ type: 'stream:meeting-turn-start', payload });
  }

  emitMeetingTurnToken(payload: StreamMeetingTurnTokenPayload): void {
    this.emit({ type: 'stream:meeting-turn-token', payload });
  }

  emitMeetingTurnDone(payload: StreamMeetingTurnDonePayload): void {
    this.emit({ type: 'stream:meeting-turn-done', payload });
  }

  emitMeetingError(payload: StreamMeetingErrorPayload): void {
    this.emit({ type: 'stream:meeting-error', payload });
  }

  emitMeetingTurnSkipped(payload: StreamMeetingTurnSkippedPayload): void {
    this.emit({ type: 'stream:meeting-turn-skipped', payload });
  }

  emitQueueUpdated(payload: StreamQueueUpdatedPayload): void {
    this.emit({ type: 'stream:queue-updated', payload });
  }

  emitMemberStatusChanged(payload: StreamMemberStatusChangedPayload): void {
    this.emit({ type: 'stream:member-status-changed', payload });
  }

  emitNotification(payload: StreamNotificationPayload): void {
    this.emit({ type: 'stream:notification', payload });
  }

  emitNotificationPrefsChanged(
    payload: StreamNotificationPrefsChangedPayload,
  ): void {
    this.emit({ type: 'stream:notification-prefs-changed', payload });
  }

  emitAutonomyModeChanged(
    payload: StreamAutonomyModeChangedPayload,
  ): void {
    this.emit({ type: 'stream:autonomy-mode-changed', payload });
  }

  /**
   * R12-C2 T19 — H1 dashboard 패널의 1 분 TTL 캐시 invalidate 신호.
   *
   * RunStepService 의 `'appended'` 이벤트가 자동으로 본 helper 를 호출
   * (connect()) — 본 helper 의 직접 호출은 *비-RunStep 발사 source* 가
   * 진행률을 invalidate 시켜야 할 때만 사용 (예: T22 일반 채널 RunStep
   * 분기, T40 dashboard 첫 mount fan-out).
   *
   * payload 는 *signal-only* — renderer 가 받으면 `dashboard:progress-
   * snapshot` IPC 재호출. spec §11.21.4.
   */
  emitDashboardProgressChanged(
    payload: StreamDashboardProgressChangedPayload,
  ): void {
    this.emit({ type: 'stream:dashboard-progress-changed', payload });
  }

  /**
   * R12-C2 T28 — `handoff_mode='check'` 분기 시 사용자 결재 모달 trigger.
   * orchestrator 가 chain resolver outcome.kind='chain_resolved' + receiver
   * channel.handoff_mode='check' 분기에서 1 회 발사. renderer 가
   * HandoffApprovalModal 을 stream subscribe → 자동 surface. spec §11.18.8c.
   */
  emitHandoffRequired(
    payload: import('../../shared/stream-events').StreamHandoffRequiredPayload,
  ): void {
    this.emit({ type: 'stream:handoff-required', payload });
  }

  /**
   * R12-C2 T28 — handoff_dispatch row 영속 직후 통지. 'auto' 분기 (orchestrator
   * 가 즉시 dispatch) + 'check' 분기 [확인] 후 (IPC handler 가 dispatch) 모두
   * 동일 emit. 받는 채널 unread badge / sidebar dot 갱신 trigger.
   */
  emitHandoffDispatched(
    payload: import('../../shared/stream-events').StreamHandoffDispatchedPayload,
  ): void {
    this.emit({ type: 'stream:handoff-dispatched', payload });
  }

  /**
   * R12-C2 T28 — 'check' 분기 모달 [취소] 또는 회의 abort 시 pending state cleanup
   * + 모달 닫기 trigger. dispatch 호출 X.
   */
  emitHandoffRejected(
    payload: import('../../shared/stream-events').StreamHandoffRejectedPayload,
  ): void {
    this.emit({ type: 'stream:handoff-rejected', payload });
  }

  /**
   * R12-C2 T15 — idea-workflow awaiting_user_pick phase 진입 시 1 회 push.
   * UI (renderer SsmBox idea variant — T18) 가 카드 list + 선택 체크 +
   * 코멘트 textarea 활성화. spec §11.13 / §5.1.
   */
  emitIdeaPickSnapshot(
    payload: StreamIdeaPickSnapshotPayload,
  ): void {
    this.emit({ type: 'stream:idea-pick-snapshot', payload });
  }

  /**
   * R12-C2 T16 — design-workflow assigning_designated_task phase 진입 시
   * 1 회 push. UI (renderer SsmBox design variant — T18) 가 inline progress
   * ("UX 가 와이어프레임 작성 중...") 표시. spec §5.2 / §11.18.8.
   */
  emitDesignedTaskAssigned(
    payload: StreamDesignedTaskAssignedPayload,
  ): void {
    this.emit({ type: 'stream:designed-task-assigned', payload });
  }

  /**
   * R12-C2 T16 — design-workflow generating_snapshot phase 완료 시 1 회 push.
   * UI (DesignPreview — T16c) 가 desktop / mobile PNG 탭 surface 활성화.
   * spec §5.2 / §11.18.8c.
   */
  emitDesignSnapshotReady(
    payload: StreamDesignSnapshotReadyPayload,
  ): void {
    this.emit({ type: 'stream:design-snapshot-ready', payload });
  }

  // ── Introspection (tests / diagnostics) ───────────────────────────

  /**
   * Returns true when the given `type` is inside its 30s cooldown.
   * Exposed so callers (tests / diagnostics / the renderer via a
   * future IPC) can surface "you are muted" to humans. Production code
   * should NOT use this to pre-filter emits — `emit()` handles the
   * drop itself.
   */
  isCoolingDown(type: StreamEventType): boolean {
    const state = this.failures.get(type);
    if (!state) return false;
    if (state.until === 0) return false;
    if (Date.now() < state.until) return true;
    // Window elapsed — clear so the next failure starts a fresh streak.
    this.failures.delete(type);
    return false;
  }

  /**
   * Release the cooldown for `type` (or all types when omitted).
   * Intended for tests + operator-level recovery tools; production flow
   * expects the 30s window to self-expire.
   */
  resetCooldown(type?: StreamEventType): void {
    if (type === undefined) {
      this.failures.clear();
      return;
    }
    this.failures.delete(type);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private isShapeValid(event: unknown): event is StreamEvent {
    if (event === null || typeof event !== 'object') return false;
    const candidate = event as { type?: unknown; payload?: unknown };
    if (typeof candidate.type !== 'string') return false;
    if (!KNOWN_EVENT_TYPES.has(candidate.type as StreamEventType)) return false;
    if (candidate.payload === null || typeof candidate.payload !== 'object') {
      return false;
    }
    return this.isPayloadValidForType(
      candidate.type as StreamEventType,
      candidate.payload as Record<string, unknown>,
    );
  }

  /**
   * Per-type minimum-shape check. Kept to REQUIRED fields only — the
   * bridge does NOT guard every nested field because the services that
   * feed it already validated their writes. We just want a cheap
   * "looks right enough to wire" gate that blocks accidents like a
   * missing payload field or an off-by-one refactor.
   */
  private isPayloadValidForType(
    type: StreamEventType,
    payload: Record<string, unknown>,
  ): boolean {
    switch (type) {
      case 'stream:channel-message':
        return this.isObject(payload.message);
      case 'stream:member-status-changed':
        return (
          typeof payload.providerId === 'string' &&
          typeof payload.status === 'string' &&
          typeof payload.cause === 'string' &&
          this.isObject(payload.member)
        );
      case 'stream:approval-created':
        return this.isObject(payload.item);
      case 'stream:approval-decided':
        return (
          this.isObject(payload.item) &&
          typeof payload.decision === 'string'
        );
      case 'stream:project-updated':
        return this.isObject(payload.project);
      case 'stream:meeting-state-changed':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.state === 'string'
        );
      case 'stream:meeting-phase-changed':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          (payload.prevPhase === null ||
            typeof payload.prevPhase === 'string') &&
          typeof payload.phase === 'string' &&
          typeof payload.round === 'number' &&
          (payload.currentOpinionScreenId === null ||
            typeof payload.currentOpinionScreenId === 'string')
        );
      case 'stream:next-step-classified':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.runStepId === 'string' &&
          typeof payload.phase === 'string' &&
          typeof payload.round === 'number' &&
          typeof payload.turnIndex === 'number' &&
          typeof payload.card === 'string' &&
          typeof payload.capOverride === 'boolean'
        );
      case 'stream:meeting-turn-start':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.speakerId === 'string' &&
          typeof payload.messageId === 'string'
        );
      case 'stream:meeting-turn-token':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.messageId === 'string' &&
          typeof payload.token === 'string' &&
          typeof payload.cumulative === 'string' &&
          typeof payload.sequence === 'number'
        );
      case 'stream:meeting-turn-done':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.messageId === 'string' &&
          typeof payload.totalTokens === 'number'
        );
      case 'stream:meeting-error':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.error === 'string' &&
          typeof payload.fatal === 'boolean' &&
          (payload.messageId === undefined ||
            typeof payload.messageId === 'string') &&
          (payload.speakerId === undefined ||
            typeof payload.speakerId === 'string')
        );
      case 'stream:queue-updated':
        return (
          typeof payload.projectId === 'string' &&
          Array.isArray(payload.items) &&
          typeof payload.paused === 'boolean'
        );
      case 'stream:meeting-turn-skipped':
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.channelId === 'string' &&
          typeof payload.participantId === 'string' &&
          typeof payload.reason === 'string'
        );
      case 'stream:notification':
        return (
          typeof payload.id === 'string' &&
          typeof payload.kind === 'string' &&
          typeof payload.title === 'string'
        );
      case 'stream:notification-clicked':
        return (
          typeof payload.id === 'string' &&
          typeof payload.kind === 'string'
        );
      case 'stream:notification-prefs-changed':
        return this.isObject(payload.prefs);
      case 'stream:autonomy-mode-changed':
        return (
          typeof payload.projectId === 'string' &&
          typeof payload.mode === 'string'
        );
      case 'stream:dashboard-progress-changed':
        // R12-C2 T19 — signal-only payload. projectId 식별자 + 디버깅용
        // sourceChannelId 만 검증.
        return (
          typeof payload.projectId === 'string' &&
          typeof payload.sourceChannelId === 'string'
        );
      case 'stream:handoff-required':
        // R12-C2 T28 — 'check' 분기 결재 모달 trigger.
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.senderChannelId === 'string' &&
          typeof payload.targetChannelId === 'string' &&
          typeof payload.packageJson === 'string' &&
          (payload.minutesPath === null ||
            typeof payload.minutesPath === 'string') &&
          typeof payload.dispatchedAt === 'number'
        );
      case 'stream:handoff-dispatched':
        // R12-C2 T28 — dispatch 직후 받는 채널 unread badge 갱신.
        return (
          typeof payload.meetingId === 'string' &&
          typeof payload.dispatchRowId === 'string' &&
          typeof payload.senderChannelId === 'string' &&
          typeof payload.targetChannelId === 'string' &&
          (payload.mode === 'check' || payload.mode === 'auto') &&
          typeof payload.dispatchedAt === 'number'
        );
      case 'stream:handoff-rejected':
        // R12-C2 T28 — 'check' 분기 [취소] 또는 회의 abort 시 pending cleanup.
        return (
          typeof payload.meetingId === 'string' &&
          (payload.reason === 'user_canceled' ||
            payload.reason === 'meeting_aborted')
        );
      default:
        return false;
    }
  }

  private isObject(value: unknown): boolean {
    return value !== null && typeof value === 'object';
  }

  private extractTypeBucket(event: unknown): string {
    if (event && typeof event === 'object') {
      const t = (event as { type?: unknown }).type;
      if (typeof t === 'string') return t;
    }
    return UNKNOWN_TYPE_BUCKET;
  }

  private recordFailure(bucket: string): void {
    const state: FailureState = this.failures.get(bucket) ?? {
      count: 0,
      until: 0,
    };
    state.count += 1;
    if (state.count >= STREAM_FAILURE_THRESHOLD) {
      state.until = Date.now() + STREAM_COOLDOWN_MS;
      state.count = 0;
    }
    this.failures.set(bucket, state);
  }

  // ── Listener-side adapters (defensive coercion) ───────────────────

  private asApprovalCreated(payload: unknown): StreamApprovalCreatedPayload {
    if (
      payload &&
      typeof payload === 'object' &&
      'item' in (payload as object)
    ) {
      return payload as StreamApprovalCreatedPayload;
    }
    // ApprovalService emits the item directly for `'created'` — wrap it
    // so the stream contract stays { item } across the renderer surface.
    return { item: payload } as StreamApprovalCreatedPayload;
  }

  private asApprovalDecided(payload: unknown): StreamApprovalDecidedPayload {
    const record = (payload ?? {}) as Record<string, unknown>;
    return {
      item: record.item as StreamApprovalDecidedPayload['item'],
      decision: record.decision as StreamApprovalDecidedPayload['decision'],
      comment:
        typeof record.comment === 'string'
          ? record.comment
          : record.comment == null
            ? null
            : null,
    };
  }
}
