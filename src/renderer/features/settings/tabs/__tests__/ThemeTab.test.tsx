// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import '../../../../i18n';
import { useThemeStore } from '../../../../theme/theme-store';
import { ThemeTab } from '../ThemeTab';

beforeEach(() => {
  // Reset to a known theme between tests.
  useThemeStore.getState().setTheme('warm');
  useThemeStore.getState().setMode('light');
});

afterEach(() => {
  cleanup();
});

describe('ThemeTab', () => {
  it('renders 3 theme-key options and 2 mode options', () => {
    render(<ThemeTab />);

    const keyOptions = screen.getAllByTestId('settings-theme-key-option');
    expect(keyOptions.map((el) => el.getAttribute('data-key'))).toEqual([
      'warm',
      'tactical',
      'retro',
    ]);

    const modeOptions = screen.getAllByTestId('settings-theme-mode-option');
    expect(modeOptions.map((el) => el.getAttribute('data-mode'))).toEqual([
      'light',
      'dark',
    ]);
  });

  it('marks the active theme key with data-active', () => {
    render(<ThemeTab />);

    const warm = screen
      .getAllByTestId('settings-theme-key-option')
      .find((el) => el.getAttribute('data-key') === 'warm')!;
    expect(warm.getAttribute('data-active')).toBe('true');
  });

  it('clicking a theme-key option mutates the store', () => {
    render(<ThemeTab />);

    const tactical = screen
      .getAllByTestId('settings-theme-key-option')
      .find((el) => el.getAttribute('data-key') === 'tactical')!;
    const radio = tactical.querySelector('input[type="radio"]')!;

    act(() => {
      fireEvent.click(radio);
    });

    expect(useThemeStore.getState().themeKey).toBe('tactical');
  });

  it('clicking a mode option mutates the store', () => {
    render(<ThemeTab />);

    const dark = screen
      .getAllByTestId('settings-theme-mode-option')
      .find((el) => el.getAttribute('data-mode') === 'dark')!;
    const radio = dark.querySelector('input[type="radio"]')!;

    act(() => {
      fireEvent.click(radio);
    });

    expect(useThemeStore.getState().mode).toBe('dark');
  });
});
