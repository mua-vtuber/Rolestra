import { useMemo } from 'react';

import { THEMES, comboKey, type ThemeToken, type ThemeKey, type ThemeMode } from './theme-tokens';
import { useThemeStore, type ThemeModePreference } from './theme-store';
import { useResolvedThemeMode } from './use-system-color-scheme';

export interface UseThemeResult {
  themeKey: ThemeKey;
  /** The light/dark mode currently rendered (`'system'` already resolved). */
  mode: ThemeMode;
  /** The stored brightness choice, which may be `'system'`. */
  modePreference: ThemeModePreference;
  token: ThemeToken;
  setTheme: (key: ThemeKey) => void;
  setMode: (mode: ThemeModePreference) => void;
}

export function useTheme(): UseThemeResult {
  const themeKey = useThemeStore((s) => s.themeKey);
  const modePreference = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const mode = useResolvedThemeMode(modePreference);

  const token = useMemo(() => THEMES[comboKey(themeKey, mode)], [themeKey, mode]);

  return { themeKey, mode, modePreference, token, setTheme, setMode };
}
