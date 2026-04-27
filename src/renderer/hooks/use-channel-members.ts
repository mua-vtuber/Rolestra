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
 * - `channelId` null → members=null, loading=false, error=null.
 * - `channels`가 null(loading)이면 loading=true.
 * - `useMembers()`가 error면 이 훅도 error surface.
 * - F2-Task4: `channelId`가 `channels` 목록에 없으면 빈 리스트 fallback 대신
 *   `members=null`, `error=ChannelNotFoundError` 로 surface 한다. 호출자는
 *   `error` 또는 ErrorBoundary 로 사용자에게 명시적으로 알린다 — "채널이
 *   비어 있다"와 "채널이 사라졌다"는 다른 상황이고, 후자를 전자처럼 보이게
 *   하면 사용자가 혼란을 겪는다.
 */
import { useMemo } from 'react';

import { useMembers } from './use-members';
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

export function useChannelMembers(
  channelId: string | null,
  channels: Channel[] | null,
): UseChannelMembersResult {
  const membersResult = useMembers();

  const channelMissing = useMemo<boolean>(() => {
    if (channelId === null) return false;
    if (channels === null) return false;
    return !channels.some((c) => c.id === channelId);
  }, [channelId, channels]);

  const filtered = useMemo<MemberView[] | null>(() => {
    if (channelId === null) return null;
    if (channels === null) return null;
    if (channelMissing) return null;
    if (membersResult.members === null) return null;
    // R5 MVP: 프로젝트 scope 채널이면 해당 프로젝트 멤버 전원, DM이면 전원.
    // 채널별 세부 membership은 R8+에서 별도 IPC로 확장.
    return membersResult.members;
  }, [channelId, channels, channelMissing, membersResult.members]);

  const error = useMemo<Error | null>(() => {
    if (channelMissing && channelId !== null) {
      return new ChannelNotFoundError(channelId);
    }
    return membersResult.error;
  }, [channelMissing, channelId, membersResult.error]);

  const loading = channelId !== null
    && !channelMissing
    && (channels === null || membersResult.loading);

  return {
    members: filtered,
    loading,
    error,
    refresh: membersResult.refresh,
  };
}
