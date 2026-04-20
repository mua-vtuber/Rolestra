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
});
