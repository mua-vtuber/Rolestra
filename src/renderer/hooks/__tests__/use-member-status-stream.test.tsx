// @vitest-environment jsdom
/**
 * useMemberStatusStream tests (R10-Task10).
 *
 * Coverage:
 *   1. Stream push updates the reducer; consumers see the new MemberView.
 *   2. Stream + R8 invalidation co-fires (D9 dual-path).
 *   3. Empty providerId → no subscription, view=null.
 *   4. Multiple providers tracked independently.
 *   5. useAllMemberStatusStream sees every push.
 *
 * Mocks `window.arena.onStream` with a local registry (mirrors
 * `use-meeting-stream.test.tsx`) and the `channel-invalidation-bus`
 * module to assert dual-path co-firing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useMemberStatusStream,
  useAllMemberStatusStream,
  __resetMemberStatusStreamForTests,
} from '../use-member-status-stream';
import * as invalidationBus from '../channel-invalidation-bus';
import type {
  StreamEventType,
  StreamMemberStatusChangedPayload,
  StreamV3PayloadOf,
} from '../../../shared/stream-events';
import type { MemberView } from '../../../shared/member-profile-types';

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

function makeMemberView(
  id: string,
  status: MemberView['workStatus'] = 'online',
  displayName = 'Ada',
): MemberView {
  return {
    providerId: id,
    role: '',
    personality: '',
    expertise: '',
    avatarKind: 'default',
    avatarData: null,
    statusOverride: null,
    updatedAt: 1,
    displayName,
    persona: '',
    workStatus: status,
  };
}

function makePayload(
  id: string,
  status: MemberView['workStatus'] = 'online',
  cause: StreamMemberStatusChangedPayload['cause'] = 'warmup',
  displayName = 'Ada',
): StreamMemberStatusChangedPayload {
  return {
    providerId: id,
    member: makeMemberView(id, status, displayName),
    status,
    cause,
  };
}

describe('useMemberStatusStream (R10-Task10)', () => {
  let stub: ReturnType<typeof createStreamStub>;
  let notifySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetMemberStatusStreamForTests();
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
    // D9 coexistence: the hook must invoke notifyChannelsChanged on
    // each push so legacy mount-fetch consumers (R8 invalidation) stay
    // current. We spy here to assert co-firing in the relevant case.
    notifySpy = vi.spyOn(invalidationBus, 'notifyChannelsChanged');
  });

  afterEach(() => {
    Object.defineProperty(window, 'arena', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    notifySpy.mockRestore();
    __resetMemberStatusStreamForTests();
  });

  it('idle when providerId is empty (no subscription, view=null)', () => {
    const { result } = renderHook(() => useMemberStatusStream(''));
    expect(result.current.view).toBeNull();
    expect(result.current.status).toBeNull();
    // Reducer subscribers are still tracked via useSyncExternalStore,
    // but we never wired the stream — the registry is empty.
    expect(stub.handlers.get('stream:member-status-changed')).toBeUndefined();
  });

  it('updates view on a matching stream:member-status-changed push', () => {
    const { result } = renderHook(() => useMemberStatusStream('p1'));
    expect(result.current.view).toBeNull();

    act(() => {
      stub.emit('stream:member-status-changed', makePayload('p1', 'online'));
    });

    expect(result.current.view).not.toBeNull();
    expect(result.current.status).toBe('online');
    expect(result.current.view!.displayName).toBe('Ada');
  });

  it('D9 dual-path: stream push co-fires the channel invalidation bus', () => {
    renderHook(() => useMemberStatusStream('p1'));

    act(() => {
      stub.emit('stream:member-status-changed', makePayload('p1', 'connecting'));
    });

    // The legacy R8 invalidation surface must keep working — surfaces
    // that mount-fetch via useMembers / useMemberProfile pick up the
    // change on the same tick. This is the load-bearing assertion for
    // Decision D9.
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('only the watched providerId is reflected (different ids do not cross-pollinate the view return)', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useMemberStatusStream(id),
      { initialProps: { id: 'p1' } },
    );

    act(() => {
      stub.emit('stream:member-status-changed', makePayload('p2', 'online', 'warmup', 'Bea'));
    });

    // The reducer absorbed p2's view, but the consumer asked for p1
    // and gets null until p1's own push arrives.
    expect(result.current.view).toBeNull();

    // Switching the watched id surfaces the existing p2 row immediately.
    rerender({ id: 'p2' });
    expect(result.current.view?.displayName).toBe('Bea');
  });

  it('offline-manual cause="status" propagates correctly', () => {
    // Guards the manual-toggle path: the renderer must see status =
    // 'offline-manual' as a first-class workStatus, not "online + flag".
    const { result } = renderHook(() => useMemberStatusStream('p1'));

    act(() => {
      stub.emit(
        'stream:member-status-changed',
        makePayload('p1', 'offline-manual', 'status'),
      );
    });

    expect(result.current.status).toBe('offline-manual');
  });

  it('useAllMemberStatusStream sees every providerId pushed', () => {
    const { result } = renderHook(() => useAllMemberStatusStream());

    act(() => {
      stub.emit('stream:member-status-changed', makePayload('p1', 'online'));
      stub.emit(
        'stream:member-status-changed',
        makePayload('p2', 'connecting', 'warmup', 'Bea'),
      );
    });

    expect(result.current.members.size).toBe(2);
    expect(result.current.members.get('p1')?.workStatus).toBe('online');
    expect(result.current.members.get('p2')?.workStatus).toBe('connecting');
  });
});
