// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../../../shared/approval-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import { ThemeProvider } from '../../../../theme/theme-provider';
import '../../../../i18n';
import { i18next } from '../../../../i18n';
import { useActiveChannelStore } from '../../../../stores/active-channel-store';
import {
  DEFAULT_APP_VIEW,
  useAppViewStore,
} from '../../../../stores/app-view-store';

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

// Stub out useActiveProject + useSystemChannel so the widget's default
// onRowActivate has the ids it needs without a real IPC round-trip.
const activeProjectState = { id: 'p-1' as string | null };
vi.mock('../../../../hooks/use-active-project', () => ({
  useActiveProject: () => ({
    activeProjectId: activeProjectState.id,
    setActive: async () => {},
  }),
}));

const systemChannelState = { channelId: 'c-approval' as string | null };
vi.mock('../../../../hooks/use-system-channel', () => ({
  useSystemChannel: () => ({
    channelId: systemChannelState.channelId,
    loading: false,
    error: null,
  }),
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
  activeProjectState.id = 'p-1';
  systemChannelState.channelId = 'c-approval';
  useActiveChannelStore.setState({ channelIdByProject: {} });
  useAppViewStore.setState({ view: DEFAULT_APP_VIEW });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  useActiveChannelStore.setState({ channelIdByProject: {} });
  useAppViewStore.setState({ view: DEFAULT_APP_VIEW });
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

describe('ApprovalsWidget — R7-Task10 row activation', () => {
  it('default row click → sets active channel + switches view to messenger', () => {
    state.items = [makeItem('a1', 'cli_permission')];
    state.loading = false;
    renderWidget();

    fireEvent.click(screen.getByTestId('approvals-widget-row-activate'));

    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-1': 'c-approval',
    });
    expect(useAppViewStore.getState().view).toBe('messenger');
  });

  it('projectId=null → click is a safe no-op (no store mutation, no crash)', () => {
    activeProjectState.id = null;
    systemChannelState.channelId = null;
    state.items = [makeItem('a1', 'cli_permission')];
    state.loading = false;
    renderWidget();

    const before = useActiveChannelStore.getState().channelIdByProject;
    fireEvent.click(screen.getByTestId('approvals-widget-row-activate'));

    // Nothing changed.
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual(before);
    expect(useAppViewStore.getState().view).toBe(DEFAULT_APP_VIEW);
  });

  it('custom onRowActivate prop overrides default behaviour', () => {
    const custom = vi.fn();
    state.items = [makeItem('a1', 'cli_permission')];
    state.loading = false;
    render(
      <ThemeProvider>
        <ApprovalsWidget onRowActivate={custom} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('approvals-widget-row-activate'));

    expect(custom).toHaveBeenCalledTimes(1);
    // Default side effects MUST NOT fire when a custom handler is passed.
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({});
    expect(useAppViewStore.getState().view).toBe(DEFAULT_APP_VIEW);
  });

  it('system_approval channel missing → still flips view but no active channel change', () => {
    systemChannelState.channelId = null;
    state.items = [makeItem('a1', 'cli_permission')];
    state.loading = false;
    renderWidget();

    fireEvent.click(screen.getByTestId('approvals-widget-row-activate'));

    // Active channel untouched (inboxChannelId was null) but view flipped
    // so the user lands on the messenger and can pick a channel manually.
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({});
    expect(useAppViewStore.getState().view).toBe('messenger');
  });
});
