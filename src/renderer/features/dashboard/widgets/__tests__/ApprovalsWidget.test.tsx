// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../../../shared/approval-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import '../../../../i18n';
import { i18next } from '../../../../i18n';

type HookState = {
  items: ApprovalItem[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

const state: HookState = {
  items: null,
  loading: true,
  error: null,
  refresh: async () => {},
};

vi.mock('../../../../hooks/use-pending-approvals', () => ({
  usePendingApprovals: (): HookState => state,
}));

import { ApprovalsWidget } from '../ApprovalsWidget';

function makeItem(id: string, kind: ApprovalItem['kind']): ApprovalItem {
  return {
    id,
    kind,
    projectId: null,
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: { note: 'preview' },
    status: 'pending',
    decisionComment: null,
    createdAt: 1700000000000,
    decidedAt: null,
  };
}

function renderWidget(limit?: number) {
  return render(
    <ThemeProvider>
      <ApprovalsWidget visibleLimit={limit} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  state.items = null;
  state.loading = true;
  state.error = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ApprovalsWidget', () => {
  it('loading state', () => {
    state.items = null;
    state.loading = true;
    renderWidget();
    expect(screen.getByTestId('approvals-widget-loading')).toBeTruthy();
  });

  it('error state', () => {
    state.items = null;
    state.loading = false;
    state.error = new Error('db down');
    renderWidget();
    expect(screen.getByRole('alert').textContent).toContain('db down');
  });

  it('empty state: no count badge rendered when list is empty', () => {
    state.items = [];
    state.loading = false;
    renderWidget();
    expect(screen.getByTestId('approvals-widget-empty')).toBeTruthy();
    expect(screen.queryByTestId('approvals-widget-count')).toBeNull();
  });

  it('renders count badge + only the first N rows when items exceed visibleLimit', () => {
    state.items = [
      makeItem('a1', 'cli_permission'),
      makeItem('a2', 'mode_transition'),
      makeItem('a3', 'consensus_decision'),
    ];
    state.loading = false;
    renderWidget(2);

    expect(screen.getAllByTestId('approvals-widget-row')).toHaveLength(2);
    const badge = screen.getByTestId('approvals-widget-count');
    expect(badge.textContent).toBe('3');
  });
});
