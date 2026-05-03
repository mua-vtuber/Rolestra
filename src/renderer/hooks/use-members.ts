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
 *
 * R12-C 정리 #5 (2026-05-03): mount 후 한 번 fetch 만 했기 때문에 채널
 * CRUD / 회의 시작-종료 / 직원 추가 등 멤버십 변동 이벤트를 받지 못해
 * 참여자 목록이 영구 stale 했다. `useChannels` 와 동일한 channel
 * invalidation 버스를 구독해 fan-out refetch 한다 — 채널/회의 이벤트가
 * 멤버십도 같이 흔들 수 있으므로 같은 채널로 묶는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
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

  // R12-C 정리 #5 — channel invalidation fan-out 구독.
  // 채널 CRUD / 회의 start·end 이벤트가 발화되면 호스트가
  // `notifyChannelsChanged()` 를 호출한다. 멤버 목록도 채널/회의 변동에
  // 동행하는 데이터이므로 같은 버스로 묶어 refetch (R10 shared cache
  // 도입 전까지의 임시 경로 — `use-channels.ts` 와 동일).
  useEffect(() => {
    const unsubscribe = subscribeChannelsInvalidation(async () => {
      if (!mountedRef.current) return;
      await runFetch(false);
    });
    return unsubscribe;
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { members, loading, error, refresh };
}
