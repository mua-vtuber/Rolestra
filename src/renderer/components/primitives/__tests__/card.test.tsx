// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card, CardBody, CardFooter, CardHeader } from '..';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import type { ThemeKey } from '../../../theme/theme-tokens';

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

describe('Card — tactical corner brackets (G2)', () => {
  it('tactical theme renders 4 corner brackets', () => {
    useThemeStore.setState({ themeKey: 'tactical', mode: 'dark' });
    renderWithTheme(
      <Card data-testid="t-card">
        <CardBody>x</CardBody>
      </Card>,
    );
    const card = screen.getByTestId('t-card');
    expect(card.getAttribute('data-corner-brackets')).toBe('true');
    const brackets = screen.getAllByTestId('card-corner-bracket');
    expect(brackets).toHaveLength(4);
    const corners = brackets.map((b) => b.getAttribute('data-corner')).sort();
    expect(corners).toEqual(['bl', 'br', 'tl', 'tr']);
  });

  it.each<[ThemeKey]>([['warm'], ['retro']])(
    '%s theme renders no corner brackets',
    (themeKey) => {
      useThemeStore.setState({ themeKey, mode: 'light' });
      renderWithTheme(
        <Card data-testid="t-card">
          <CardBody>x</CardBody>
        </Card>,
      );
      expect(screen.getByTestId('t-card').getAttribute('data-corner-brackets')).toBe(
        'false',
      );
      expect(screen.queryAllByTestId('card-corner-bracket')).toHaveLength(0);
    },
  );

  it('cornerBrackets={false} disables them under tactical', () => {
    useThemeStore.setState({ themeKey: 'tactical', mode: 'dark' });
    renderWithTheme(
      <Card data-testid="t-card" cornerBrackets={false}>
        <CardBody>x</CardBody>
      </Card>,
    );
    expect(screen.getByTestId('t-card').getAttribute('data-corner-brackets')).toBe(
      'false',
    );
    expect(screen.queryAllByTestId('card-corner-bracket')).toHaveLength(0);
  });
});

describe('CardHeader — count badge (G1)', () => {
  it('retro renders [N] ASCII style', () => {
    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    renderWithTheme(
      <Card>
        <CardHeader heading="t" count={6} />
      </Card>,
    );
    const badge = screen.getByTestId('card-header-count');
    expect(badge.getAttribute('data-count-style')).toBe('ascii');
    expect(badge.textContent).toBe('[6]');
  });

  it.each<[ThemeKey]>([['warm'], ['tactical']])(
    '%s renders chip style with raw number',
    (themeKey) => {
      useThemeStore.setState({ themeKey, mode: 'light' });
      renderWithTheme(
        <Card>
          <CardHeader heading="t" count={4} />
        </Card>,
      );
      const badge = screen.getByTestId('card-header-count');
      expect(badge.getAttribute('data-count-style')).toBe('chip');
      expect(badge.textContent).toBe('4');
    },
  );

  it('count={0} hides the badge entirely', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    renderWithTheme(
      <Card>
        <CardHeader heading="t" count={0} />
      </Card>,
    );
    expect(screen.queryByTestId('card-header-count')).toBeNull();
  });

  it('count omitted hides the badge entirely', () => {
    useThemeStore.setState({ themeKey: 'tactical', mode: 'dark' });
    renderWithTheme(
      <Card>
        <CardHeader heading="t" />
      </Card>,
    );
    expect(screen.queryByTestId('card-header-count')).toBeNull();
  });
});

describe('CardHeader — retro ASCII frame prefix (G1)', () => {
  it('retro shows ┌─ glyph followed by ./heading', () => {
    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    renderWithTheme(
      <Card>
        <CardHeader heading="직원" />
      </Card>,
    );
    const header = screen.getByText('직원').closest('[data-title-style="ascii"]');
    expect(header?.textContent).toContain('┌─');
    expect(header?.textContent).toContain('./');
    expect(header?.textContent).toContain('직원');
  });

  it('warm/tactical do not render the ┌─ glyph or ./ prefix', () => {
    useThemeStore.setState({ themeKey: 'warm', mode: 'light' });
    renderWithTheme(
      <Card>
        <CardHeader heading="직원" />
      </Card>,
    );
    const header = screen.getByText('직원').closest('[data-title-style]');
    expect(header?.textContent).not.toContain('┌─');
    expect(header?.textContent).not.toContain('./');
  });
});
