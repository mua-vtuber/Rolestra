// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_STORE_VERSION,
  useThemeStore,
} from '../theme-store';

function writeStored(state: unknown, version: number): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state, version }));
}

function readStored(): { state: { themeKey: unknown; mode: unknown }; version: number } {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === null) throw new Error('theme preference was not written');
  return JSON.parse(raw) as { state: { themeKey: unknown; mode: unknown }; version: number };
}

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('theme store — defaults', () => {
  it('starts on tactical + dark', () => {
    expect(DEFAULT_THEME).toBe('tactical');
    expect(DEFAULT_MODE).toBe('dark');
  });

  it('accepts the system brightness preference and persists it as-is', () => {
    useThemeStore.getState().setMode('system');
    expect(useThemeStore.getState().mode).toBe('system');
    expect(readStored().state.mode).toBe('system');
    expect(readStored().version).toBe(THEME_STORE_VERSION);
  });
});

describe('theme store — stored preference from an older store version', () => {
  it('resets a version-0 warm preference to the defaults and rewrites storage', async () => {
    useThemeStore.setState({ themeKey: 'retro', mode: 'light' });
    writeStored({ themeKey: 'warm', mode: 'light' }, 0);

    await useThemeStore.persist.rehydrate();

    expect(useThemeStore.getState().themeKey).toBe(DEFAULT_THEME);
    expect(useThemeStore.getState().mode).toBe(DEFAULT_MODE);
    const stored = readStored();
    expect(stored.version).toBe(THEME_STORE_VERSION);
    expect(stored.state).toEqual({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  });

  it('resets an older-version preference even when its values are still valid', async () => {
    writeStored({ themeKey: 'retro', mode: 'light' }, 0);

    await useThemeStore.persist.rehydrate();

    expect(useThemeStore.getState().themeKey).toBe(DEFAULT_THEME);
    expect(useThemeStore.getState().mode).toBe(DEFAULT_MODE);
  });

  it('keeps a preference written by the current store version', async () => {
    writeStored({ themeKey: 'retro', mode: 'system' }, THEME_STORE_VERSION);

    await useThemeStore.persist.rehydrate();

    expect(useThemeStore.getState().themeKey).toBe('retro');
    expect(useThemeStore.getState().mode).toBe('system');
  });
});
