// @vitest-environment jsdom
/* eslint-disable i18next/no-literal-string */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../i18n';
import { NavRail, Shell } from '..';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import type { ThemeComboKey } from '../../../theme/theme-tokens';

const COMBOS: ReadonlyArray<ThemeComboKey> = [
  'tactical-light',
  'tactical-dark',
  'retro-light',
  'retro-dark',
];

// Shell is a slot layout: the nav slot and the view content. There is no
// top bar any more (spec 2026-10-01-messenger-redesign.md R2-1).
function renderShell() {
  return render(
    <ThemeProvider>
      <Shell
        nav={<NavRail items={[{ id: 'messenger', icon: 'chat', label: 'Chat' }]} activeId="messenger" />}
      >
        <div data-testid="view-content">main</div>
      </Shell>
    </ThemeProvider>
  );
}

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
});

describe('Shell — layout + theme attributes', () => {
  it.each(COMBOS)('renders core regions under %s', (combo) => {
    const [themeKey, mode] = combo.split('-') as ['tactical' | 'retro', 'light' | 'dark'];
    useThemeStore.setState({ themeKey, mode });
    renderShell();

    expect(screen.getByTestId('shell-root')).toBeTruthy();
    expect(screen.getByTestId('nav-rail')).toBeTruthy();
    expect(screen.getByTestId('view-content')).toBeTruthy();
    expect(screen.queryByTestId('shell-topbar')).toBeNull();

    expect(document.documentElement.dataset.theme).toBe(themeKey);
    expect(document.documentElement.dataset.mode).toBe(mode);
  });

  it('draws the screen overlay from its token without taking clicks', () => {
    renderShell();
    const overlay = screen.getByTestId('shell-screen-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).toContain('bg-screen-overlay');
  });
});
