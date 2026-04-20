/**
 * `useMembers` — fetches the roster for the R4 dashboard PeopleWidget
 * (spec §7.5).
 *
 * Contract mirrors {@link useActiveMeetings}: strict-mode safe initial
 * fetch, `null` data on initial error, last-good retention on refresh.
 *
 * Backed by the existing `member:list` channel (no new main-side
 * surface). The hook is a thin wrapper so the widget stays decoupled
 * from the IPC call and can be tested without a bridge stub.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { MemberView } from '../../shared/member-profile-types';

export interface UseMembersResult {
  members: MemberView[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useMembers(): UseMembersResult {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { members: list } = await invoke('member:list', undefined);
      if (!mountedRef.current) return;
      setMembers(list);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setMembers(null);
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

  return { members, loading, error, refresh };
}
