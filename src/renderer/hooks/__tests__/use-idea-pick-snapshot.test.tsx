// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useIdeaPickSnapshot } from '../use-idea-pick-snapshot';
import type {
  StreamEventType,
  StreamIdeaPickSnapshotPayload,
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

const SNAPSHOT: StreamIdeaPickSnapshotPayload = {
  meetingId: 'meeting-1',
  channelId: 'channel-1',
  cards: [
    {
      uuid: 'op-1',
      screenId: 'ITEM_001',
      title: '아이디어 A',
      content: '본문',
      rationale: '',
      authorLabel: 'codex_1',
    },
  ],
  selectedScreenIds: ['ITEM_001'],
};

describe('useIdeaPickSnapshot', () => {
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

  it('starts empty when no active channel is selected', () => {
    const { result } = renderHook(() => useIdeaPickSnapshot(null));
    expect(result.current).toBeNull();
  });

  it('tracks only idea-pick snapshots for the active channel', () => {
    const { result } = renderHook(() => useIdeaPickSnapshot('channel-1'));

    act(() => {
      stub.emit('stream:idea-pick-snapshot', {
        ...SNAPSHOT,
        channelId: 'channel-other',
      });
    });
    expect(result.current).toBeNull();

    act(() => {
      stub.emit('stream:idea-pick-snapshot', SNAPSHOT);
    });
    expect(result.current).toEqual(SNAPSHOT);
  });

  it('clears the snapshot when the active channel changes', () => {
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string | null }) =>
        useIdeaPickSnapshot(channelId),
      { initialProps: { channelId: 'channel-1' as string | null } },
    );

    act(() => {
      stub.emit('stream:idea-pick-snapshot', SNAPSHOT);
    });
    expect(result.current).toEqual(SNAPSHOT);

    rerender({ channelId: 'channel-2' });
    expect(result.current).toBeNull();
  });
});
