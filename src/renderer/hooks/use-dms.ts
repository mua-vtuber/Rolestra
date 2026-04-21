/**
 * `useDms` — DM(Direct Message) 채널 목록 훅.
 *
 * `channel:list({ projectId: null })`은 DM만 반환한다(main side 규약). 여러
 * 프로젝트가 있어도 DM은 프로젝트에 속하지 않으므로 전역 1회 호출로 충분.
 *
 * Contract는 `useChannels`의 project-aware 분기를 제거한 단순 버전. strict-mode
 * 이중 호출 방지, 초기 실패 시 data=null 유지, refresh 실패 시 stale 유지.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { Channel } from '../../shared/channel-types';

export interface UseDmsResult {
  dms: Channel[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useDms(): UseDmsResult {
  const [dms, setDms] = useState<Channel[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { channels } = await invoke('channel:list', { projectId: null });
      if (!mountedRef.current) return;
      setDms(channels);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setDms(null);
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

  return { dms, loading, error, refresh };
}
