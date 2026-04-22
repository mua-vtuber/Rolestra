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
        setItems((prev) => applyCreated(prev, payload.item));
      },
    );
    const offDecided = onStream(
      'stream:approval-decided',
      (payload: StreamApprovalDecidedPayload) => {
        if (!mountedRef.current) return;
        setItems((prev) => applyDecided(prev, payload.item));
      },
    );
    return () => {
      offCreated();
      offDecided();
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { items, loading, error, refresh };
}
