/**
 * `useQueue` — project-scoped queue view + mutations (R9-Task3).
 *
 * Surface:
 *   - mount-fetch `queue:list(projectId)`
 *   - `addLines(text)`  — newline-split → `queue:add` once per line, in order
 *   - `remove(id)` / `cancel(id)` / `reorder(orderedIds)` / `pause()` / `resume()`
 *   - subscribes to `stream:queue-updated` and replaces items + paused
 *     state atomically when the broadcast's `projectId` matches
 *
 * The coarse-grained `stream:queue-updated` snapshot is the only queue
 * stream surface — the F6 cleanup retired the per-item
 * `stream:queue-progress` fall-back since no consumer subscribed to it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useThrowToBoundary } from '../components/ErrorBoundary';
import { invoke } from '../ipc/invoke';
import type { QueueItem } from '../../shared/queue-types';
import type { StreamV3PayloadOf } from '../../shared/stream-events';

export interface UseQueueResult {
  items: QueueItem[];
  paused: boolean;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  addLines: (text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  reorder: (orderedIds: string[]) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const PENDING_PREFIX = 'pending-';

export function useQueue(projectId: string): UseQueueResult {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [paused, setPaused] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const didMountFetchRef = useRef(false);
  const throwToBoundary = useThrowToBoundary();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { items: list } = await invoke('queue:list', { projectId });
      if (!mountedRef.current) return;
      // D8 ordering invariant: if an `addLines()` call optimistically
      // appended pending rows that the server has not yet acknowledged,
      // we keep them after a refresh so the UI does not flicker. Server
      // rows for the same prompt arrive on the next `stream:queue-updated`
      // snapshot, which fully replaces `items` (see stream effect below)
      // and naturally drops any pending row that has been canonicalized.
      setItems((prev) => {
        const stillPending = prev.filter((it) =>
          it.id.startsWith(PENDING_PREFIX),
        );
        return [...list, ...stillPending];
      });
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!didMountFetchRef.current) {
      didMountFetchRef.current = true;
      void refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Stream subscription — replace items + paused on authoritative snapshot.
  useEffect(() => {
    const arena =
      typeof window !== 'undefined'
        ? (window as unknown as { arena?: { onStream?: unknown } }).arena
        : undefined;
    const onStream = (
      arena?.onStream as
        | (<T extends string>(
            type: T,
            cb: (payload: unknown) => void,
          ) => () => void)
        | undefined
    );
    if (!onStream) return;
    const unsub = onStream('stream:queue-updated', (rawPayload) => {
      const payload = rawPayload as StreamV3PayloadOf<'stream:queue-updated'>;
      if (payload.projectId !== projectId) return;
      // D8: server snapshot is authoritative. Any pending rows from an
      // in-flight optimistic `addLines()` are dropped because the server
      // either (a) has already created canonical rows for them — they
      // appear in `payload.items` — or (b) rejected one of the inserts
      // (in which case `addLines` rolled them back via its catch block
      // before this snapshot arrived). The two paths cannot intermix
      // because `queue:add` IPCs are awaited serially in `addLines`.
      setItems(payload.items);
      setPaused(payload.paused);
    });
    return unsub;
  }, [projectId]);

  const addLines = useCallback(
    async (text: string): Promise<void> => {
      const lines = text
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (lines.length === 0) return;

      // 1. Optimistic insert — one pending QueueItem per line. The pending
      //    rows let the panel render the new prompts immediately while the
      //    serial IPC chain runs.
      const now = Date.now();
      const pendingItems: QueueItem[] = lines.map((prompt, index) => {
        const cid = makeClientId();
        return {
          id: `${PENDING_PREFIX}${cid}`,
          projectId,
          targetChannelId: null,
          orderIndex: now + index,
          prompt,
          status: 'pending',
          startedMeetingId: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          createdAt: now + index,
        };
      });
      const pendingIds = new Set(pendingItems.map((it) => it.id));
      setItems((prev) => [...prev, ...pendingItems]);

      try {
        for (const prompt of lines) {
          await invoke('queue:add', { projectId, prompt });
        }
        // 2. On success: trust the next `stream:queue-updated` snapshot
        //    to replace the list authoritatively. Refresh only if the
        //    stream was unavailable (e.g. test env) so the pending rows
        //    don't linger forever — the refresh path drops them via the
        //    server-snapshot reconciliation in `setItems` above. To
        //    handle the "stream arrived first" race, we ALSO drop our
        //    own pendingIds eagerly here: if the stream beat us, the
        //    canonical rows are already in `items` and the pending rows
        //    are stale; if the stream is still pending, refresh() will
        //    re-fill the list from queue:list (the legacy fallback).
        await refresh();
        if (mountedRef.current) {
          // D8: drop any of OUR pending rows that survived the refresh;
          // canonical rows for these prompts are either already in the
          // list or will arrive shortly via stream. Either way the UI
          // must not double-render the prompt.
          setItems((prev) => prev.filter((it) => !pendingIds.has(it.id)));
        }
      } catch (reason) {
        // 3. Rollback the pending rows + surface to the boundary toast.
        if (mountedRef.current) {
          setItems((prev) => prev.filter((it) => !pendingIds.has(it.id)));
          setError(toError(reason));
        }
        throwToBoundary(reason);
        throw reason;
      }
    },
    [projectId, refresh, throwToBoundary],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await invoke('queue:remove', { id });
      await refresh();
    },
    [refresh],
  );

  const cancel = useCallback(
    async (id: string): Promise<void> => {
      await invoke('queue:cancel', { id });
      await refresh();
    },
    [refresh],
  );

  const reorder = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      await invoke('queue:reorder', { projectId, orderedIds });
      await refresh();
    },
    [projectId, refresh],
  );

  const pause = useCallback(async (): Promise<void> => {
    await invoke('queue:pause', { projectId });
    setPaused(true);
  }, [projectId]);

  const resume = useCallback(async (): Promise<void> => {
    await invoke('queue:resume', { projectId });
    setPaused(false);
  }, [projectId]);

  return {
    items,
    paused,
    loading,
    error,
    refresh,
    addLines,
    remove,
    cancel,
    reorder,
    pause,
    resume,
  };
}
