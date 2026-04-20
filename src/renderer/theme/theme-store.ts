import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ThemeKey, ThemeMode } from './theme-tokens';

const STORAGE_KEY = 'rolestra.theme.v1';
const DEFAULT_THEME: ThemeKey = 'warm';
const DEFAULT_MODE: ThemeMode = 'light';

export interface ThemeState {
  themeKey: ThemeKey;
  mode: ThemeMode;
  setTheme: (key: ThemeKey) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeKey: DEFAULT_THEME,
      mode: DEFAULT_MODE,
      setTheme: (themeKey) => set({ themeKey }),
      setMode: (mode) => set({ mode }),
      toggleMode: () => set((state) => ({ mode: state.mode === 'light' ? 'dark' : 'light' })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ themeKey: state.themeKey, mode: state.mode }),
    }
  )
);

export { STORAGE_KEY as THEME_STORAGE_KEY, DEFAULT_THEME, DEFAULT_MODE };
