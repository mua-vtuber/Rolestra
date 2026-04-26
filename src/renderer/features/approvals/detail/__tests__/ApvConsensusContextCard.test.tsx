// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../../theme/theme-store';
import '../../../../i18n';
import { ApvConsensusContextCard } from '../ApvConsensusContextCard';
import type { ApprovalConsensusContext } from '../../../../../shared/approval-detail-types';

function renderCard(context: ApprovalConsensusContext | null) {
  useThemeStore.getState().setTheme(DEFAULT_THEME);
  useThemeStore.getState().setMode(DEFAULT_MODE);
  return render(
    <ThemeProvider>
      <ApvConsensusContextCard context={context} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ApvConsensusContextCard (R11-Task7)', () => {
  it('renders nothing when context is null (no meetingId on approval)', () => {
    const { container } = renderCard(null);
    expect(container.querySelector('[data-testid="apv-consensus-card"]')).toBeNull();
  });

  it('empty votes → renders placeholder', () => {
    renderCard({ meetingId: 'mtg-1', participantVotes: [] });
    expect(screen.getByTestId('apv-consensus-empty')).toBeTruthy();
    expect(screen.queryByTestId('apv-consensus-list')).toBeNull();
  });

  it('renders one row per vote with provider id and chip', () => {
    renderCard({
      meetingId: 'mtg-1',
      participantVotes: [
        { providerId: 'p-a', vote: 'approve' },
        { providerId: 'p-b', vote: 'reject', comment: '거부' },
        { providerId: 'p-c', vote: 'abstain' },
      ],
    });
    const rows = screen.getAllByTestId('apv-consensus-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('data-vote'))).toEqual([
      'approve',
      'reject',
      'abstain',
    ]);
  });

  it('comment is rendered when present, hidden when absent', () => {
    renderCard({
      meetingId: 'mtg-1',
      participantVotes: [
        { providerId: 'p-a', vote: 'approve' },
        { providerId: 'p-b', vote: 'reject', comment: '거부' },
      ],
    });
    const comments = screen.queryAllByTestId('apv-consensus-comment');
    expect(comments).toHaveLength(1);
    expect(comments[0].textContent).toBe('거부');
  });

  it('vote count attribute reflects array length', () => {
    renderCard({
      meetingId: 'mtg-x',
      participantVotes: [
        { providerId: 'p-a', vote: 'approve' },
        { providerId: 'p-b', vote: 'abstain' },
      ],
    });
    const card = screen.getByTestId('apv-consensus-card');
    expect(card.getAttribute('data-vote-count')).toBe('2');
    expect(card.getAttribute('data-meeting-id')).toBe('mtg-x');
  });
});
