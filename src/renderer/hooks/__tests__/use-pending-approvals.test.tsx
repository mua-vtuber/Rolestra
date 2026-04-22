// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingApprovals } from '../use-pending-approvals';
import type { ApprovalItem } from '../../../shared/approval-types';

const SAMPLE: ApprovalItem = {
  id: 'a1',
  kind: 'cli_permission',
  projectId: null,
  channelId: null,
  meetingId: null,
  requesterId: null,
  payload: { command: 'ls' },
  status: 'pending',
  decisionComment: null,
  createdAt: 1700000000000,
  decidedAt: null,
};

const SAMPLE_2: ApprovalItem = {
  ...SAMPLE,
  id: 'a2',
  createdAt: 1700000001000,
};

/**
 * Minimal `onStream` stub capturing subscriptions so tests can fire events.
 * Returns a trigger-fn and a ready-made arena bridge to install via stubGlobal.
 */
function makeStreamHarness() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const onStream = vi.fn((type: string, cb: (payload: unknown) => void) => {
    let bucket = listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      listeners.set(type, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  });
  const trigger = (type: string, payload: unknown): void => {
    const bucket = listeners.get(type);
    bucket?.forEach((cb) => cb(payload));
  };
  return { onStream, trigger, listeners };
}

describe('usePendingApprovals', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('success path: calls approval:list with status=pending and populates items', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => usePendingApprovals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledWith('approval:list', {
      status: 'pending',
    });
    expect(result.current.items).toEqual([SAMPLE]);
  });

  it('error path: surfaces the error and keeps items null', async () => {
    const failure = new Error('db down');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => usePendingApprovals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.items).toBeNull();
  });

  it('stream: prepends created approvals on top of the fetched list', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE] });
    const { onStream, trigger } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([SAMPLE]);

    act(() => {
      trigger('stream:approval-created', { item: SAMPLE_2 });
    });

    expect(result.current.items).toEqual([SAMPLE_2, SAMPLE]);
  });

  it('stream: dedupes when a created event lands for an id already present', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE] });
    const { onStream, trigger } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      trigger('stream:approval-created', { item: SAMPLE });
    });

    expect(result.current.items).toEqual([SAMPLE]);
  });

  it('stream: ignores non-pending items from created events', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [] });
    const { onStream, trigger } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      trigger('stream:approval-created', {
        item: { ...SAMPLE, status: 'approved' as const, decidedAt: 1 },
      });
    });

    expect(result.current.items).toEqual([]);
  });

  it('stream: removes decided items from the pending list', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE, SAMPLE_2] });
    const { onStream, trigger } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(2);

    act(() => {
      trigger('stream:approval-decided', {
        item: { ...SAMPLE, status: 'approved' as const, decidedAt: 2 },
        decision: 'approve',
        comment: null,
      });
    });

    expect(result.current.items).toEqual([SAMPLE_2]);
  });

  it('projectId filter: passes projectId through to approval:list', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => usePendingApprovals('p-filter'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(bridgeInvoke).toHaveBeenCalledWith('approval:list', {
      status: 'pending',
      projectId: 'p-filter',
    });
  });

  it('projectId filter: ignores stream:approval-created for other projects', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [] });
    const { onStream, trigger } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { result } = renderHook(() => usePendingApprovals('p-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      trigger('stream:approval-created', {
        item: { ...SAMPLE, id: 'a-other', projectId: 'p-2' },
      });
    });
    expect(result.current.items).toEqual([]);

    act(() => {
      trigger('stream:approval-created', {
        item: { ...SAMPLE, id: 'a-mine', projectId: 'p-1' },
      });
    });
    expect(result.current.items?.map((x) => x.id)).toEqual(['a-mine']);
  });

  it('stream: unsubscribes on unmount (no listener leak)', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [] });
    const { onStream, listeners } = makeStreamHarness();
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: bridgeInvoke,
      onStream,
    });

    const { unmount } = renderHook(() => usePendingApprovals());
    await waitFor(() => {
      expect(listeners.get('stream:approval-created')?.size).toBe(1);
      expect(listeners.get('stream:approval-decided')?.size).toBe(1);
    });

    unmount();

    expect(listeners.get('stream:approval-created')?.size ?? 0).toBe(0);
    expect(listeners.get('stream:approval-decided')?.size ?? 0).toBe(0);
  });
});
