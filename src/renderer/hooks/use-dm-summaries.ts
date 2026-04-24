/**
 * `useDmSummaries` — `dm:list` IPC 를 호출해 모든 provider 의 DM 존재 여부
 * 를 함께 반환하는 hook (R10-Task3).
 *
 * 기존 `useDms` 는 Channel[] 만 반환해 "이미 있는 DM" 만 보여준다. R10
 * DmCreateModal 은 provider 선택 UI 에서 "이미 DM 있는 provider 는
 * disabled" 를 표현해야 하므로 DM 이 아직 없는 provider 까지 포함한 목록이
 * 필요하다. main-side `handleDmList` 가 이 두 가지를 합친 `DmSummary[]`
 * 를 반환한다.
 *
 * Contract 는 useDashboardKpis 패턴 그대로 — strict-mode 이중 호출 방지,
 * 실패 시 data 는 이전 값 유지.
 *
 * Invalidation 은 `subscribeChannelsInvalidation` 에 묶여 있어 dm:create
 * 성공 후 `notifyChannelsChanged()` 가 실행되면 자동 refetch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import type { DmSummary } from '../../shared/dm-types';

export interface UseDmSummariesResult {
  data: DmSummary[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useDmSummaries(): UseDmSummariesResult {
  const [data, setData] = useState<DmSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { items } = await invoke('dm:list', undefined);
      if (!mountedRef.current) return;
      setData(items);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setData(null);
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

  useEffect(() => {
    const unsubscribe = subscribeChannelsInvalidation(async () => {
      await runFetch(false);
    });
    return unsubscribe;
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { data, loading, error, refresh };
}
