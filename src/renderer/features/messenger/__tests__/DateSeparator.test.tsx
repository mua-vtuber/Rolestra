// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DateSeparator } from '../DateSeparator';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';

afterEach(() => {
  cleanup();
});

describe('DateSeparator', () => {
  it('renders the supplied label', () => {
    render(<DateSeparator label="오늘, 2026년 4월 21일" />);
    const sep = screen.getByTestId('date-separator');
    expect(sep.getAttribute('data-label')).toBe('오늘, 2026년 4월 21일');
    expect(screen.getByTestId('date-separator-label').textContent).toBe(
      '오늘, 2026년 4월 21일',
    );
  });

  it('uses role=separator for a11y', () => {
    render(<DateSeparator label="x" />);
    const sep = screen.getByTestId('date-separator');
    expect(sep.getAttribute('role')).toBe('separator');
  });

  it('source contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'DateSeparator.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});

describe('DateSeparator — log layout (spec 2026-10-01-messenger-redesign.md R3-3)', () => {
  afterEach(() => useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE }));

  it('draws "──── 날짜 ────" as one line', () => {
    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    render(<ThemeProvider><DateSeparator label="2026년 10월 1일 목요일" /></ThemeProvider>);
    expect(screen.getByTestId('date-separator-label').textContent)
      .toBe('──────── 2026년 10월 1일 목요일 ────────');
  });
});
