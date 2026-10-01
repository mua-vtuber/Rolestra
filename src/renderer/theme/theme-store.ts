import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ThemeKey, ThemeMode } from './theme-tokens';

/**
 * Brightness preference. `'system'` follows the OS `prefers-color-scheme`
 * and is resolved to a {@link ThemeMode} by `use-system-color-scheme.ts`;
 * the stored value stays `'system'`.
 */
export type ThemeModePreference = ThemeMode | 'system';

const STORAGE_KEY = 'rolestra.theme.v1';
/** Persisted shape version. Bump it whenever the stored theme set changes. */
const THEME_STORE_VERSION = 1;
const DEFAULT_THEME: ThemeKey = 'tactical';
const DEFAULT_MODE: ThemeModePreference = 'dark';

export interface ThemeState {
  themeKey: ThemeKey;
  /** Brightness preference (light / dark / system), not the resolved mode. */
  mode: ThemeModePreference;
  setTheme: (key: ThemeKey) => void;
  setMode: (mode: ThemeModePreference) => void;
}

type PersistedThemeState = Pick<ThemeState, 'themeKey' | 'mode'>;

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeKey: DEFAULT_THEME,
      mode: DEFAULT_MODE,
      setTheme: (themeKey) => set({ themeKey }),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: STORAGE_KEY,
      version: THEME_STORE_VERSION,
      partialize: (state): PersistedThemeState => ({ themeKey: state.themeKey, mode: state.mode }),
      // A preference written by another store version (version 0 still had
      // the removed 'warm' theme) is reset to the defaults on purpose: the
      // app was never released, so there is no earlier preference to carry
      // over. zustand calls this only when the stored version differs.
      migrate: (): PersistedThemeState => ({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE }),
    }
  )
);

export {
  STORAGE_KEY as THEME_STORAGE_KEY,
  THEME_STORE_VERSION,
  DEFAULT_THEME,
  DEFAULT_MODE,
};
