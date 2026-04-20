// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '..';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('Button — cva variants + theme auto-shape', () => {
  it.each([
    ['warm' as const, 'pill'],
    ['tactical' as const, 'notched'],
    ['retro' as const, 'text'],
  ])('shape="auto" under %s theme picks %s', (themeKey, expectedShape) => {
    useThemeStore.setState({ themeKey, mode: 'light' });
    renderWithTheme(<Button shape="auto">click</Button>);
    const btn = screen.getByRole('button', { name: 'click' });
    expect(btn.getAttribute('data-shape')).toBe(expectedShape);
  });

  it('tone=primary references brand utility class', () => {
    renderWithTheme(<Button tone="primary">primary</Button>);
    const btn = screen.getByRole('button', { name: 'primary' });
    expect(btn.className).toContain('bg-brand');
  });

  it('asChild prop renders a Slot (custom element) instead of button', () => {
    renderWithTheme(
      <Button asChild>
        <a href="#/target">link</a>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'link' });
    expect(link.getAttribute('href')).toBe('#/target');
  });
});
