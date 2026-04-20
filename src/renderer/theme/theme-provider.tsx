import { useEffect, type ReactNode } from 'react';

import { useThemeStore } from './theme-store';

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeKey = useThemeStore((s) => s.themeKey);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeKey;
    root.dataset.mode = mode;
  }, [themeKey, mode]);

  return <>{children}</>;
}
