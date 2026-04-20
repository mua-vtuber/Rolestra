/**
 * `useRecentMessages` — fetches the last N messages across all channels
 * for the R4 dashboard RecentWidget (spec §7.5).
 *
 * Contract is identical to {@link useActiveMeetings} — see that hook
 * for the strict-mode + error-retention rationale. The only difference
 * is the channel name and the response shape.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { RecentMessage } from '../../shared/message-types';

export interface UseRecentMessagesResult {
  messages: RecentMessage[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useRecentMessages(limit?: number): UseRecentMessagesResult {
  const [messages, setMessages] = useState<RecentMessage[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const { messages: list } = await invoke(
          'message:list-recent',
          limit === undefined ? {} : { limit },
        );
        if (!mountedRef.current) return;
        setMessages(list);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setMessages(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [limit],
  );

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

  return { messages, loading, error, refresh };
}
