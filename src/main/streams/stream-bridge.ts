/** Validated Main → Renderer event bridge for live chat services. */
import type { EventEmitter } from 'node:events';
import {
  CHAT_ACTIVITY_PHASES,
  LIVE_STREAM_EVENTS,
  type StreamChatActivityPayload,
  type StreamChatRoundPayload,
  type StreamEvent,
  type StreamEventType,
  type StreamChannelMessagePayload,
  type StreamMemberStatusChangedPayload,
  type StreamNotificationPayload,
  type StreamNotificationClickedPayload,
  type StreamNotificationPrefsChangedPayload,
} from '../../shared/stream-events';

export type StreamOutboundListener = (event: StreamEvent) => void;
export const STREAM_FAILURE_THRESHOLD = 5;
export const STREAM_COOLDOWN_MS = 30_000;
const UNKNOWN_TYPE_BUCKET = '__unknown__';
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(LIVE_STREAM_EVENTS);

export interface StreamBridgeServices {
  messages?: EventEmitter;
  notifications?: EventEmitter;
  members?: EventEmitter;
  /**
   * The chat responder: its writing-indicator events become
   * `stream:chat-activity` (spec 2026-10-01 F5) and its round events
   * `stream:chat-round` (QA M1). Event names are passed in so this module
   * does not import the responder.
   */
  chatResponder?: { source: EventEmitter; activityEvent: string; roundEvent: string };
}

interface FailureState {
  count: number;
  until: number;
}

export class StreamBridge {
  private readonly outbound: StreamOutboundListener[] = [];
  private readonly failures = new Map<string, FailureState>();

  onOutbound(fn: StreamOutboundListener): () => void {
    this.outbound.push(fn);
    return () => {
      const index = this.outbound.indexOf(fn);
      if (index >= 0) this.outbound.splice(index, 1);
    };
  }

  emit(event: StreamEvent | unknown): boolean {
    if (!this.isShapeValid(event)) {
      const bucket = this.extractTypeBucket(event);
      this.recordFailure(bucket);
      console.warn('[rolestra.stream-bridge] dropped invalid event', { bucket });
      return false;
    }

    if (this.isCoolingDown(event.type)) return false;
    this.failures.delete(event.type);
    for (const fn of this.outbound) {
      try {
        fn(event);
      } catch (err) {
        console.warn('[rolestra.stream-bridge] outbound listener threw:', {
          type: event.type,
          name: err instanceof Error ? err.name : undefined,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return true;
  }

  connect(services: StreamBridgeServices): void {
    services.messages?.on('message', (message: unknown) => {
      this.emit({ type: 'stream:channel-message', payload: { message } });
    });
    services.notifications?.on('clicked', (payload: unknown) => {
      this.emit({
        type: 'stream:notification-clicked',
        payload: payload as StreamNotificationClickedPayload,
      });
    });
    services.members?.on('status-changed', (payload: unknown) => {
      this.emit({
        type: 'stream:member-status-changed',
        payload: payload as StreamMemberStatusChangedPayload,
      });
    });
    const responder = services.chatResponder;
    responder?.source.on(responder.activityEvent, (payload: unknown) => {
      this.emit({ type: 'stream:chat-activity', payload: payload as StreamChatActivityPayload });
    });
    responder?.source.on(responder.roundEvent, (payload: unknown) => {
      this.emit({ type: 'stream:chat-round', payload: payload as StreamChatRoundPayload });
    });
  }

  emitChannelMessage(payload: StreamChannelMessagePayload): void {
    this.emit({ type: 'stream:channel-message', payload });
  }

  emitMemberStatusChanged(payload: StreamMemberStatusChangedPayload): void {
    this.emit({ type: 'stream:member-status-changed', payload });
  }

  emitNotification(payload: StreamNotificationPayload): void {
    this.emit({ type: 'stream:notification', payload });
  }

  emitNotificationPrefsChanged(payload: StreamNotificationPrefsChangedPayload): void {
    this.emit({ type: 'stream:notification-prefs-changed', payload });
  }

  isCoolingDown(type: StreamEventType): boolean {
    const state = this.failures.get(type);
    if (!state || state.until === 0) return false;
    if (Date.now() < state.until) return true;
    this.failures.delete(type);
    return false;
  }

  resetCooldown(type?: StreamEventType): void {
    if (type === undefined) this.failures.clear();
    else this.failures.delete(type);
  }

  private isShapeValid(event: unknown): event is StreamEvent {
    if (event === null || typeof event !== 'object') return false;
    const candidate = event as { type?: unknown; payload?: unknown };
    if (typeof candidate.type !== 'string' || !KNOWN_EVENT_TYPES.has(candidate.type)) {
      return false;
    }
    if (candidate.payload === null || typeof candidate.payload !== 'object') {
      return false;
    }
    const payload = candidate.payload as Record<string, unknown>;
    switch (candidate.type) {
      case 'stream:channel-message':
        return this.isObject(payload.message);
      case 'stream:member-status-changed':
        return typeof payload.providerId === 'string'
          && this.isObject(payload.member)
          && typeof payload.status === 'string'
          && typeof payload.cause === 'string';
      case 'stream:notification':
        return typeof payload.id === 'string'
          && typeof payload.kind === 'string'
          && typeof payload.title === 'string'
          && typeof payload.body === 'string';
      case 'stream:notification-clicked':
        return typeof payload.id === 'string'
          && typeof payload.kind === 'string';
      case 'stream:notification-prefs-changed':
        return this.isObject(payload.prefs);
      case 'stream:chat-activity':
        return typeof payload.channelId === 'string'
          && typeof payload.providerId === 'string'
          && (CHAT_ACTIVITY_PHASES as readonly unknown[]).includes(payload.phase)
          && (payload.kind === 'turn'
            || (payload.kind === 'whisper' && typeof payload.peerProviderId === 'string'));
      case 'stream:chat-round':
        return typeof payload.channelId === 'string' && typeof payload.active === 'boolean';
      default:
        return false;
    }
  }

  private isObject(value: unknown): boolean {
    return value !== null && typeof value === 'object';
  }

  private extractTypeBucket(event: unknown): string {
    if (event && typeof event === 'object') {
      const type = (event as { type?: unknown }).type;
      if (typeof type === 'string') return type;
    }
    return UNKNOWN_TYPE_BUCKET;
  }

  private recordFailure(bucket: string): void {
    const state = this.failures.get(bucket) ?? { count: 0, until: 0 };
    state.count += 1;
    if (state.count >= STREAM_FAILURE_THRESHOLD) {
      state.until = Date.now() + STREAM_COOLDOWN_MS;
      state.count = 0;
    }
    this.failures.set(bucket, state);
  }
}
