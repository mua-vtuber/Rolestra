/**
 * StreamBridge tests.
 *
 * Coverage map:
 *   1. service → bridge: MessageService.emit('message'),
 *      ApprovalService.emit('created'/'decided'), QueueService.emit('changed').
 *   2. onOutbound: multiple listeners fan-out + disposer.
 *   3. Shape validation: invalid events dropped with log.
 *   4. 5 consecutive failures → 30s cooldown; valid event mid-streak resets.
 *   5. Cooldown window elapses → emit accepted again.
 *   6. Listener exceptions do NOT stop other listeners.
 *
 * Time is advanced with `vi.useFakeTimers()` so the 30-second window
 * test runs synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  StreamBridge,
  STREAM_COOLDOWN_MS,
  STREAM_FAILURE_THRESHOLD,
} from '../stream-bridge';
import type { StreamEvent } from '../../../shared/stream-events';

function validChannelMessage(): StreamEvent {
  return {
    type: 'stream:channel-message',
    payload: {
      message: {
        id: 'm1',
        channelId: 'c1',
        meetingId: null,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'hi',
        meta: null,
        createdAt: 1,
      },
    },
  };
}

describe('StreamBridge — emit + validation', () => {
  let bridge: StreamBridge;
  let received: StreamEvent[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bridge = new StreamBridge();
    received = [];
    bridge.onOutbound((e) => received.push(e));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('delivers a valid event to every registered outbound listener', () => {
    const second: StreamEvent[] = [];
    bridge.onOutbound((e) => second.push(e));

    const ok = bridge.emit(validChannelMessage());

    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(received[0].type).toBe('stream:channel-message');
  });

  it('disposer removes the outbound listener', () => {
    const disposable: StreamEvent[] = [];
    const unsubscribe = bridge.onOutbound((e) => disposable.push(e));

    bridge.emit(validChannelMessage());
    expect(disposable).toHaveLength(1);

    unsubscribe();
    bridge.emit(validChannelMessage());
    expect(disposable).toHaveLength(1);
    expect(received).toHaveLength(2);
  });

  it('drops events with missing type', () => {
    bridge.emit({ payload: {} } as never);
    expect(received).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops events with unknown type', () => {
    bridge.emit({
      type: 'stream:bogus',
      payload: {},
    } as never);
    expect(received).toHaveLength(0);
  });

  it('drops events with missing required payload fields', () => {
    bridge.emit({
      type: 'stream:member-status-changed',
      payload: { providerId: 'ai-1' }, // status/member/cause missing
    } as never);
    expect(received).toHaveLength(0);

    bridge.emit({
      type: 'stream:meeting-state-changed',
      payload: { meetingId: 'm1', channelId: 'c1' }, // state missing
    } as never);
    expect(received).toHaveLength(0);
  });

  it('isolates listener exceptions so other listeners still fire', () => {
    const good: StreamEvent[] = [];
    bridge.onOutbound(() => {
      throw new Error('boom');
    });
    bridge.onOutbound((e) => good.push(e));

    bridge.emit(validChannelMessage());

    expect(good).toHaveLength(1);
    expect(received).toHaveLength(1);
    // Two warnings: listener-threw (ours + noop spy earlier doesn't count).
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('StreamBridge — cooldown', () => {
  let bridge: StreamBridge;
  let received: StreamEvent[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new StreamBridge();
    received = [];
    bridge.onOutbound((e) => received.push(e));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it(`${STREAM_FAILURE_THRESHOLD} invalid emits of same type trip the cooldown`, () => {
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(true);

    // A valid event is now silently dropped because of the cooldown.
    const ok = bridge.emit(validChannelMessage());
    expect(ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('cooldown expires after STREAM_COOLDOWN_MS', () => {
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(true);

    vi.advanceTimersByTime(STREAM_COOLDOWN_MS + 1);
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(false);

    const ok = bridge.emit(validChannelMessage());
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('valid event mid-streak resets failure counter', () => {
    // 4 failures → one short of threshold.
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD - 1; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(false);

    // A valid emit lands → streak reset.
    bridge.emit(validChannelMessage());

    // 4 more failures should NOT trip the cooldown now that the
    // streak restarted from 0.
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD - 1; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(false);
  });

  it('cooldown is scoped per type (one noisy type does not mute others)', () => {
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(true);
    expect(bridge.isCoolingDown('stream:approval-created')).toBe(false);

    // approval-created still works.
    bridge.emit({
      type: 'stream:approval-created',
      payload: { item: { id: 'a1' } },
    } as never);
    expect(received).toHaveLength(1);
  });

  it('resetCooldown() releases a specific type', () => {
    for (let i = 0; i < STREAM_FAILURE_THRESHOLD; i++) {
      bridge.emit({ type: 'stream:channel-message', payload: {} } as never);
    }
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(true);

    bridge.resetCooldown('stream:channel-message');
    expect(bridge.isCoolingDown('stream:channel-message')).toBe(false);

    const ok = bridge.emit(validChannelMessage());
    expect(ok).toBe(true);
  });
});

describe('StreamBridge — connect()', () => {
  let bridge: StreamBridge;
  let received: StreamEvent[];

  beforeEach(() => {
    bridge = new StreamBridge();
    received = [];
    bridge.onOutbound((e) => received.push(e));
  });

  it('MessageService.emit("message") → stream:channel-message', () => {
    const messages = new EventEmitter();
    bridge.connect({ messages });

    messages.emit('message', {
      id: 'm1',
      channelId: 'c1',
      meetingId: null,
      authorId: 'user',
      authorKind: 'user',
      role: 'user',
      content: 'hi',
      meta: null,
      createdAt: 1,
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:channel-message');
    expect(
      (received[0] as Extract<StreamEvent, { type: 'stream:channel-message' }>)
        .payload.message.content,
    ).toBe('hi');
  });

  it('MemberProfileService.emit("status-changed") → stream:member-status-changed (R10-Task10)', () => {
    const members = new EventEmitter();
    bridge.connect({ members });

    const member = {
      providerId: 'ai-1',
      role: 'Engineer',
      personality: 'Direct',
      expertise: 'SQLite',
      avatarKind: 'default' as const,
      avatarData: null,
      statusOverride: null,
      updatedAt: 1,
      displayName: 'Ada',
      persona: '',
      workStatus: 'online' as const,
    };

    members.emit('status-changed', {
      providerId: 'ai-1',
      member,
      status: 'online',
      cause: 'warmup',
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:member-status-changed');
    const payload = (
      received[0] as Extract<
        StreamEvent,
        { type: 'stream:member-status-changed' }
      >
    ).payload;
    expect(payload.providerId).toBe('ai-1');
    expect(payload.status).toBe('online');
    expect(payload.cause).toBe('warmup');
    expect(payload.member.displayName).toBe('Ada');
  });

  it('connect({members}) skips when no members emitter is provided (R10-Task10 backward-compat)', () => {
    bridge.connect({}); // no members
    // Bridge cannot drop something that was never emitted; this is a
    // smoke test that the connect call accepts the empty bag.
    expect(received).toHaveLength(0);
  });

  it('ApprovalService created/decided events → stream:approval-*', () => {
    const approvals = new EventEmitter();
    bridge.connect({ approvals });

    const item = {
      id: 'a1',
      kind: 'cli_permission' as const,
      projectId: 'p1',
      channelId: 'c1',
      messageId: null,
      requestedBy: 'ai-1',
      status: 'pending' as const,
      payloadJson: '{}',
      decisionComment: null,
      createdAt: 1,
      decidedAt: null,
    };

    approvals.emit('created', item);
    approvals.emit('decided', {
      item: { ...item, status: 'approved' },
      decision: 'approve',
      comment: null,
    });

    expect(received.map((e) => e.type)).toEqual([
      'stream:approval-created',
      'stream:approval-decided',
    ]);
  });

  it('QueueService "changed" hint is dropped without queueSnapshot', () => {
    const queue = new EventEmitter();
    const queueItemLookup = vi.fn();
    bridge.connect({ queue, queueItemLookup });

    // F6 cleanup retired the legacy per-item `stream:queue-progress`
    // fall-back. A `changed` hint without `queueSnapshot` cannot
    // produce a usable event and is silently dropped — production
    // wires `queueSnapshot` unconditionally, so this is the only
    // path that exercises the no-snapshot guard.
    queue.emit('changed', { id: 'q1' });

    expect(queueItemLookup).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
  });

  // ── R9-Task7: queueSnapshot path ───────────────────────────────────

  it('emits stream:queue-updated when queueSnapshot is provided (projectId hint)', () => {
    const queue = new EventEmitter();
    const queueSnapshot = vi.fn().mockReturnValue({
      items: [
        {
          id: 'q1',
          projectId: 'p1',
          targetChannelId: null,
          orderIndex: 1000,
          prompt: 'run',
          status: 'pending',
          startedMeetingId: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          createdAt: 1,
        },
      ],
      paused: false,
    });

    bridge.connect({ queue, queueSnapshot });
    queue.emit('changed', { projectId: 'p1' });

    expect(queueSnapshot).toHaveBeenCalledWith('p1');
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:queue-updated');
    expect(received[0].payload).toMatchObject({
      projectId: 'p1',
      paused: false,
    });
  });

  it('resolves {id} hint via queueItemLookup → projectId before snapshot', () => {
    const queue = new EventEmitter();
    const queueItemLookup = vi.fn().mockReturnValue({
      id: 'q1',
      projectId: 'p1',
    });
    const queueSnapshot = vi.fn().mockReturnValue({
      items: [],
      paused: true,
    });

    bridge.connect({ queue, queueItemLookup, queueSnapshot });
    queue.emit('changed', { id: 'q1' });

    expect(queueItemLookup).toHaveBeenCalledWith('q1');
    expect(queueSnapshot).toHaveBeenCalledWith('p1');
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:queue-updated');
    expect((received[0].payload as { paused: boolean }).paused).toBe(true);
  });

  it('ignores hint when snapshot is set but neither projectId nor lookup resolves', () => {
    const queue = new EventEmitter();
    const queueSnapshot = vi.fn();
    bridge.connect({ queue, queueSnapshot });

    queue.emit('changed', { id: 'unknown' });

    expect(queueSnapshot).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
  });
});

describe('StreamBridge — direct emit helpers', () => {
  it('emitProjectUpdated wraps + validates', () => {
    const bridge = new StreamBridge();
    const received: StreamEvent[] = [];
    bridge.onOutbound((e) => received.push(e));

    bridge.emitProjectUpdated({
      project: {
        id: 'p1',
        slug: 's',
        name: 'demo',
        description: '',
        kind: 'new',
        externalLink: null,
        permissionMode: 'hybrid',
        autonomyMode: 'manual',
        status: 'active',
        createdAt: 1,
        archivedAt: null,
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:project-updated');
  });

  it('emitNotification drops empty title (required-field guard)', () => {
    const bridge = new StreamBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received: StreamEvent[] = [];
    bridge.onOutbound((e) => received.push(e));

    bridge.emit({
      type: 'stream:notification',
      payload: {
        id: 'n1',
        kind: 'new_message',
        // title missing
        body: 'x',
        channelId: null,
      },
    } as never);

    expect(received).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('StreamBridge — R6 meeting turn events', () => {
  let bridge: StreamBridge;
  let received: StreamEvent[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bridge = new StreamBridge();
    received = [];
    bridge.onOutbound((e) => received.push(e));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('emitMeetingTurnStart round-trips', () => {
    bridge.emitMeetingTurnStart({
      meetingId: 'mt-1',
      channelId: 'c1',
      speakerId: 'ai-1',
      messageId: 'msg-1',
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stream:meeting-turn-start');
    const payload = (
      received[0] as Extract<StreamEvent, { type: 'stream:meeting-turn-start' }>
    ).payload;
    expect(payload.speakerId).toBe('ai-1');
  });

  it('emitMeetingTurnToken carries cumulative + sequence', () => {
    bridge.emitMeetingTurnToken({
      meetingId: 'mt-1',
      channelId: 'c1',
      messageId: 'msg-1',
      token: 'Hell',
      cumulative: 'Hell',
      sequence: 0,
    });
    bridge.emitMeetingTurnToken({
      meetingId: 'mt-1',
      channelId: 'c1',
      messageId: 'msg-1',
      token: 'o',
      cumulative: 'Hello',
      sequence: 1,
    });

    expect(received).toHaveLength(2);
    const second = received[1] as Extract<
      StreamEvent,
      { type: 'stream:meeting-turn-token' }
    >;
    expect(second.payload.cumulative).toBe('Hello');
    expect(second.payload.sequence).toBe(1);
  });

  it('emitMeetingTurnDone carries totalTokens', () => {
    bridge.emitMeetingTurnDone({
      meetingId: 'mt-1',
      channelId: 'c1',
      messageId: 'msg-1',
      totalTokens: 42,
    });

    expect(received).toHaveLength(1);
    const payload = (
      received[0] as Extract<StreamEvent, { type: 'stream:meeting-turn-done' }>
    ).payload;
    expect(payload.totalTokens).toBe(42);
  });

  it('emitMeetingError carries fatal flag', () => {
    bridge.emitMeetingError({
      meetingId: 'mt-1',
      channelId: 'c1',
      error: 'provider timeout',
      fatal: true,
    });

    expect(received).toHaveLength(1);
    const payload = (
      received[0] as Extract<StreamEvent, { type: 'stream:meeting-error' }>
    ).payload;
    expect(payload.fatal).toBe(true);
    expect(payload.error).toBe('provider timeout');
  });

  it('drops meeting turn-token with missing sequence field', () => {
    bridge.emit({
      type: 'stream:meeting-turn-token',
      payload: {
        meetingId: 'mt-1',
        channelId: 'c1',
        messageId: 'msg-1',
        token: 'x',
        cumulative: 'x',
        // sequence missing
      },
    } as never);

    expect(received).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops meeting error with non-boolean fatal', () => {
    bridge.emit({
      type: 'stream:meeting-error',
      payload: {
        meetingId: 'mt-1',
        channelId: 'c1',
        error: 'x',
        fatal: 'yes',
      },
    } as never);

    expect(received).toHaveLength(0);
  });

  it('turn event cooldown is scoped per-type', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < STREAM_FAILURE_THRESHOLD; i++) {
        bridge.emit({
          type: 'stream:meeting-turn-token',
          payload: {},
        } as never);
      }
      expect(bridge.isCoolingDown('stream:meeting-turn-token')).toBe(true);
      expect(bridge.isCoolingDown('stream:meeting-turn-start')).toBe(false);

      // Other turn event types still flow.
      bridge.emitMeetingTurnStart({
        meetingId: 'mt-1',
        channelId: 'c1',
        speakerId: 'ai-1',
        messageId: 'msg-1',
      });
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('stream:meeting-turn-start');
    } finally {
      vi.useRealTimers();
    }
  });
});
