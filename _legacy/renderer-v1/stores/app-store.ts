/**
 * App-level Zustand store.
 *
 * Manages navigation state and app connection status.
 */

import { create } from 'zustand';
import { showError } from '../hooks/useErrorDialog';

/** Available top-level views. */
export type AppView = 'chat' | 'settings';

interface AppInfo {
  name: string;
  version: string;
}

interface AppState {
  currentView: AppView;
  appInfo: AppInfo | null;
  connected: boolean;
  projectFolder: string | null;

  setView: (view: AppView) => void;
  fetchAppInfo: () => Promise<void>;
  checkConnection: () => Promise<void>;
  pickProjectFolder: () => Promise<void>;
  clearProjectFolder: () => void;
  fetchWorkspaceStatus: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'chat',
  appInfo: null,
  connected: false,
  projectFolder: null,

  setView: (view) => set({ currentView: view }),

  fetchAppInfo: async () => {
    try {
      const result = await window.arena.invoke('app:get-info', undefined);
      set({ appInfo: result, connected: true });
    } catch (err) {
      set({ connected: false });
      showError('app:get-info', err);
    }
  },

  checkConnection: async () => {
    try {
      await window.arena.invoke('app:ping', undefined);
      set({ connected: true });
    } catch (err) {
      set({ connected: false });
      console.warn('[app:ping] Connection check failed:', err);
    }
  },

  pickProjectFolder: async () => {
    try {
      const { folderPath } = await window.arena.invoke('workspace:pick-folder', undefined);
      if (folderPath) {
        await window.arena.invoke('workspace:init', { projectFolder: folderPath });
        set({ projectFolder: folderPath });
      }
    } catch (err) {
      showError('workspace:pick-folder', err);
    }
  },

  clearProjectFolder: () => {
    set({ projectFolder: null });
  },

  fetchWorkspaceStatus: async () => {
    try {
      const { workspace } = await window.arena.invoke('workspace:status', undefined);
      if (workspace) {
        set({ projectFolder: workspace.projectFolder });
      }
    } catch {
      // Workspace not initialized yet — that's fine
    }
  },
}));
