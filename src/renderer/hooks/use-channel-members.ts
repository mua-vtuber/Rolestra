/**
 * `useChannelMembers` — 채널의 참여자 목록.
 *
 * D6 결정: `channel:list-members` 신규 IPC는 **추가하지 않는다**. 기존
 * `channel:list` 결과의 `Channel.id` + 프로젝트 내 `useMembers()` 출력을 조합
 * (그리고 채널의 projectId scope filter)해서 **Renderer 측에서 필터링**한다.
 *
 * 실제 채널×멤버 매핑은 main-side `channel_members` 테이블이 정본이지만
 * R5 UX에서 요구되는 뷰는 "이 프로젝트의 멤버 전원"에 가깝다
 * (채널별 세부 조정은 Task 10 create modal에서만 memberProviderIds를 쓴다).
 * 따라서 MVP는 `channelId` → `projectId` 해석 후 `useMembers()` 전원을 그대로
 * 반환한다. channelId가 없거나 DM(projectId=null) 채널이면 빈 리스트 또는
 * 전체 멤버(DM은 1:1이므로 UX 상 참여자 패널 자체를 다르게 그린다 — 그건 Task 9).
 *
 * Contract:
 * - `channelId` null → members=null, loading=false.
 * - `channels`가 null(loading)이면 loading=true.
 * - `useMembers()`가 error면 이 훅도 error surface.
 */
import { useMemo } from 'react';

import { useMembers } from './use-members';
import type { Channel } from '../../shared/channel-types';
import type { MemberView } from '../../shared/member-profile-types';

export interface UseChannelMembersResult {
  members: MemberView[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useChannelMembers(
  channelId: string | null,
  channels: Channel[] | null,
): UseChannelMembersResult {
  const membersResult = useMembers();

  const filtered = useMemo<MemberView[] | null>(() => {
    if (channelId === null) return null;
    if (channels === null) return null;
    if (membersResult.members === null) return null;
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return [];
    // R5 MVP: 프로젝트 scope 채널이면 해당 프로젝트 멤버 전원, DM이면 전원.
    // 채널별 세부 membership은 R8+에서 별도 IPC로 확장.
    return membersResult.members;
  }, [channelId, channels, membersResult.members]);

  const loading = channelId !== null && (channels === null || membersResult.loading);

  return {
    members: filtered,
    loading,
    error: membersResult.error,
    refresh: membersResult.refresh,
  };
}
