/**
 * `usePendingApprovals` — pending approval items for the dashboard widget
 * and the `#승인-대기` ApprovalInboxView (spec §7.4, §7.5).
 *
 * R4 baseline: mount-time fetch of `approval:list` with `status='pending'`.
 * R7-Task2: live stream merge — subscribes to `stream:approval-created` and
 * `stream:approval-decided` so the list reflects ApprovalService mutations
 * without polling. `stream:approval-decided` removes the item from the
 * pending list (terminal status); `stream:approval-created` prepends it
 * (newest first, matching `approval:list` ordering).
 * R7-Task7: optional `projectId` filter — when provided, passes it through
 * to `approval:list` AND filters `stream:approval-created` events to items
 * with matching `item.projectId`. Unset/`null` retains the project-wide
 * behaviour the dashboard widget expects (no filter). `decided` events
 * always apply — removing a non-member id is a safe no-op via filter.
 *
 * Strict-mode safe: the initial fetch runs exactly once (didMountFetchRef
 * guard) and stream subscriptions mount on every render pass — React 18
 * double-mounts in dev so the cleanup must tear the subscription down.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ApprovalItem } from '../../shared/approval-types';
import type {
  StreamApprovalCreatedPayload,
  StreamApprovalDecidedPayload,
} from '../../shared/stream-events';

export interface UsePendingApprovalsResult {
  items: ApprovalItem[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Module-scoped sentinel used by the fetch-once ref below. Minting at the
 * module level (not on every render) avoids the react-compiler "cannot
 * access refs during render" diagnostic that fires when `Symbol()` is
 * combined with `useRef()` in the component body.
 */
const UNSET = Symbol('use-pending-approvals:unset');

/**
 * Prepend the freshly-created approval while de-duplicating by id — the
 * event and the next refetch can occasionally race (e.g. initial fetch
 * lands after a create event) and we do not want the same id twice.
 */
function applyCreated(
  prev: ApprovalItem[] | null,
  item: ApprovalItem,
): ApprovalItem[] {
  if (item.status !== 'pending') {
    // Defensive — ApprovalService.create always persists 'pending', but
    // a buggy producer must not corrupt the pending list.
    return prev ?? [];
  }
  const base = prev ?? [];
  if (base.some((existing) => existing.id === item.id)) {
    return base;
  }
  return [item, ...base];
}

function applyDecided(
  prev: ApprovalItem[] | null,
  item: ApprovalItem,
): ApprovalItem[] | null {
  if (prev === null) return prev;
  return prev.filter((existing) => existing.id !== item.id);
}

export function usePendingApprovals(
  projectId?: string | null,
): UsePendingApprovalsResult {
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Sentinel means "no fetch attempted yet". Any subsequent change to
   * `filterProjectId` (including `null → 'p-1'`) re-fetches once; React 18
   * strict-mode double-mount does not trigger a second fetch because the
   * ref still matches the same filter after unmount→remount.
   *
   * Using a module-scoped unique Symbol (set at module init) avoids the
   * react-compiler rule "Cannot access refs during render" — the Symbol()
   * call on every render reads a ref and re-mints a new symbol per render
   * pass, which is banned under the strict rules of hooks.
   */
  const lastFetchedFilterRef = useRef<string | null | typeof UNSET>(UNSET);
  const mountedRef = useRef(true);
  const filterProjectId =
    typeof projectId === 'string' && projectId.length > 0 ? projectId : null;

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const request: { status: 'pending'; projectId?: string } = {
          status: 'pending',
        };
        if (filterProjectId !== null) request.projectId = filterProjectId;
        const { items: list } = await invoke('approval:list', request);
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
    },
    [filterProjectId],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (lastFetchedFilterRef.current !== filterProjectId) {
      lastFetchedFilterRef.current = filterProjectId;
      void runFetch(true);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch, filterProjectId]);

  // R7-Task2: live stream merge. Subscribes unconditionally so the first
  // event after mount is captured even when the initial fetch is still
  // in flight. `arena.onStream` is absent in unit tests that do not stub
  // it — we no-op in that case so existing jsdom tests stay green.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return undefined;

    const offCreated = onStream(
      'stream:approval-created',
      (payload: StreamApprovalCreatedPayload) => {
        if (!mountedRef.current) return;
        // R7-Task7: filter by project so the #승인-대기 inbox only shows
        // approvals for the host project. Global callers (widget) pass no
        // filter and see every item.
        if (
          filterProjectId !== null &&
          payload.item.projectId !== filterProjectId
        ) {
          return;
        }
        setItems((prev) => applyCreated(prev, payload.item));
      },
    );
    const offDecided = onStream(
      'stream:approval-decided',
      (payload: StreamApprovalDecidedPayload) => {
        if (!mountedRef.current) return;
        // `decided` always applies — if the id is not in the current list
        // the filter in `applyDecided` is a no-op. No projectId gate here
        // avoids leaking a stale id when the approval straddles projects.
        setItems((prev) => applyDecided(prev, payload.item));
      },
    );
    return () => {
      offCreated();
      offDecided();
    };
  }, [filterProjectId]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { items, loading, error, refresh };
}
