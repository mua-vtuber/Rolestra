// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, THEME_STORAGE_KEY, useThemeStore } from '../theme-store';

function resetStore(): void {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
  localStorage.removeItem(THEME_STORAGE_KEY);
}

describe('ThemeProvider — data attributes + persistence', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('sets data-theme + data-mode on <html> after mount', () => {
    render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    );
    expect(document.documentElement.dataset.theme).toBe('warm');
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('updates attributes when setTheme is called', () => {
    render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    );
    act(() => {
      useThemeStore.getState().setTheme('tactical');
    });
    expect(document.documentElement.dataset.theme).toBe('tactical');
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('updates attributes when setMode is called', () => {
    render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    );
    act(() => {
      useThemeStore.getState().setMode('dark');
    });
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('toggleMode flips between light and dark', () => {
    render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    );
    act(() => {
      useThemeStore.getState().toggleMode();
    });
    expect(document.documentElement.dataset.mode).toBe('dark');
    act(() => {
      useThemeStore.getState().toggleMode();
    });
    expect(document.documentElement.dataset.mode).toBe('light');
  });

  it('persists theme+mode to localStorage under rolestra.theme.v1', () => {
    render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    );
    act(() => {
      useThemeStore.getState().setTheme('retro');
      useThemeStore.getState().setMode('dark');
    });
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.state.themeKey).toBe('retro');
    expect(parsed.state.mode).toBe('dark');
  });
});
