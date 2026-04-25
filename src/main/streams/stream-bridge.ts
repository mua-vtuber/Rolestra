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
  StreamMeetingTurnStartPayload,
  StreamMeetingTurnTokenPayload,
  StreamMeetingTurnDonePayload,
  StreamMeetingErrorPayload,
  StreamMeetingTurnSkippedPayload,
  StreamQueueProgressPayload,
  StreamQueueUpdatedPayload,
  StreamMemberStatusChangedPayload,
  StreamNotificationPayload,
  StreamNotificationClickedPayload,
  StreamNotificationPrefsChangedPayload,
  StreamAutonomyModeChangedPayload,
} from '../../shared/stream-events';

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
  'stream:meeting-turn-start',
  'stream:meeting-turn-token',
  'stream:meeting-turn-done',
  'stream:meeting-error',
  'stream:meeting-turn-skipped',
  'stream:queue-progress',
  'stream:queue-updated',
  'stream:notification',
  'stream:notification-clicked',
  'stream:notification-prefs-changed',
  'stream:autonomy-mode-changed',
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
   * Optional lookup so the bridge can expand `QueueChangedEvent`
   * (project-scope hint) into full `QueueItem` payloads. If omitted,
   * single-item 'changed' events emit a stream:queue-progress using
   * the `id` hint; project-wide hints are skipped.
   */
  queueItemLookup?: (id: string) => { projectId: string; id: string } | null;
  /**
   * R9-Task7: full-snapshot lookup. When provided, `changed` events are
   * fanned out as `stream:queue-updated` (project-level list + paused
   * flag) instead of the per-item `stream:queue-progress` fall-back.
   * The renderer's `useQueue` hook subscribes to `stream:queue-updated`
   * only, so the snapshot path is the R9 authoritative surface.
   *
   * When both `queueItemLookup` and `queueSnapshot` are provided, the
   * snapshot path wins. The `queueItemLookup` is still used to resolve
   * the `{id}`-form hint to its owning `projectId` so single-row events
   * (complete / in_progress cancel) reach the right snapshot.
   */
  queueSnapshot?: (projectId: string) => {
    items: QueueItem[];
    paused: boolean;
  };
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
        // project-scoped.
        if (services.queueSnapshot) {
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
          return;
        }

        // Legacy R2 path — per-item `stream:queue-progress`. Retained
        // so existing smoke-wire fixtures (r2-integration-smoke) keep
        // working while callers migrate to the snapshot path.
        const lookup = services.queueItemLookup;
        if (!lookup) return;
        if (!h?.id) return;
        const item = lookup(h.id);
        if (!item) return;
        this.emit({
          type: 'stream:queue-progress',
          payload: { item } as StreamQueueProgressPayload,
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

  emitQueueProgress(payload: StreamQueueProgressPayload): void {
    this.emit({ type: 'stream:queue-progress', payload });
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
          typeof payload.fatal === 'boolean'
        );
      case 'stream:queue-progress':
        return this.isObject(payload.item);
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
