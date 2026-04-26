/**
 * `useApprovalDetail` — fetch the composite Approval detail payload
 * (`approval:detail-fetch`) for the right-side panel of #승인-대기.
 *
 * R11-Task7 design:
 *   - Single round-trip per `approvalId` change. The backend handler
 *     composes (i) approval row, (ii) ExecutionService.dryRunPreview,
 *     (iii) meeting voting context into one response so the panel never
 *     renders three half-resolved slices.
 *   - `approvalId === null` is the "no row selected" state — the hook
 *     parks `detail=null, loading=false, error=null` and skips the IPC.
 *   - `refetch()` is exposed so the ActionBar can refresh after a
 *     decision (the row stops being pending so the list event removes it,
 *     but a parent that wants to re-pull voting context after a related
 *     mutation can call refetch directly).
 *
 * Strict-mode safe — same pattern as `usePendingApprovals`: a mountedRef
 * guards every setState after an await, and the fetch dependency is
 * `approvalId` so a strict-mode double-mount does not double-fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../../ipc/invoke';
import type { ApprovalDetail } from '../../../shared/approval-detail-types';

export interface UseApprovalDetailResult {
  detail: ApprovalDetail | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Module-scoped sentinel used by the fetch-once ref below. Minting at the
 * module level (not on every render) avoids the react-compiler "cannot
 * access refs during render" diagnostic that fires when `Symbol()` is
 * combined with `useRef()` in the component body.
 *
 * (Pattern mirrors `use-pending-approvals` — the unique sentinel keeps a
 * `null` cache key distinguishable from "no fetch attempted yet".)
 */
const UNSET = Symbol('use-approval-detail:unset');

export function useApprovalDetail(
  approvalId: string | null,
): UseApprovalDetailResult {
  // Internal state is the "loaded slice" only — `approvalId === null`
  // is handled at result-derivation time so the effect body never has
  // to call setState synchronously (react-hooks/set-state-in-effect).
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(approvalId !== null);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  // Cache-key guard mirroring `use-pending-approvals` so React 18
  // strict-mode double-mount does not double-fetch and the conditional
  // ref check keeps the effect's setState path off the lint rule's
  // synchronous trace.
  const lastFetchedRef = useRef<string | null | typeof UNSET>(UNSET);

  const runFetch = useCallback(async (): Promise<void> => {
    if (approvalId === null) {
      // No selection — nothing to fetch. The result derivation below
      // overrides detail/loading/error with null/false/null so the
      // caller sees a clean "no row selected" state regardless of the
      // last loaded slice.
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { detail: next } = await invoke('approval:detail-fetch', {
        approvalId,
      });
      if (!mountedRef.current) return;
      setDetail(next);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      setDetail(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [approvalId]);

  useEffect(() => {
    mountedRef.current = true;
    if (lastFetchedRef.current !== approvalId) {
      lastFetchedRef.current = approvalId;
      void runFetch();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch, approvalId]);

  // Result derivation — when `approvalId` is null we mask the inner
  // state with a clean "no selection" snapshot. Internal state may
  // still hold a previously loaded detail; callers never observe it
  // because the panel renders the empty zero-state when approvalId is
  // null. This keeps the effect path setState-free for the null case.
  if (approvalId === null) {
    return {
      detail: null,
      loading: false,
      error: null,
      refetch: runFetch,
    };
  }
  return { detail, loading, error, refetch: runFetch };
}
