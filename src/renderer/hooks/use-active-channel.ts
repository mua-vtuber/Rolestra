/**
 * `useActiveChannel` — 현재 view에 잡혀 있는 채널 id + 전환 API.
 *
 * 책임 분리:
 * - 채널 데이터 자체(Channel row, messages)는 이 훅이 모른다.
 * - 이 훅은 "어떤 채널이 활성인가"의 **선택 상태**만 관리한다.
 * - 활성 project가 바뀌면 해당 프로젝트의 기억된 channel로 복원된다.
 * - `channels` 리스트(= `useChannels`)를 넘기면 **검증** 수행: 기억한 channelId가
 *   현재 리스트에 없으면 (삭제됐거나 권한 변동) 자동으로 clear한다.
 *   - 리스트가 null(loading)인 경우는 변경하지 않는다.
 *
 * `set(channelId)`은 스토어에 기록만 한다. 관련 IPC(`channel:open` 같은 것)는
 * 없다 — 메시지 로딩은 `useChannelMessages`가 channelId 변경을 구독해 알아서
 * 끌어온다.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useActiveChannelStore } from '../stores/active-channel-store';
import type { Channel } from '../../shared/channel-types';

export interface UseActiveChannelResult {
  activeChannelId: string | null;
  set: (channelId: string) => void;
  clear: () => void;
}

/**
 * @param projectId — 활성 프로젝트 id. null이면 프로젝트 scope 없는 상태로
 *                    간주하고 activeChannelId=null을 반환한다.
 * @param channels  — 해당 프로젝트의 최신 채널 리스트(validation용). null이면
 *                    loading 중으로 간주하고 검증을 skip.
 */
export function useActiveChannel(
  projectId: string | null,
  channels: Channel[] | null,
): UseActiveChannelResult {
  const memory = useActiveChannelStore((s) => s.channelIdByProject);
  const setActiveChannelId = useActiveChannelStore((s) => s.setActiveChannelId);

  const activeChannelId = projectId === null ? null : memory[projectId] ?? null;

  // 채널 검증: 리스트가 준비된 시점에 기억한 채널이 실제로 존재하는지 확인.
  // strict mode 재실행에 견디도록 effect 자체가 idempotent 하므로 guard 없이도
  // 중복 작업이 발생하지 않는다(setActiveChannelId는 값 같으면 no-op 상태 반환).
  const validationInFlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    if (channels === null) return;
    const stored = memory[projectId];
    if (stored === undefined) return;
    if (channels.some((c) => c.id === stored)) return;
    // 이미 같은 projectId에 대해 이번 cycle에서 clear했으면 반복 호출 방지.
    if (validationInFlightRef.current === projectId) return;
    validationInFlightRef.current = projectId;
    setActiveChannelId(projectId, null);
  }, [projectId, channels, memory, setActiveChannelId]);

  const set = useCallback(
    (channelId: string): void => {
      if (projectId === null) return;
      setActiveChannelId(projectId, channelId);
    },
    [projectId, setActiveChannelId],
  );

  const clear = useCallback((): void => {
    if (projectId === null) return;
    setActiveChannelId(projectId, null);
  }, [projectId, setActiveChannelId]);

  return { activeChannelId, set, clear };
}
