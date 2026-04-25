// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardKpis } from '../use-dashboard-kpis';
import type { KpiSnapshot } from '../../../shared/dashboard-types';

const SNAPSHOT_A: KpiSnapshot = {
  activeProjects: 3,
  activeMeetings: 1,
  pendingApprovals: 0,
  completedToday: 5,
  asOf: 1_700_000_000_000,
};

const SNAPSHOT_B: KpiSnapshot = {
  activeProjects: 4,
  activeMeetings: 2,
  pendingApprovals: 1,
  completedToday: 6,
  asOf: 1_700_000_001_000,
};

describe('useDashboardKpis', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('issues exactly one IPC call on mount even under React strict mode', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ snapshot: SNAPSHOT_A });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useDashboardKpis(), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledTimes(1);
    expect(bridgeInvoke).toHaveBeenCalledWith('dashboard:get-kpis', {});
  });

  it('success path populates data, clears loading, keeps error null', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ snapshot: SNAPSHOT_A });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useDashboardKpis());

    // Initial synchronous render
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(SNAPSHOT_A);
    expect(result.current.error).toBeNull();
  });

  it('error path populates error, clears loading, keeps data=null (no stale fallback)', async () => {
    const failure = new Error('handler exploded');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useDashboardKpis());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it('refresh() replaces data and flips loading=true during the refetch', async () => {
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValueOnce({ snapshot: SNAPSHOT_A })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            // Defer resolution so we can observe loading=true mid-flight.
            setTimeout(() => resolve({ snapshot: SNAPSHOT_B }), 0);
          }),
      );
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useDashboardKpis());

    await waitFor(() => {
      expect(result.current.data).toEqual(SNAPSHOT_A);
    });
    expect(result.current.loading).toBe(false);

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    // During the refetch loading should be true.
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(SNAPSHOT_B);
    expect(bridgeInvoke).toHaveBeenCalledTimes(2);
  });

  // ── R10 Task 11 — stream-driven pendingApprovals counter ───────────
  describe('pendingApprovals stream patching (R10-Task11)', () => {
    interface StreamHandlers {
      'stream:approval-created'?: Array<(p: unknown) => void>;
      'stream:approval-decided'?: Array<(p: unknown) => void>;
    }

    function makeStreamingBridge(snapshot: KpiSnapshot) {
      const handlers: StreamHandlers = {};
      const onStream = vi.fn(
        (channel: keyof StreamHandlers, cb: (p: unknown) => void) => {
          (handlers[channel] ??= []).push(cb);
          return () => {
            const list = handlers[channel] ?? [];
            const idx = list.indexOf(cb);
            if (idx >= 0) list.splice(idx, 1);
          };
        },
      );
      const invoke = vi.fn().mockResolvedValue({ snapshot });
      const fire = (
        channel: keyof StreamHandlers,
        payload: unknown,
      ): void => {
        for (const cb of handlers[channel] ?? []) cb(payload);
      };
      return { onStream, invoke, fire };
    }

    it('increments pendingApprovals on stream:approval-created', async () => {
      const bridge = makeStreamingBridge(SNAPSHOT_A);
      vi.stubGlobal('arena', {
        platform: 'linux',
        invoke: bridge.invoke,
        onStream: bridge.onStream,
      });

      const { result } = renderHook(() => useDashboardKpis());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data?.pendingApprovals).toBe(0);

      act(() => {
        bridge.fire('stream:approval-created', {
          item: { id: 'a-1', status: 'pending' },
        });
      });

      expect(result.current.data?.pendingApprovals).toBe(1);
    });

    it('decrements pendingApprovals on stream:approval-decided', async () => {
      const bridge = makeStreamingBridge({
        ...SNAPSHOT_A,
        pendingApprovals: 3,
      });
      vi.stubGlobal('arena', {
        platform: 'linux',
        invoke: bridge.invoke,
        onStream: bridge.onStream,
      });

      const { result } = renderHook(() => useDashboardKpis());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data?.pendingApprovals).toBe(3);

      act(() => {
        bridge.fire('stream:approval-decided', {
          item: { id: 'a-1', status: 'approved' },
          decision: 'approve',
          comment: null,
        });
      });

      expect(result.current.data?.pendingApprovals).toBe(2);
    });

    it('clamps the counter at 0 — never negative even on extra decided events', async () => {
      const bridge = makeStreamingBridge(SNAPSHOT_A);
      vi.stubGlobal('arena', {
        platform: 'linux',
        invoke: bridge.invoke,
        onStream: bridge.onStream,
      });
      const { result } = renderHook(() => useDashboardKpis());
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Two extra decided events with no created — counter must not go
      // negative.
      act(() => {
        bridge.fire('stream:approval-decided', { item: { id: 'a' } });
        bridge.fire('stream:approval-decided', { item: { id: 'b' } });
      });

      expect(result.current.data?.pendingApprovals).toBe(0);
    });

    it('skips stream patching when window.arena.onStream is absent (legacy bridge)', async () => {
      // Previous test suite shape (no onStream) — hook still works.
      const bridgeInvoke = vi.fn().mockResolvedValue({ snapshot: SNAPSHOT_A });
      vi.stubGlobal('arena', {
        platform: 'linux',
        invoke: bridgeInvoke,
      });
      const { result } = renderHook(() => useDashboardKpis());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toEqual(SNAPSHOT_A);
    });
  });
});
