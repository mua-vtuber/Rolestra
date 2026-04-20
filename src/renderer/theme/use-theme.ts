import { useMemo } from 'react';

import { THEMES, comboKey, type ThemeToken, type ThemeKey, type ThemeMode } from './theme-tokens';
import { useThemeStore } from './theme-store';

export interface UseThemeResult {
  themeKey: ThemeKey;
  mode: ThemeMode;
  token: ThemeToken;
  setTheme: (key: ThemeKey) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

export function useTheme(): UseThemeResult {
  const themeKey = useThemeStore((s) => s.themeKey);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  const token = useMemo(() => THEMES[comboKey(themeKey, mode)], [themeKey, mode]);

  return { themeKey, mode, token, setTheme, setMode, toggleMode };
}
