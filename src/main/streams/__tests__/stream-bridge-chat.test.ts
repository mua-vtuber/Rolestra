import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_STREAM_EVENTS, type StreamEvent } from '../../../shared/stream-events';
import { StreamBridge, STREAM_COOLDOWN_MS, STREAM_FAILURE_THRESHOLD } from '../stream-bridge';

const message = {
  id: 'm1', channelId: 'general', meetingId: null, authorId: 'user',
  authorKind: 'user' as const, role: 'user' as const, content: 'hello',
  meta: null, createdAt: 1,
};
const valid: StreamEvent = { type: 'stream:channel-message', payload: { message } };

describe('live chat StreamBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts only live stream types and isolates outbound listeners', () => {
    const bridge = new StreamBridge();
    const received: StreamEvent[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridge.onOutbound(() => { throw new Error('broken listener'); });
    const off = bridge.onOutbound((event) => received.push(event));
    expect(bridge.emit(valid)).toBe(true);
    expect(received).toEqual([valid]);
    expect(warn).toHaveBeenCalled();
    expect(bridge.emit({ type: 'stream:queue-updated', payload: {} })).toBe(false);
    expect(bridge.emit({ type: 'stream:channel-message', payload: {} })).toBe(false);
    expect([...LIVE_STREAM_EVENTS]).not.toContain('stream:meeting-turn-token');
    off();
    bridge.emit(valid);
    expect(received).toHaveLength(1);
  });

  it('cools down malformed events and recovers after the window', () => {
    vi.useFakeTimers();
    const bridge = new StreamBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const received: StreamEvent[] = [];
    bridge.onOutbound((event) => received.push(event));
    for (let n = 0; n < STREAM_FAILURE_THRESHOLD; n += 1) {
      expect(bridge.emit({ type: 'stream:channel-message', payload: {} })).toBe(false);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(true);
    expect(bridge.emit(valid)).toBe(false);
    vi.advanceTimersByTime(STREAM_COOLDOWN_MS);
    expect(bridge.emit(valid)).toBe(true);
    expect(received).toEqual([valid]);
    expect(warn).toHaveBeenCalledTimes(STREAM_FAILURE_THRESHOLD);
  });

  it('forwards the chat writing indicator and drops a malformed one (spec 2026-10-01 F5)', () => {
    const bridge = new StreamBridge();
    const responder = new EventEmitter();
    const received: StreamEvent[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridge.onOutbound((event) => received.push(event));
    bridge.connect({ chatResponder: { source: responder, activityEvent: 'activity', roundEvent: 'round' } });
    const turn = { channelId: 'room', providerId: 'ai-1', phase: 'writing', kind: 'turn' };
    const whisper = { channelId: 'room', providerId: 'ai-1', phase: 'idle', kind: 'whisper', peerProviderId: 'ai-2' };
    responder.emit('activity', turn);
    responder.emit('activity', whisper);
    responder.emit('activity', { ...turn, phase: 'typing' });
    responder.emit('activity', { ...whisper, peerProviderId: undefined });
    expect(received).toEqual([
      { type: 'stream:chat-activity', payload: turn },
      { type: 'stream:chat-activity', payload: whisper },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect([...LIVE_STREAM_EVENTS]).toContain('stream:chat-activity');
  });

  it('forwards the round signal and drops a malformed one (QA M1)', () => {
    const bridge = new StreamBridge();
    const responder = new EventEmitter();
    const received: StreamEvent[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridge.onOutbound((event) => received.push(event));
    bridge.connect({ chatResponder: { source: responder, activityEvent: 'activity', roundEvent: 'round' } });
    responder.emit('round', { channelId: 'room', active: true });
    responder.emit('round', { channelId: 'room', active: 'yes' });
    responder.emit('round', { active: false });
    responder.emit('round', { channelId: 'room', active: false });
    expect(received).toEqual([
      { type: 'stream:chat-round', payload: { channelId: 'room', active: true } },
      { type: 'stream:chat-round', payload: { channelId: 'room', active: false } },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect([...LIVE_STREAM_EVENTS]).toContain('stream:chat-round');
  });

  it('forwards message, member, and notification events', () => {
    const bridge = new StreamBridge();
    const messages = new EventEmitter();
    const members = new EventEmitter();
    const notifications = new EventEmitter();
    const received: StreamEvent[] = [];
    bridge.onOutbound((event) => received.push(event));
    bridge.connect({ messages, members, notifications });
    messages.emit('message', message);
    members.emit('status-changed', {
      providerId: 'ai-1', member: { workStatus: 'online' },
      status: 'online', cause: 'warmup',
    });
    notifications.emit('clicked', { id: 'n1', kind: 'new_message', channelId: 'general' });
    expect(received.map((event) => event.type)).toEqual([
      'stream:channel-message', 'stream:member-status-changed',
      'stream:notification-clicked',
    ]);
  });
});
