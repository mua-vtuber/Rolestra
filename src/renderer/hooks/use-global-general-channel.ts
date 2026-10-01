/**
 * `useGlobalGeneralChannel` — R12-C 전역 일반 채널 1개 훅.
 *
 * `channel:get-global-general` IPC 한 번 호출. 사이드바 상단에 단일 entry 로
 * 렌더하는 데 쓰인다. 마이그레이션 / boot 비정상 시 null — Sidebar 가
 * 빈 슬롯 처리.
 *
 * 시멘틱 = `useDms` 의 dm-only 정의를 보존하기 위해 별도 IPC + 별도 hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import type { Channel } from '../../shared/channel-types';

export interface UseGlobalGeneralChannelResult {
  channel: Channel | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useGlobalGeneralChannel(): UseGlobalGeneralChannelResult {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { channel: fetched } = await invoke(
        'channel:get-global-general',
        undefined,
      );
      if (!mountedRef.current) return;
      setChannel(fetched);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setChannel(null);
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

  useEffect(() => {
    const unsubscribe = subscribeChannelsInvalidation(async () => {
      await runFetch(false);
    });
    return unsubscribe;
  }, [runFetch]);

  return { channel, loading, error, refresh };
}
