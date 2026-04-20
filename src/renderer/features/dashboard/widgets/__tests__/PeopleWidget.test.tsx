// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberView } from '../../../../../shared/member-profile-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import '../../../../i18n';
import { i18next } from '../../../../i18n';

type HookState = {
  members: MemberView[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

const state: HookState = {
  members: null,
  loading: true,
  error: null,
  refresh: async () => {},
};

vi.mock('../../../../hooks/use-members', () => ({
  useMembers: (): HookState => state,
}));

import { PeopleWidget } from '../PeopleWidget';

const ALPHA: MemberView = {
  providerId: 'p-1',
  role: 'dev',
  personality: '',
  expertise: '',
  avatarKind: 'default',
  avatarData: 'blue-dev',
  statusOverride: null,
  updatedAt: 1,
  displayName: 'Alpha',
  persona: '',
  workStatus: 'online',
};

const BETA: MemberView = {
  ...ALPHA,
  providerId: 'p-2',
  displayName: 'Beta',
  workStatus: 'offline-manual',
  role: '',
};

function renderWidget() {
  return render(
    <ThemeProvider>
      <PeopleWidget />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  state.members = null;
  state.loading = true;
  state.error = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('PeopleWidget', () => {
  it('loading: renders a loading message', () => {
    state.members = null;
    state.loading = true;
    renderWidget();
    expect(screen.getByTestId('people-widget-loading')).toBeTruthy();
  });

  it('error: renders the error message with role=alert', () => {
    state.members = null;
    state.loading = false;
    state.error = new Error('nope');
    renderWidget();
    expect(screen.getByRole('alert').textContent).toContain('nope');
  });

  it('empty: renders empty-state label when members is an empty array', () => {
    state.members = [];
    state.loading = false;
    renderWidget();
    expect(screen.getByTestId('people-widget-empty')).toBeTruthy();
  });

  it('populated: renders one row per member with status dot + role', () => {
    state.members = [ALPHA, BETA];
    state.loading = false;
    renderWidget();
    const rows = screen.getAllByTestId('people-widget-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-provider-id')).toBe('p-1');
    expect(rows[0].getAttribute('data-status')).toBe('online');
    expect(rows[1].getAttribute('data-status')).toBe('offline-manual');

    const dots = screen.getAllByTestId('people-widget-status-dot');
    // online → bg-success; offline-manual → bg-fg-muted
    expect(dots[0].className).toContain('bg-success');
    expect(dots[1].className).toContain('bg-fg-muted');
  });
});
