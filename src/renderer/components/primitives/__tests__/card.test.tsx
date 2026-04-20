// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card, CardBody, CardFooter, CardHeader } from '..';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('Card — theme-driven header style', () => {
  it.each([
    ['warm' as const, 'divider'],
    ['tactical' as const, 'bar'],
    ['retro' as const, 'ascii'],
  ])('under %s theme, CardHeader data-title-style=%s', (themeKey, expectedStyle) => {
    useThemeStore.setState({ themeKey, mode: 'light' });
    renderWithTheme(
      <Card>
        <CardHeader heading="heading">extra</CardHeader>
        <CardBody>body</CardBody>
        <CardFooter>footer</CardFooter>
      </Card>
    );
    const header = screen.getByText('heading').closest('[data-title-style]');
    expect(header?.getAttribute('data-title-style')).toBe(expectedStyle);
    expect(screen.getByText('body')).toBeTruthy();
    expect(screen.getByText('footer')).toBeTruthy();
  });
});
