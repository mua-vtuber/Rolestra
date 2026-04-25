// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMessageSearch } from '../use-message-search';
import type { MessageSearchHit } from '../../../shared/message-search-types';

/** Debounce is 200 ms; wait 250 ms to cross the edge in real-time tests. */
const DEBOUNCE_WAIT_MS = 250;
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function makeHit(id: string, snippet: string): MessageSearchHit {
  return {
    id,
    channelId: 'c1',
    meetingId: null,
    authorId: 'user',
    authorKind: 'user',
    role: 'user',
    content: 'full content',
    meta: null,
    createdAt: 1,
    rank: -2.5,
    snippet,
    channelName: 'general',
    projectName: 'Alpha',
  };
}

describe('useMessageSearch', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('skips the IPC call for an empty query and keeps hits empty', () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useMessageSearch({ kind: 'project', projectId: 'p1' }),
    );

    expect(result.current.query).toBe('');
    expect(result.current.hits).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('debounces input and issues one IPC call after the window', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ hits: [makeHit('m1', '<mark>foo</mark>')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useMessageSearch({ kind: 'project', projectId: 'p1' }),
    );

    act(() => result.current.setQuery('f'));
    act(() => result.current.setQuery('fo'));
    act(() => result.current.setQuery('foo'));

    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).toHaveBeenCalledTimes(1);
    const [[channel, payload]] = invoke.mock.calls;
    expect(channel).toBe('message:search');
    expect(payload).toMatchObject({
      query: 'foo',
      scope: { kind: 'project', projectId: 'p1' },
    });
    expect(result.current.hits).toHaveLength(1);
  });

  it('drops out-of-order responses via the monotonic token', async () => {
    const defer = <T,>(): { promise: Promise<T>; resolve: (v: T) => void } => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const firstDefer = defer<{ hits: MessageSearchHit[] }>();
    const secondDefer = defer<{ hits: MessageSearchHit[] }>();
    const invoke = vi
      .fn()
      .mockImplementationOnce(() => firstDefer.promise)
      .mockImplementationOnce(() => secondDefer.promise);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useMessageSearch({ kind: 'project', projectId: 'p1' }),
    );

    act(() => result.current.setQuery('one'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });

    act(() => result.current.setQuery('two'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });

    // Resolve the older response LAST — must not overwrite the newer one.
    secondDefer.resolve({ hits: [makeHit('m2', 'latest')] });
    await waitFor(() => expect(result.current.hits[0]?.id).toBe('m2'));

    firstDefer.resolve({ hits: [makeHit('m1', 'stale')] });
    // Let stale resolver run without overwriting newer state.
    await act(async () => {
      await sleep(30);
    });
    expect(result.current.hits[0]?.id).toBe('m2');
  });

  it('surfaces errors and keeps previous hits on failure', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ hits: [makeHit('m1', 'ok')] })
      .mockRejectedValueOnce(new Error('fts syntax error'));
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useMessageSearch({ kind: 'project', projectId: 'p1' }),
    );

    act(() => result.current.setQuery('first'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    act(() => result.current.setQuery('bad syntax *'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });

    await waitFor(() => expect(result.current.error?.message).toContain('fts'));
    expect(result.current.hits).toHaveLength(1); // kept
    expect(result.current.hits[0]?.id).toBe('m1');
  });

  it('clear() resets query, hits, error, loading', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ hits: [makeHit('m1', 'data')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useMessageSearch({ kind: 'project', projectId: 'p1' }),
    );

    act(() => result.current.setQuery('hit'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    act(() => result.current.clear());
    expect(result.current.query).toBe('');
    expect(result.current.hits).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('global scope throws before invoking IPC', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useMessageSearch('global'));

    act(() => result.current.setQuery('anything'));
    await act(async () => {
      await sleep(DEBOUNCE_WAIT_MS);
    });

    await waitFor(() =>
      expect(result.current.error?.message).toContain('global scope'),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
