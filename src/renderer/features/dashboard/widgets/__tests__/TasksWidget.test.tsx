// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveMeetingSummary } from '../../../../../shared/meeting-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import '../../../../i18n';
import { i18next } from '../../../../i18n';

type HookState = {
  meetings: ActiveMeetingSummary[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

const state: HookState = {
  meetings: null,
  loading: true,
  error: null,
  refresh: async () => {},
};

vi.mock('../../../../hooks/use-active-meetings', () => ({
  useActiveMeetings: (): HookState => state,
}));

import { TasksWidget } from '../TasksWidget';

const SAMPLE: ActiveMeetingSummary = {
  id: 'm1',
  projectId: 'p1',
  projectName: 'Alpha',
  channelId: 'c1',
  channelName: 'sprint',
  topic: 'Sprint review',
  stateIndex: 3,
  stateName: 'SYNTHESIZING',
  startedAt: 1700000000000,
  elapsedMs: 185_000,
};

function renderWidget() {
  return render(
    <ThemeProvider>
      <TasksWidget />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  state.meetings = null;
  state.loading = true;
  state.error = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('TasksWidget', () => {
  it('loading: renders a loading message', () => {
    state.meetings = null;
    state.loading = true;
    renderWidget();
    expect(screen.getByTestId('tasks-widget-loading')).toBeTruthy();
  });

  it('error: renders the error message with role=alert', () => {
    state.meetings = null;
    state.loading = false;
    state.error = new Error('boom');
    renderWidget();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('boom');
    expect(screen.getByTestId('tasks-widget-error')).toBeTruthy();
  });

  it('empty: renders empty-state label when meetings is an empty array', () => {
    state.meetings = [];
    state.loading = false;
    renderWidget();
    expect(screen.getByTestId('tasks-widget-empty')).toBeTruthy();
  });

  it('populated: renders one row per meeting with progress gauge + elapsed label', () => {
    state.meetings = [SAMPLE];
    state.loading = false;
    renderWidget();
    const rows = screen.getAllByTestId('tasks-widget-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-meeting-id')).toBe('m1');
    expect(screen.getByTestId('progress-gauge')).toBeTruthy();
    // Elapsed 185s → "3분 5초" in ko.
    const elapsed = screen.getByTestId('tasks-widget-row-activate');
    expect(elapsed.textContent).toContain('3분');
    expect(elapsed.textContent).toContain('5초');
  });
});
