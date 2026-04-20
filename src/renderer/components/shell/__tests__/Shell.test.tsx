// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../i18n';
import { NavRail, ProjectRail, Shell, ShellTopBar } from '..';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import type { ThemeComboKey } from '../../../theme/theme-tokens';

const COMBOS: ReadonlyArray<ThemeComboKey> = [
  'warm-light',
  'warm-dark',
  'tactical-light',
  'tactical-dark',
  'retro-light',
  'retro-dark',
];

function renderShell() {
  return render(
    <ThemeProvider>
      <Shell
        nav={<NavRail items={[{ id: 'dashboard', icon: 'dashboard', label: 'Dashboard' }]} activeId="dashboard" />}
        rail={<ProjectRail projects={[{ id: 'p1', name: 'Demo', unread: 2 }]} activeProjectId="p1" />}
        topBar={<ShellTopBar title="Office" subtitle="Welcome" />}
      >
        <div>main</div>
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
    const [themeKey, mode] = combo.split('-') as ['warm' | 'tactical' | 'retro', 'light' | 'dark'];
    useThemeStore.setState({ themeKey, mode });
    renderShell();

    expect(screen.getByTestId('shell-root')).toBeTruthy();
    expect(screen.getByTestId('nav-rail')).toBeTruthy();
    expect(screen.getByTestId('project-rail')).toBeTruthy();
    expect(screen.getByTestId('shell-topbar')).toBeTruthy();

    expect(document.documentElement.dataset.theme).toBe(themeKey);
    expect(document.documentElement.dataset.mode).toBe(mode);
  });

  it('ShellTopBar renders the office title and optional subtitle', () => {
    renderShell();
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.getByText('Welcome')).toBeTruthy();
  });
});
