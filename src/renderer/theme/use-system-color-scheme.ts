/**
 * use-system-color-scheme — the OS light/dark preference for the
 * `'system'` brightness setting (spec 2026-10-01-messenger-redesign.md R1-2).
 *
 * Reads `prefers-color-scheme` through `window.matchMedia` and re-renders
 * when the OS switches, so a "system" user sees the change without a
 * reload. The media query is only touched while the preference actually
 * is `'system'`; an explicit light/dark choice never subscribes.
 *
 * A missing `window.matchMedia` is an error, not a guess: Electron's
 * renderer always has it, so its absence means the environment cannot
 * honour the setting and the caller should see why.
 */
import { useSyncExternalStore } from 'react';

import type { ThemeModePreference } from './theme-store';
import type { ThemeMode } from './theme-tokens';

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

function darkSchemeQuery(): MediaQueryList {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    throw new Error(
      `window.matchMedia is unavailable, so the "system" brightness setting cannot read ${SYSTEM_DARK_QUERY}`,
    );
  }
  return window.matchMedia(SYSTEM_DARK_QUERY);
}

function subscribeToSystemScheme(onChange: () => void): () => void {
  const query = darkSchemeQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readSystemScheme(): ThemeMode {
  return darkSchemeQuery().matches ? 'dark' : 'light';
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function readNothing(): null {
  return null;
}

/** The OS scheme while `enabled`, otherwise `null` (no media query touched). */
export function useSystemColorScheme(enabled: boolean): ThemeMode | null {
  return useSyncExternalStore<ThemeMode | null>(
    enabled ? subscribeToSystemScheme : subscribeToNothing,
    enabled ? readSystemScheme : readNothing,
  );
}

/** The light/dark mode a brightness preference renders as right now. */
export function useResolvedThemeMode(preference: ThemeModePreference): ThemeMode {
  const systemScheme = useSystemColorScheme(preference === 'system');
  if (preference !== 'system') return preference;
  if (systemScheme === null) {
    throw new Error('The "system" brightness preference was not resolved from prefers-color-scheme');
  }
  return systemScheme;
}
