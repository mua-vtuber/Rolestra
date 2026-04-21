// @vitest-environment jsdom
/**
 * useMeetingStream tests.
 *
 * The hook subscribes to 5 stream:* event types via `window.arena.onStream`.
 * We stub that API with a local registry so the test can emit events
 * synchronously and assert the derived hook state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMeetingStream } from '../use-meeting-stream';
import type {
  StreamEventType,
  StreamV3PayloadOf,
} from '../../../shared/stream-events';

type Handler = (payload: unknown) => void;

function createStreamStub() {
  const handlers = new Map<StreamEventType, Set<Handler>>();

  function onStream<T extends StreamEventType>(
    type: T,
    cb: (payload: StreamV3PayloadOf<T>) => void,
  ): () => void {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    set.add(cb as Handler);
    return () => {
      set!.delete(cb as Handler);
    };
  }

  function emit<T extends StreamEventType>(
    type: T,
    payload: StreamV3PayloadOf<T>,
  ): void {
    const set = handlers.get(type);
    if (!set) return;
    for (const cb of set) cb(payload);
  }

  return { onStream, emit, handlers };
}

declare global {
  interface Window {
    arena?: {
      readonly platform: string;
      invoke: (...args: unknown[]) => Promise<unknown>;
      onStream?: <T extends StreamEventType>(
        type: T,
        cb: (payload: StreamV3PayloadOf<T>) => void,
      ) => () => void;
    };
  }
}

describe('useMeetingStream', () => {
  let stub: ReturnType<typeof createStreamStub>;

  beforeEach(() => {
    stub = createStreamStub();
    Object.defineProperty(window, 'arena', {
      configurable: true,
      writable: true,
      value: {
        platform: 'linux',
        invoke: async () => ({}),
        onStream: stub.onStream,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'arena', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('idle shape when channelId is null', () => {
    const { result } = renderHook(() => useMeetingStream(null));
    expect(result.current.liveTurns).toEqual([]);
    expect(result.current.ssmState).toBeNull();
    expect(result.current.activeMeetingId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('tracks turn-start / token / done lifecycle for matching channel', () => {
    const { result } = renderHook(() => useMeetingStream('ch-1'));

    act(() => {
      stub.emit('stream:meeting-turn-start', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        speakerId: 'ai-1',
        messageId: 'msg-1',
      });
    });

    expect(result.current.activeMeetingId).toBe('mt-1');
    expect(result.current.liveTurns).toHaveLength(1);
    expect(result.current.liveTurns[0].cumulative).toBe('');

    act(() => {
      stub.emit('stream:meeting-turn-token', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        messageId: 'msg-1',
        token: 'Hell',
        cumulative: 'Hell',
        sequence: 0,
      });
      stub.emit('stream:meeting-turn-token', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        messageId: 'msg-1',
        token: 'o',
        cumulative: 'Hello',
        sequence: 1,
      });
    });

    expect(result.current.liveTurns[0].cumulative).toBe('Hello');
    expect(result.current.liveTurns[0].sequence).toBe(1);

    act(() => {
      stub.emit('stream:meeting-turn-done', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        messageId: 'msg-1',
        totalTokens: 42,
      });
    });

    expect(result.current.liveTurns).toHaveLength(0);
  });

  it('ignores events from other channels', () => {
    const { result } = renderHook(() => useMeetingStream('ch-1'));
    act(() => {
      stub.emit('stream:meeting-turn-start', {
        meetingId: 'mt-2',
        channelId: 'ch-OTHER',
        speakerId: 'ai-1',
        messageId: 'msg-99',
      });
    });
    expect(result.current.liveTurns).toEqual([]);
    expect(result.current.activeMeetingId).toBeNull();
  });

  it('tracks state-changed events', () => {
    const { result } = renderHook(() => useMeetingStream('ch-1'));
    act(() => {
      stub.emit('stream:meeting-state-changed', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        state: 'WORK_DISCUSSING',
      });
    });
    expect(result.current.ssmState).toBe('WORK_DISCUSSING');
    expect(result.current.activeMeetingId).toBe('mt-1');
  });

  it('captures meeting-error + clearError resets', () => {
    const { result } = renderHook(() => useMeetingStream('ch-1'));
    act(() => {
      stub.emit('stream:meeting-error', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        error: 'provider down',
        fatal: true,
      });
    });
    expect(result.current.error).toEqual({
      message: 'provider down',
      fatal: true,
    });

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('supports concurrent turns in the same channel', () => {
    const { result } = renderHook(() => useMeetingStream('ch-1'));
    act(() => {
      stub.emit('stream:meeting-turn-start', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        speakerId: 'ai-1',
        messageId: 'msg-A',
      });
      stub.emit('stream:meeting-turn-start', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        speakerId: 'ai-2',
        messageId: 'msg-B',
      });
    });
    expect(result.current.liveTurns).toHaveLength(2);
    expect(result.current.liveTurns.map((t) => t.speakerId).sort()).toEqual([
      'ai-1',
      'ai-2',
    ]);
  });

  it('resets state when channelId changes to null', () => {
    const { result, rerender } = renderHook(
      ({ ch }: { ch: string | null }) => useMeetingStream(ch),
      { initialProps: { ch: 'ch-1' as string | null } },
    );

    act(() => {
      stub.emit('stream:meeting-state-changed', {
        meetingId: 'mt-1',
        channelId: 'ch-1',
        state: 'CONVERSATION',
      });
    });
    expect(result.current.ssmState).toBe('CONVERSATION');

    rerender({ ch: null });
    expect(result.current.ssmState).toBeNull();
    expect(result.current.activeMeetingId).toBeNull();
  });

  it('unsubscribes all handlers on unmount', () => {
    const { unmount } = renderHook(() => useMeetingStream('ch-1'));
    // Before unmount: 5 event types each have at least one handler.
    const before = Array.from(stub.handlers.values()).reduce(
      (n, s) => n + s.size,
      0,
    );
    expect(before).toBeGreaterThan(0);

    unmount();

    const after = Array.from(stub.handlers.values()).reduce(
      (n, s) => n + s.size,
      0,
    );
    expect(after).toBe(0);
  });
});
