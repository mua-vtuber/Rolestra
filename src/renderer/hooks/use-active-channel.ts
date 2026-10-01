/**
 * `useActiveChannel` — 현재 view에 잡혀 있는 채널 id + 전환 API.
 *
 * 책임 분리:
 * - 채널 데이터 자체(Channel row, messages)는 이 훅이 모른다.
 * - 이 훅은 "어떤 채널이 활성인가"의 **선택 상태**만 관리한다.
 * - 선택 범위가 바뀌면 전역 또는 해당 프로젝트의 기억된 channel로 복원된다.
 * - `channels` 리스트를 넘기면 **검증** 수행: 기억한 channelId가
 *   현재 리스트에 없으면 (삭제됐거나 권한 변동) 자동으로 clear한다.
 *   - 리스트가 null(loading)인 경우는 변경하지 않는다.
 *
 * `set(channelId)`은 스토어에 기록만 한다. 관련 IPC(`channel:open` 같은 것)는
 * 없다 — 메시지 로딩은 `useChannelMessages`가 channelId 변경을 구독해 알아서
 * 끌어온다.
 */
import { useCallback, useEffect } from 'react';

import { useActiveChannelStore } from '../stores/active-channel-store';
import type { Channel } from '../../shared/channel-types';

export interface UseActiveChannelResult {
  activeChannelId: string | null;
  set: (channelId: string) => void;
  clear: () => void;
}

/**
 * @param projectId — 선택된 프로젝트 id. null이면 전역 채널 scope.
 * @param channels  — 해당 프로젝트의 최신 채널 리스트(validation용). null이면
 *                    loading 중으로 간주하고 검증을 skip.
 * @param globalChannels — 이전 저장 형식에서 프로젝트 슬롯에 전역 ID가 담긴
 *                         경우를 복구할 목록. null이면 복구 판정을 기다린다.
 */
export function useActiveChannel(
  projectId: string | null,
  channels: Channel[] | null,
  globalChannels?: Channel[] | null,
): UseActiveChannelResult {
  const memory = useActiveChannelStore((s) => s.channelIdByProject);
  const globalChannelId = useActiveChannelStore((s) => s.globalChannelId);
  const setActiveChannelId = useActiveChannelStore((s) => s.setActiveChannelId);
  const setGlobalChannelId = useActiveChannelStore((s) => s.setGlobalChannelId);

  const activeChannelId =
    projectId === null ? globalChannelId : memory[projectId] ?? null;

  // 채널 검증: 리스트가 준비된 시점에 기억한 채널이 실제로 존재하는지 확인.
  // 이전 버전에서 전역 ID를 프로젝트 슬롯에 저장한 경우에는 전역 목록이
  // 준비될 때까지 판정을 미룬 뒤 전역 슬롯으로 이동한다.
  useEffect(() => {
    if (channels === null) return;
    const stored = projectId === null ? globalChannelId : memory[projectId];
    if (stored === null || stored === undefined) return;
    if (channels.some((c) => c.id === stored)) return;
    if (projectId === null) {
      setGlobalChannelId(null);
      return;
    }
    if (globalChannels === null) return;
    if (globalChannels?.some((c) => c.id === stored)) {
      setGlobalChannelId(stored);
    }
    setActiveChannelId(projectId, null);
  }, [
    projectId,
    channels,
    globalChannels,
    memory,
    globalChannelId,
    setActiveChannelId,
    setGlobalChannelId,
  ]);

  const set = useCallback(
    (channelId: string): void => {
      if (projectId === null) setGlobalChannelId(channelId);
      else setActiveChannelId(projectId, channelId);
    },
    [projectId, setActiveChannelId, setGlobalChannelId],
  );

  const clear = useCallback((): void => {
    if (projectId === null) setGlobalChannelId(null);
    else setActiveChannelId(projectId, null);
  }, [projectId, setActiveChannelId, setGlobalChannelId]);

  return { activeChannelId, set, clear };
}
