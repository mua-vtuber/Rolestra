/**
 * `useApprovalCounts` — F6-T1 inbox tab badges.
 *
 * Wraps `approval:count` IPC so the inbox view can render the four tab
 * counters (`pending` / `approved` / `rejected` / `all`) from a single
 * round-trip instead of 4 separate `approval:list` calls. Refetches
 * automatically on `stream:approval-created` / `stream:approval-decided`
 * (a decide flips one row from pending → approved/rejected, so all four
 * counters can shift together).
 *
 * Strict-mode safe: the initial fetch runs exactly once per `projectId`
 * change, the stream handlers reuse the same `refresh` callback so a
 * mount/unmount race cannot fire two fetches for one mutation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';

export interface ApprovalCounts {
  pending: number;
  approved: number;
  rejected: number;
  all: number;
}

export interface UseApprovalCountsResult {
  counts: ApprovalCounts;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const ZERO_COUNTS: ApprovalCounts = {
  pending: 0,
  approved: 0,
  rejected: 0,
  all: 0,
};

const UNSET = Symbol('use-approval-counts:unset');

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useApprovalCounts(
  projectId?: string | null,
): UseApprovalCountsResult {
  const [counts, setCounts] = useState<ApprovalCounts>(ZERO_COUNTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  // Mirrors `use-pending-approvals`'s cache-key pattern: the fetch
  // fires once per `projectId` value (rather than on every render
  // re-derivation of `refresh`). React 18 strict-mode double-mount
  // does not retrigger the IPC because the ref still matches the
  // resolved scope after unmount→remount.
  const lastFetchedScopeRef = useRef<string | typeof UNSET>(UNSET);
  const filterProjectId =
    typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
  const scopeKey = filterProjectId ?? '';

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const request: { projectId?: string } | undefined =
        filterProjectId !== null ? { projectId: filterProjectId } : undefined;
      const next = await invoke('approval:count', request);
      if (!mountedRef.current) return;
      setCounts(next);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filterProjectId]);

  useEffect(() => {
    mountedRef.current = true;
    if (lastFetchedScopeRef.current !== scopeKey) {
      lastFetchedScopeRef.current = scopeKey;
      void refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [refresh, scopeKey]);

  // Live refresh — a created/decided event always shifts at least one
  // bucket, so the cheapest correct strategy is to re-issue the
  // 4-COUNT(*) round-trip rather than mutate counters by hand. The
  // arithmetic is local, but the SQL truth is authoritative when
  // multiple windows or the dashboard widget mutate concurrently.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return undefined;

    const offCreated = onStream('stream:approval-created', () => {
      void refresh();
    });
    const offDecided = onStream('stream:approval-decided', () => {
      void refresh();
    });
    return () => {
      offCreated();
      offDecided();
    };
  }, [refresh]);

  return { counts, loading, error, refresh };
}
