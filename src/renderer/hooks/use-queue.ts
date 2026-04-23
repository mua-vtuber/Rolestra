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
 * The hook does NOT emit its own progress events — that stream
 * (`stream:queue-progress`, a per-item status tick) is owned by a
 * separate hook in R10 if we need granular toast UX. For R9, the
 * coarse-grained `stream:queue-updated` snapshot is sufficient.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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

export function useQueue(projectId: string): UseQueueResult {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [paused, setPaused] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const didMountFetchRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { items: list } = await invoke('queue:list', { projectId });
      if (!mountedRef.current) return;
      setItems(list);
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
      try {
        for (const prompt of lines) {
          await invoke('queue:add', { projectId, prompt });
        }
        await refresh();
      } catch (reason) {
        setError(toError(reason));
        throw reason;
      }
    },
    [projectId, refresh],
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
