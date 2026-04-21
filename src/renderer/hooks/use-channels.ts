/**
 * `useChannels` — 프로젝트 scope의 채널 목록 훅.
 *
 * Contract:
 * - `projectId`가 null이면 idle(실제 IPC 미호출, 데이터 null, loading=false).
 *   "DM 전용 레일"은 `useDms()`가 따로 맡는다.
 * - `projectId` 바뀌면 새 프로젝트 기준으로 refetch.
 * - strict-mode 이중 mount-effect에서 IPC가 **최대 1회**만 호출되도록
 *   `didMountFetchRef`로 가드.
 * - 초기 실패 시 `data=null` 유지(silent fallback 금지). refresh 실패 시에는
 *   이전 good list를 유지하고 `error`만 갱신해 flash를 피한다.
 * - `refresh()`는 동일 `projectId` 기준으로 다시 `channel:list`를 쏜다.
 * - 채널 CRUD(Task 10)가 성공했을 때 호출자가 `refresh()`로 재동기화한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import type { Channel } from '../../shared/channel-types';

export interface UseChannelsResult {
  channels: Channel[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useChannels(projectId: string | null): UseChannelsResult {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  // projectId 가 null 이면 처음부터 idle 이므로 loading=false.
  const [loading, setLoading] = useState<boolean>(projectId !== null);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  // projectId별 strict-mode 이중 mount 가드. projectId가 바뀌면 리셋.
  const fetchedForRef = useRef<string | null | undefined>(undefined);

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      if (projectId === null) return;
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const { channels: list } = await invoke('channel:list', { projectId });
        if (!mountedRef.current) return;
        setChannels(list);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setChannels(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    mountedRef.current = true;

    if (projectId === null) {
      // 다음 projectId 활성 전환 시 fetch가 다시 돌도록 guard만 리셋.
      // state는 return 시 derived idle shape으로 덮어쓰므로 여기서 setState
      // 를 하지 않는다(react-hooks/set-state-in-effect 회피).
      fetchedForRef.current = null;
      return () => {
        mountedRef.current = false;
      };
    }

    if (fetchedForRef.current === projectId) {
      return () => {
        mountedRef.current = false;
      };
    }
    fetchedForRef.current = projectId;
    void runFetch(true);

    return () => {
      mountedRef.current = false;
    };
  }, [projectId, runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  // Task 10 CRUD 동기화: 채널이 바뀔 수 있는 이벤트가 발생하면
  // `notifyChannelsChanged()` 가 이 콜백을 호출해 refetch 한다. projectId
  // null 인 idle 인스턴스는 skip (runFetch 내부도 skip 하지만 명시).
  useEffect(() => {
    const unsubscribe = subscribeChannelsInvalidation(async () => {
      if (projectId === null) return;
      await runFetch(false);
    });
    return unsubscribe;
  }, [projectId, runFetch]);

  // projectId=null은 "idle" 상태다. state에는 이전 프로젝트의 값이 남아
  // 있을 수 있지만 소비자에게는 idle shape을 보여줘 stale flash를 차단한다.
  if (projectId === null) {
    return { channels: null, loading: false, error: null, refresh };
  }
  return { channels, loading, error, refresh };
}
