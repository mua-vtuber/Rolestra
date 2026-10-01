/**
 * Active-channel store (zustand + persist) — R5 메신저.
 *
 * 스토리지 shape: 프로젝트별 마지막 채널 + 독립된 전역 채널/선택 범위.
 * 프로젝트별 마지막 채널과 전역 일반/DM 선택을 독립적으로 기억한다.
 *
 * key: `rolestra.activeChannel.v1` (ACTIVE_PROJECT_STORAGE_KEY와 동일한
 * namespace 패턴). 기존 v1 프로젝트 슬롯을 유지하며 전역 필드를 추가한다.
 *
 * Thread/MemberPanel은 `useActiveChannel` 훅으로 선택과 검증을 소비한다.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'rolestra.activeChannel.v1';

export interface ActiveChannelState {
  channelIdByProject: Record<string, string>;
  globalChannelId: string | null;
  selectedScope: 'global' | 'project';
  /**
   * 특정 프로젝트의 활성 채널을 기록한다. `channelId`가 null이면 해당 키를
   * 지운다(기록 없음). 전역 채널은 별도 action으로 기록한다.
   */
  setActiveChannelId: (projectId: string, channelId: string | null) => void;
  setGlobalChannelId: (channelId: string | null) => void;
  selectProjectScope: () => void;
  /** 특정 프로젝트 scope의 기억을 완전히 제거한다(프로젝트 archive 등). */
  clearProject: (projectId: string) => void;
}

export const useActiveChannelStore = create<ActiveChannelState>()(
  persist(
    (set) => ({
      channelIdByProject: {},
      globalChannelId: null,
      selectedScope: 'project',
      setActiveChannelId: (projectId, channelId) =>
        set((state) => {
          if (channelId === null) {
            if (!(projectId in state.channelIdByProject)) return state;
            const {
              [projectId]: _removed,
              ...rest
            } = state.channelIdByProject;
            return { channelIdByProject: rest };
          }
          return {
            channelIdByProject: {
              ...state.channelIdByProject,
              [projectId]: channelId,
            },
            selectedScope: 'project',
          };
        }),
      setGlobalChannelId: (channelId) =>
        set((state) => {
          if (
            state.globalChannelId === channelId &&
            (channelId === null || state.selectedScope === 'global')
          ) {
            return state;
          }
          return {
            globalChannelId: channelId,
            ...(channelId !== null ? { selectedScope: 'global' as const } : {}),
          };
        }),
      selectProjectScope: () =>
        set((state) =>
          state.selectedScope === 'project' ? state : { selectedScope: 'project' },
        ),
      clearProject: (projectId) =>
        set((state) => {
          if (!(projectId in state.channelIdByProject)) return state;
          const {
            [projectId]: _removed,
            ...rest
          } = state.channelIdByProject;
          return { channelIdByProject: rest };
        }),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        channelIdByProject: state.channelIdByProject,
        globalChannelId: state.globalChannelId,
        selectedScope: state.selectedScope,
      }),
    },
  ),
);

export { STORAGE_KEY as ACTIVE_CHANNEL_STORAGE_KEY };
