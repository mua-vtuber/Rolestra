// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../i18n';
import { NavRail, Shell, ShellTopBar } from '..';
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

// R12-C 정리 #3 — Shell 은 슬롯 레이아웃 컴포넌트라 rail 슬롯에 어떤 컴포넌트를
// 끼워도 layout 책임만 검증된다. 이전 ProjectRail 의존을 stub div 로 대체해
// Shell 컴포넌트 단위 테스트를 dead-component 정리와 분리한다.
function renderShell() {
  return render(
    <ThemeProvider>
      <Shell
        nav={<NavRail items={[{ id: 'dashboard', icon: 'dashboard', label: 'Dashboard' }]} activeId="dashboard" />}
        rail={<div data-testid="project-rail">stub-rail</div>}
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
