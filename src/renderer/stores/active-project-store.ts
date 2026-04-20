/**
 * Active-project store (zustand + persist).
 *
 * Persists only `activeProjectId` under localStorage key
 * `rolestra.activeProject.v1`. No derived state is persisted — the full
 * `Project` object is re-resolved from `useProjects()` on demand.
 *
 * Style mirrors `src/renderer/theme/theme-store.ts` for consistency.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'rolestra.activeProject.v1';

export interface ActiveProjectState {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

export const useActiveProjectStore = create<ActiveProjectState>()(
  persist(
    (set) => ({
      activeProjectId: null,
      setActiveProjectId: (id) => set({ activeProjectId: id }),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ activeProjectId: state.activeProjectId }),
    },
  ),
);

export { STORAGE_KEY as ACTIVE_PROJECT_STORAGE_KEY };
