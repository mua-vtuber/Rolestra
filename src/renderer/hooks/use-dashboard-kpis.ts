/**
 * `useDashboardKpis` — fetches the dashboard KPI snapshot on mount.
 *
 * Contract:
 * - On mount: calls `dashboard:get-kpis` exactly once, even under React 18/19
 *   strict-mode double-invoke of effects. A ref guard enforces this.
 * - Initial state: `loading=true, data=null, error=null`.
 * - On success: `loading=false, data=snapshot`.
 * - On error: `loading=false, error=<Error>`, data stays at its previous
 *   value during the initial fetch that means `null`, and we do NOT
 *   silently substitute a stale snapshot. UX must surface the error.
 * - `refresh()` re-runs the fetch. It flips `loading=true` during the
 *   refetch. On refetch error the stale `data` is preserved — the caller
 *   has a non-null snapshot already, and discarding it would flash empty
 *   widgets. `error` is still populated so the UI can show a retry banner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { KpiSnapshot } from '../../shared/dashboard-types';

export interface UseDashboardKpisResult {
  data: KpiSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useDashboardKpis(): UseDashboardKpisResult {
  const [data, setData] = useState<KpiSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Guards against React strict-mode double mount-effect firing.
  const didMountFetchRef = useRef(false);
  // Tracks whether the component is still mounted so async resolves don't
  // call setState after unmount.
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) {
      // Clear previous error on a refresh attempt so stale error banners
      // don't linger while the refetch is in flight.
      setError(null);
    }
    try {
      const { snapshot } = await invoke('dashboard:get-kpis', {});
      if (!mountedRef.current) return;
      setData(snapshot);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) {
        // Never fabricate a snapshot on initial failure.
        setData(null);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (didMountFetchRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    didMountFetchRef.current = true;
    void runFetch(true);
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { data, loading, error, refresh };
}
