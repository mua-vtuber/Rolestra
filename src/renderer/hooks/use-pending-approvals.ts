/**
 * `usePendingApprovals` — fetches pending-status approval items for the
 * R4 dashboard ApprovalsWidget (spec §7.5).
 *
 * Backed by the existing `approval:list` channel with
 * `status='pending'`. The server-side list has no limit argument at the
 * wire level (the channel type accepts `{ status?, projectId? }`); the
 * widget slices down to 5 visible rows client-side and shows the full
 * count in a badge.
 *
 * Contract mirrors {@link useActiveMeetings} — strict-mode safe initial
 * fetch, last-good retention on refresh error.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ApprovalItem } from '../../shared/approval-types';

export interface UsePendingApprovalsResult {
  items: ApprovalItem[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function usePendingApprovals(): UsePendingApprovalsResult {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { items: list } = await invoke('approval:list', {
        status: 'pending',
      });
      if (!mountedRef.current) return;
      setItems(list);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setItems(null);
    } finally {
      if (mountedRef.current) setLoading(false);
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

  return { items, loading, error, refresh };
}
