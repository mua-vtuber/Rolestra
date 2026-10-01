/**
 * `useChannelMembers` — 채널의 참여자 목록.
 *
 * R12-C dogfooding round 1 (2026-05-03): R5 시점 D6 결정 ("`channel:list-members`
 * 신규 IPC 미도입") 의 reverse. 이전 구현은 `useMembers()` 의 project-wide
 * 멤버 list 를 그대로 반환해 자유 채널 / DM 의 실제 참여자 수와 표시가
 * 어긋났다 (자유 채널 2명 추가 → UI 3명, DM 1:1 → UI 3명). main 의
 * `channel_members` 테이블 + drag_order 정렬은 R12-C T2 시점 완비 — 본
 * hook 은 새 `channel:list-members` IPC 를 호출해 channel-scoped MemberView[]
 * 를 직접 fetch 한다.
 *
 * Contract:
 * - `channelId` null → members=null, loading=false, error=null (idle).
 * - `channels` (호출자가 검증용으로 넘기는 list) 가 null → loading=true 유지.
 * - F2-Task4 invariant 유지: `channelId` 가 `channels` 에 없으면 빈 배열
 *   fallback 대신 `members=null` + `error=ChannelNotFoundError` surface.
 * - DM 채널은 `channel_members` 에 AI 1명만 (사용자 참여 암묵적, migration
 *   003-channels.ts:42 주석) — IPC 가 자동으로 1명 반환.
 * - 채널 CRUD / 회의 시작-종료 / 멤버 add-remove / drag reorder 시점에
 *   `notifyChannelsChanged()` 가 발화되면 fan-out refetch (use-channels /
 *   use-members 와 같은 invalidation bus 공유).
 * - strict-mode 이중 mount 가드: `fetchedForRef` 가 channelId 별로 1회만 fetch.
 * - 초기 실패 시 members=null 유지 (silent fallback 금지). refresh 실패 시
 *   이전 good list 유지하고 error 만 갱신.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import type { Channel } from '../../shared/channel-types';
import type { MemberView } from '../../shared/member-profile-types';

/**
 * Surfaced when `channelId` is provided but no entry in `channels`
 * matches it. The renderer should treat this as a user-visible error
 * rather than a silently empty member list.
 */
export class ChannelNotFoundError extends Error {
  readonly channelId: string;

  constructor(channelId: string) {
    super(`Channel not found in current list: ${channelId}`);
    this.name = 'ChannelNotFoundError';
    this.channelId = channelId;
  }
}

export interface UseChannelMembersResult {
  members: MemberView[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useChannelMembers(
  channelId: string | null,
  channels: Channel[] | null,
): UseChannelMembersResult {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [loading, setLoading] = useState<boolean>(channelId !== null);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  // channelId 별 strict-mode 이중 fetch 가드. channelId 가 바뀌면 리셋.
  const fetchedForRef = useRef<string | null | undefined>(undefined);

  const channelMissing = useMemo<boolean>(() => {
    if (channelId === null) return false;
    if (channels === null) return false;
    return !channels.some((c) => c.id === channelId);
  }, [channelId, channels]);

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      if (channelId === null) return;
      if (channelMissing) return;
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const { members: list } = await invoke('channel:list-members', {
          channelId,
        });
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
    },
    [channelId, channelMissing],
  );

  useEffect(() => {
    mountedRef.current = true;

    if (channelId === null) {
      // idle — 다음 channelId 활성화 시 재 fetch 하도록 guard 만 리셋.
      fetchedForRef.current = null;
      return () => {
        mountedRef.current = false;
      };
    }
    if (channels === null) {
      // 호출자가 channels list 를 아직 fetch 중 — 다음 effect 에서 재시도.
      return () => {
        mountedRef.current = false;
      };
    }
    if (channelMissing) {
      // ChannelNotFoundError 는 useMemo 로 surface. fetch 자체는 skip.
      fetchedForRef.current = channelId;
      return () => {
        mountedRef.current = false;
      };
    }

    if (fetchedForRef.current === channelId) {
      return () => {
        mountedRef.current = false;
      };
    }
    fetchedForRef.current = channelId;
    void runFetch(true);

    return () => {
      mountedRef.current = false;
    };
  }, [channelId, channels, channelMissing, runFetch]);

  // 채널 invalidation 구독 — channel CRUD / 회의 시작-종료 / 멤버 add-remove
  // / drag reorder 시점에 같은 bus 가 fan-out 한다.
  useEffect(() => {
    const unsubscribe = subscribeChannelsInvalidation(async () => {
      if (!mountedRef.current) return;
      if (channelId === null) return;
      if (channelMissing) return;
      await runFetch(false);
    });
    return unsubscribe;
  }, [channelId, channelMissing, runFetch]);

  const finalError = useMemo<Error | null>(() => {
    if (channelMissing && channelId !== null) {
      return new ChannelNotFoundError(channelId);
    }
    return error;
  }, [channelMissing, channelId, error]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  // Idle / loading / missing 분기 — 호출자에게 깔끔한 shape 만 노출.
  if (channelId === null) {
    return { members: null, loading: false, error: null, refresh };
  }
  if (channels === null) {
    return { members: null, loading: true, error: null, refresh };
  }
  if (channelMissing) {
    return { members: null, loading: false, error: finalError, refresh };
  }
  return { members, loading, error: finalError, refresh };
}
