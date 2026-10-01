import { useEffect, type ReactNode } from 'react';

import { useThemeStore } from './theme-store';
import { useResolvedThemeMode } from './use-system-color-scheme';

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Mirrors the theme choice onto `<html data-theme data-mode>` so
 * `tokens.css` picks the matching block. `data-mode` is always the
 * resolved light/dark mode — a `'system'` preference follows the OS live.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeKey = useThemeStore((s) => s.themeKey);
  const mode = useResolvedThemeMode(useThemeStore((s) => s.mode));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeKey;
    root.dataset.mode = mode;
  }, [themeKey, mode]);

  return <>{children}</>;
}
