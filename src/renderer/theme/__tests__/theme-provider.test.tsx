// @vitest-environment jsdom
/* eslint-disable i18next/no-literal-string */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, THEME_STORAGE_KEY, useThemeStore } from '../theme-store';
import { useTheme } from '../use-theme';
import { SYSTEM_DARK_QUERY } from '../use-system-color-scheme';

function resetStore(): void {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
  localStorage.removeItem(THEME_STORAGE_KEY);
}

/**
 * Minimal `window.matchMedia` double for `(prefers-color-scheme: dark)`:
 * every MediaQueryList it hands out reads the same `dark` flag, and
 * `setDark` notifies every registered 'change' listener like the OS would.
 */
function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      get matches() { return dark; },
      media: query,
      addEventListener: (_type: 'change', listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_type: 'change', listener: () => void) => { listeners.delete(listener); },
    } as unknown as MediaQueryList;
  });
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return {
    queries,
    listenerCount: () => listeners.size,
    setDark(next: boolean): void {
      dark = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function removeMatchMedia(): void {
  Reflect.deleteProperty(window, 'matchMedia');
}

function ModeProbe() {
  const { mode, modePreference } = useTheme();
  return <span data-testid="mode-probe" data-mode={mode} data-preference={modePreference} />;
}

describe('ThemeProvider — data attributes + persistence', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
    removeMatchMedia();
  });

  it('sets the tactical + dark defaults on <html> after mount', () => {
    render(<ThemeProvider><div>child</div></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe('tactical');
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('updates attributes when setTheme is called', () => {
    render(<ThemeProvider><div>child</div></ThemeProvider>);
    act(() => {
      useThemeStore.getState().setTheme('retro');
    });
    expect(document.documentElement.dataset.theme).toBe('retro');
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('updates attributes when setMode is called', () => {
    render(<ThemeProvider><div>child</div></ThemeProvider>);
    act(() => {
      useThemeStore.getState().setMode('light');
    });
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('persists theme+mode to localStorage under rolestra.theme.v1', () => {
    render(<ThemeProvider><div>child</div></ThemeProvider>);
    act(() => {
      useThemeStore.getState().setTheme('retro');
      useThemeStore.getState().setMode('light');
    });
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.state.themeKey).toBe('retro');
    expect(parsed.state.mode).toBe('light');
  });
});

describe('ThemeProvider — system brightness', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
    removeMatchMedia();
  });

  it('resolves "system" from prefers-color-scheme and keeps the preference stored', () => {
    const media = installMatchMedia(false);
    useThemeStore.setState({ mode: 'system' });
    const { getByTestId } = render(<ThemeProvider><ModeProbe /></ThemeProvider>);

    expect(media.queries).toContain(SYSTEM_DARK_QUERY);
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(getByTestId('mode-probe').dataset.mode).toBe('light');
    expect(getByTestId('mode-probe').dataset.preference).toBe('system');
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('follows an OS brightness change live, without a reload', () => {
    const media = installMatchMedia(false);
    useThemeStore.setState({ mode: 'system' });
    const { getByTestId } = render(<ThemeProvider><ModeProbe /></ThemeProvider>);
    expect(document.documentElement.dataset.mode).toBe('light');

    act(() => media.setDark(true));
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(getByTestId('mode-probe').dataset.mode).toBe('dark');

    act(() => media.setDark(false));
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('stops listening once an explicit brightness is chosen', () => {
    const media = installMatchMedia(true);
    useThemeStore.setState({ mode: 'system' });
    render(<ThemeProvider><ModeProbe /></ThemeProvider>);
    expect(media.listenerCount()).toBeGreaterThan(0);

    act(() => useThemeStore.getState().setMode('light'));
    expect(media.listenerCount()).toBe(0);
    act(() => media.setDark(true));
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('does not touch matchMedia while an explicit brightness is selected', () => {
    const media = installMatchMedia(true);
    render(<ThemeProvider><ModeProbe /></ThemeProvider>);
    expect(media.queries).toEqual([]);
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('throws a named error when "system" is selected but matchMedia is missing', () => {
    removeMatchMedia();
    useThemeStore.setState({ mode: 'system' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<ThemeProvider><ModeProbe /></ThemeProvider>))
        .toThrow(/matchMedia/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
