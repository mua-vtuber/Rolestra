/**
 * `useActiveMeetings` — fetches the top-N active meetings for the R4
 * dashboard TasksWidget (spec §7.5).
 *
 * Contract mirrors {@link useDashboardKpis}:
 * - On mount: calls `meeting:list-active` once, strict-mode safe.
 * - Initial state: `loading=true, data=null, error=null`.
 * - On success: `loading=false, data={meetings: [...]}`.
 * - On error: `loading=false, error=<Error>`, `data` stays null on the
 *   initial fetch. Refresh keeps the last good `data` so the widget
 *   doesn't flash empty rows during a transient failure.
 * - `refresh()` re-runs the fetch.
 *
 * The hook owns NO transformation beyond the IPC response — the repo
 * already shapes the rows for the widget (joined project/channel names,
 * stateIndex, elapsedMs).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ActiveMeetingSummary } from '../../shared/meeting-types';

export interface UseActiveMeetingsResult {
  meetings: ActiveMeetingSummary[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useActiveMeetings(limit?: number): UseActiveMeetingsResult {
  const [meetings, setMeetings] = useState<ActiveMeetingSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        // The channel accepts `{ limit? } | undefined`; passing `{}` keeps
        // the default. Omitting `limit` explicitly lets the repo's clamp
        // pipeline (default=10) own the fallback.
        const { meetings: list } = await invoke(
          'meeting:list-active',
          limit === undefined ? {} : { limit },
        );
        if (!mountedRef.current) return;
        setMeetings(list);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setMeetings(null);
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

  return { meetings, loading, error, refresh };
}
