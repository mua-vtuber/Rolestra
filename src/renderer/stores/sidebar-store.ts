/**
 * Sidebar store — R12-C T8 통합 사이드바.
 *
 * 사이드바 = 일반 채널 (전역) + 프로젝트 accordion (collapsible) + DM (전역)
 * 구조의 펼침/접힘 상태를 보관한다. zustand persist 로 localStorage 에 저장
 * 해서 reload 후에도 사용자가 닫아둔 프로젝트는 닫혀 있다.
 *
 * 디폴트 = 펼침 (true). 알려진 projectId 가 record 에 없으면 `true` 로 간주.
 *
 * key 단위 = projectId. 신규 프로젝트는 자연스럽게 `undefined` → 펼침.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'rolestra.sidebar.v1';

export interface SidebarState {
  /**
   * `projectExpanded[projectId]` — 명시 false 면 접힘. undefined / true 면 펼침.
   */
  projectExpanded: Record<string, boolean>;
  /** 프로젝트 펼침 상태 토글 (현재 값의 반대). */
  toggleProject: (projectId: string) => void;
  /** 펼침/접힘 명시 set. */
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      projectExpanded: {},
      toggleProject: (projectId) =>
        set((state) => {
          const current = state.projectExpanded[projectId] !== false;
          return {
            projectExpanded: {
              ...state.projectExpanded,
              [projectId]: !current,
            },
          };
        }),
      setProjectExpanded: (projectId, expanded) =>
        set((state) => ({
          projectExpanded: {
            ...state.projectExpanded,
            [projectId]: expanded,
          },
        })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ projectExpanded: state.projectExpanded }),
    },
  ),
);

/**
 * Helper — `projectExpanded[id]` 가 false 면 접힘, 그 외 (undefined/true) 펼침.
 */
export function isProjectExpanded(
  state: SidebarState,
  projectId: string,
): boolean {
  return state.projectExpanded[projectId] !== false;
}

export { STORAGE_KEY as SIDEBAR_STORAGE_KEY };
