// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KpiSnapshot } from '../../../../shared/dashboard-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

type DashboardKpisState = {
  data: KpiSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

const kpisState: DashboardKpisState = {
  data: null,
  loading: true,
  error: null,
  refresh: async () => {},
};

const activeProjectState: { activeProjectId: string | null } = {
  activeProjectId: null,
};

vi.mock('../../../hooks/use-dashboard-kpis', () => ({
  useDashboardKpis: (): DashboardKpisState => kpisState,
}));

vi.mock('../../../hooks/use-active-project', () => ({
  useActiveProject: () => ({
    activeProjectId: activeProjectState.activeProjectId,
    setActive: async () => {},
    clear: () => {},
  }),
}));

// Import after vi.mock so the hooks are intercepted.
import { DashboardPage } from '../DashboardPage';

const SUCCESS_SNAPSHOT: KpiSnapshot = {
  activeProjects: 3,
  activeMeetings: 1,
  pendingApprovals: 0,
  completedToday: 5,
  asOf: 1_700_000_000_000,
};

function renderPage(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  kpisState.data = null;
  kpisState.loading = true;
  kpisState.error = null;
  activeProjectState.activeProjectId = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('DashboardPage — loading state', () => {
  it('renders 4 skeleton tiles while data is null + loading=true', () => {
    kpisState.data = null;
    kpisState.loading = true;
    kpisState.error = null;
    renderPage(<DashboardPage />);

    const tiles = screen.getAllByTestId('hero-kpi-tile');
    expect(tiles).toHaveLength(4);
    tiles.forEach((tile) => {
      expect(tile.getAttribute('aria-busy')).toBe('true');
    });
    expect(screen.getAllByTestId('hero-kpi-skeleton')).toHaveLength(4);
    expect(screen.queryByTestId('dashboard-error-banner')).toBeNull();
  });
});

describe('DashboardPage — error state', () => {
  it('shows an error banner with the thrown message + tiles remain skeletons', () => {
    kpisState.data = null;
    kpisState.loading = false;
    kpisState.error = new Error('boom — ipc lost');
    renderPage(<DashboardPage />);

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('boom — ipc lost');
    // Skeletons still present — UX does not fabricate a zeroed snapshot.
    expect(screen.getAllByTestId('hero-kpi-skeleton')).toHaveLength(4);
  });

  it('falls back to the translated generic message when error.message is empty', () => {
    kpisState.data = null;
    kpisState.loading = false;
    kpisState.error = new Error('');
    renderPage(<DashboardPage />);

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('지표를 불러오지 못했습니다. 다시 시도해 주세요.');
  });
});

describe('DashboardPage — success state', () => {
  it('renders each tile with the real KPI value', () => {
    kpisState.data = SUCCESS_SNAPSHOT;
    kpisState.loading = false;
    kpisState.error = null;
    renderPage(<DashboardPage />);

    expect(screen.queryByTestId('dashboard-error-banner')).toBeNull();
    expect(screen.queryAllByTestId('hero-kpi-skeleton')).toHaveLength(0);

    const tiles = screen.getAllByTestId('hero-kpi-tile');
    expect(tiles.map((t) => t.getAttribute('data-variant'))).toEqual([
      'projects',
      'meetings',
      'approvals',
      'completed',
    ]);
    const values = screen.getAllByTestId('hero-kpi-value').map((v) => v.textContent);
    expect(values).toEqual(['3', '1', '0', '5']);
  });
});

describe('DashboardPage — quick actions wiring', () => {
  it('invokes onRequestNewProject when "+ 새 프로젝트" is clicked', () => {
    kpisState.data = SUCCESS_SNAPSHOT;
    kpisState.loading = false;
    const onRequestNewProject = vi.fn();
    renderPage(<DashboardPage onRequestNewProject={onRequestNewProject} />);

    fireEvent.click(screen.getByTestId('hero-quick-action-new-project'));
    expect(onRequestNewProject).toHaveBeenCalledTimes(1);
  });

  it('meeting button is disabled (aria-disabled=true) when activeProjectId is null', () => {
    kpisState.data = SUCCESS_SNAPSHOT;
    kpisState.loading = false;
    activeProjectState.activeProjectId = null;
    renderPage(<DashboardPage />);

    expect(
      screen.getByTestId('hero-quick-action-meeting').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('meeting button is enabled + calls onRequestStartMeeting when activeProjectId is set', () => {
    kpisState.data = SUCCESS_SNAPSHOT;
    kpisState.loading = false;
    activeProjectState.activeProjectId = 'p-demo';
    const onRequestStartMeeting = vi.fn();
    renderPage(<DashboardPage onRequestStartMeeting={onRequestStartMeeting} />);

    const meeting = screen.getByTestId('hero-quick-action-meeting');
    expect(meeting.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(meeting);
    expect(onRequestStartMeeting).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardPage — layout placeholders', () => {
  it('renders Task7 grid + Task8 insight placeholders', () => {
    kpisState.data = SUCCESS_SNAPSHOT;
    kpisState.loading = false;
    renderPage(<DashboardPage />);

    expect(screen.getByTestId('dashboard-grid-placeholder')).toBeTruthy();
    expect(screen.getByTestId('dashboard-insight-placeholder')).toBeTruthy();
  });
});

describe('DashboardPage — source-level hardcoded color guard', () => {
  it('DashboardPage.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'DashboardPage.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
