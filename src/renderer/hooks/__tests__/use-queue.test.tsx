// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQueue } from '../use-queue';
import type { QueueItem } from '../../../shared/queue-types';

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    projectId: 'p1',
    targetChannelId: null,
    orderIndex: 0,
    prompt: 'do X',
    status: 'pending',
    startedMeetingId: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeRouter(
  routes: Record<string, (data: unknown) => unknown>,
): ReturnType<typeof vi.fn> {
  return vi.fn((channel: string, data: unknown) => {
    const handler = routes[channel];
    if (!handler) {
      return Promise.reject(new Error(`no mock for channel ${channel}`));
    }
    try {
      return Promise.resolve(handler(data));
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
}

function setupArena(invoke: ReturnType<typeof vi.fn>): {
  emit: (type: string, payload: unknown) => void;
} {
  const subs = new Map<string, ((p: unknown) => void)[]>();
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke,
    onStream: (type: string, cb: (p: unknown) => void) => {
      const list = subs.get(type) ?? [];
      list.push(cb);
      subs.set(type, list);
      return () => {
        subs.set(type, (subs.get(type) ?? []).filter((h) => h !== cb));
      };
    },
  });
  return {
    emit: (type, payload) =>
      (subs.get(type) ?? []).forEach((cb) => cb(payload)),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('useQueue — mount / fetch / stream', () => {
  it('mounts → calls queue:list(projectId) once and populates items', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [makeItem()] }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(invoke.mock.calls.filter((c) => c[0] === 'queue:list')).toHaveLength(1);
  });

  it('stream:queue-updated with matching projectId replaces items + paused', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [] }),
    });
    const { emit } = setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emit('stream:queue-updated', {
        projectId: 'p1',
        items: [makeItem({ id: 'q1' }), makeItem({ id: 'q2' })],
        paused: true,
      });
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.paused).toBe(true);
  });

  it('ignores stream updates for different projectId', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [makeItem()] }),
    });
    const { emit } = setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emit('stream:queue-updated', {
        projectId: 'other',
        items: [],
        paused: true,
      });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.paused).toBe(false);
  });
});

describe('useQueue — mutations', () => {
  it('addLines splits by newline and invokes queue:add N times in order', async () => {
    let listCall = 0;
    const invoke = makeRouter({
      'queue:list': () => ({ items: listCall++ === 0 ? [] : [makeItem()] }),
      'queue:add': (data) => ({ item: makeItem({ id: `q-${(data as { prompt: string }).prompt}` }) }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addLines('A\n  \nB\nC');
    });

    const addCalls = invoke.mock.calls.filter((c) => c[0] === 'queue:add');
    expect(addCalls).toHaveLength(3);
    expect((addCalls[0]?.[1] as { prompt: string }).prompt).toBe('A');
    expect((addCalls[1]?.[1] as { prompt: string }).prompt).toBe('B');
    expect((addCalls[2]?.[1] as { prompt: string }).prompt).toBe('C');
  });

  it('reorder invokes queue:reorder with given orderedIds', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [] }),
      'queue:reorder': () => ({ success: true }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reorder(['q2', 'q1', 'q3']);
    });

    const reorderCall = invoke.mock.calls.find((c) => c[0] === 'queue:reorder');
    expect(reorderCall?.[1]).toEqual({
      projectId: 'p1',
      orderedIds: ['q2', 'q1', 'q3'],
    });
  });

  it('pause / resume set the paused flag optimistically', async () => {
    const invoke = makeRouter({
      'queue:list': () => ({ items: [] }),
      'queue:pause': () => ({ success: true }),
      'queue:resume': () => ({ success: true }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.paused).toBe(true);

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.paused).toBe(false);
  });

  it('remove invokes queue:remove and triggers refresh', async () => {
    let listCall = 0;
    const invoke = makeRouter({
      'queue:list': () => ({
        items: listCall++ === 0 ? [makeItem()] : [],
      }),
      'queue:remove': () => ({ success: true }),
    });
    setupArena(invoke);

    const { result } = renderHook(() => useQueue('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove('q-1');
    });

    const removeCall = invoke.mock.calls.find((c) => c[0] === 'queue:remove');
    expect(removeCall?.[1]).toEqual({ id: 'q-1' });
  });
});
