/**
 * Applies the user's theme preference to the document.
 *
 * Reads uiTheme from config:get-settings on mount and listens
 * for arena:settings-saved events to keep in sync.
 * Sets data-theme attribute on <html>.
 */

import { useEffect, useState } from 'react';
import type { SettingsConfig } from '../../shared/config-types';

export function useTheme(): void {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const fetchTheme = async (): Promise<void> => {
      try {
        const result = await window.arena.invoke('config:get-settings', undefined);
        setTheme(result.settings.uiTheme);
      } catch {
        // Fall back to default
      }
    };
    void fetchTheme();
  }, []);

  // Listen for settings save events from SettingsView
  useEffect(() => {
    const handler = (e: Event): void => {
      const settings = (e as CustomEvent<SettingsConfig>).detail;
      if (settings?.uiTheme) {
        setTheme(settings.uiTheme);
      }
    };
    window.addEventListener('arena:settings-saved', handler);
    return () => window.removeEventListener('arena:settings-saved', handler);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}
