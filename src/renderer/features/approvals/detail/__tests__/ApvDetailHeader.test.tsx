// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApvDetailHeader } from '../ApvDetailHeader';
import type { ApprovalItem } from '../../../../../shared/approval-types';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'app-1',
    kind: 'cli_permission',
    projectId: null,
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: null,
    status: 'pending',
    decisionComment: null,
    createdAt: 0,
    decidedAt: null,
    ...overrides,
  };
}

function renderHeader(approval: ApprovalItem) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApvDetailHeader approval={approval} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ApvDetailHeader (R11-Task7)', () => {
  it('shows the kind label and pending badge for a pending approval', () => {
    renderHeader(makeItem());
    const root = screen.getByTestId('apv-detail-header');
    expect(root.getAttribute('data-kind')).toBe('cli_permission');
    expect(root.getAttribute('data-status')).toBe('pending');
    const badge = screen.getByTestId('approval-status-badge');
    expect(badge.getAttribute('data-decision')).toBe('pending');
  });

  it('approved status → approved badge', () => {
    renderHeader(makeItem({ status: 'approved' }));
    expect(
      screen.getByTestId('approval-status-badge').getAttribute('data-decision'),
    ).toBe('approved');
  });

  it('expired/superseded fold into rejected on the badge', () => {
    const { rerender } = renderHeader(makeItem({ status: 'expired' }));
    expect(
      screen.getByTestId('approval-status-badge').getAttribute('data-decision'),
    ).toBe('rejected');
    rerender(
      <ThemeProvider>
        <ApvDetailHeader approval={makeItem({ status: 'superseded' })} />
      </ThemeProvider>,
    );
    expect(
      screen.getByTestId('approval-status-badge').getAttribute('data-decision'),
    ).toBe('rejected');
  });

  it('renders correct kind labels for each approval kind', () => {
    const kinds = [
      'cli_permission',
      'mode_transition',
      'consensus_decision',
      'review_outcome',
      'failure_report',
      'circuit_breaker',
    ] as const;
    for (const kind of kinds) {
      cleanup();
      renderHeader(makeItem({ kind }));
      const title = screen.getByTestId('apv-detail-header-title');
      expect(title.textContent?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
