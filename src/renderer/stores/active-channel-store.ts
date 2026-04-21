/**
 * Active-channel store (zustand + persist) — R5 메신저.
 *
 * 스토리지 shape: `{ channelIdByProject: Record<string, string> }`.
 * 프로젝트별로 **마지막으로 활성화한 채널 id**를 기억한다. 활성 프로젝트가
 * 바뀌면 해당 project의 기억된 channelId로 복원되고, 기억이 없거나 삭제된
 * 채널이면 null로 떨어진다.
 *
 * key: `rolestra.activeChannel.v1` (ACTIVE_PROJECT_STORAGE_KEY와 동일한
 * namespace 패턴). partialize는 channelIdByProject만 persist.
 *
 * 이 store는 `useActiveChannel` 훅으로만 소비한다. 컴포넌트가 직접 store
 * zustand API를 찌르지 않게 훅이 좁은 표면만 노출한다.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'rolestra.activeChannel.v1';

export interface ActiveChannelState {
  channelIdByProject: Record<string, string>;
  /**
   * 특정 프로젝트의 활성 채널을 기록한다. `channelId`가 null이면 해당 키를
   * 지운다(기록 없음). `projectId`가 null인 상황(=DM pane)은 별도 저장 대상이
   * 아니므로 이 action은 project-scoped만 다룬다.
   */
  setActiveChannelId: (projectId: string, channelId: string | null) => void;
  /** 특정 프로젝트 scope의 기억을 완전히 제거한다(프로젝트 archive 등). */
  clearProject: (projectId: string) => void;
}

export const useActiveChannelStore = create<ActiveChannelState>()(
  persist(
    (set) => ({
      channelIdByProject: {},
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
          };
        }),
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
      }),
    },
  ),
);

export { STORAGE_KEY as ACTIVE_CHANNEL_STORAGE_KEY };
