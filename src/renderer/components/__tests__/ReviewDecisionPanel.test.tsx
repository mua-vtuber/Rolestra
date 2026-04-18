/**
 * Tests for ReviewDecisionPanel component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReviewDecisionPanel } from '../chat/ReviewDecisionPanel';
import type { SessionInfo } from '../../../shared/session-state-types';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'session.review.title': 'Review Complete',
        'session.review.description': 'Review is complete. Please make your decision.',
        'session.review.proposal': 'Consensus Document',
        'session.review.accept': 'Accept',
        'session.review.rework': 'Rework',
        'session.review.reassign': 'Reassign to Another AI',
        'session.review.confirmReassign': 'Confirm Reassign',
        'session.review.stop': 'Stop',
        'session.review.selectWorker': 'Select AI to reassign',
      };
      return map[key] ?? key;
    },
  }),
}));

const CANDIDATES = [
  { id: 'ai-1', displayName: 'Claude' },
  { id: 'ai-2', displayName: 'GPT' },
  { id: 'ai-3', displayName: 'Gemini' },
];

const SESSION: SessionInfo = {
  state: 'USER_DECISION',
  projectPath: null,
  conversationRound: 1,
  modeJudgments: [],
  workRound: 1,
  retryCount: 0,
  maxRetries: 3,
  proposal: 'Implement the feature',
  proposalHash: 'abc123',
  votes: [],
  workerId: 'ai-1',
  aggregatorId: 'ai-2',
  aggregatorStrategy: 'designated',
};

describe('ReviewDecisionPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title and description', () => {
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    expect(screen.getByText('Review Complete')).toBeTruthy();
    expect(screen.getByText('Review is complete. Please make your decision.')).toBeTruthy();
  });

  it('renders proposal when present', () => {
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    expect(screen.getByText('Consensus Document')).toBeTruthy();
    expect(screen.getByText('Implement the feature')).toBeTruthy();
  });

  it('does not render proposal block when null', () => {
    const noProposal = { ...SESSION, proposal: null };
    render(
      <ReviewDecisionPanel session={noProposal} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    expect(screen.queryByText('Consensus Document')).toBeNull();
  });

  it('renders all four decision buttons', () => {
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText('Rework')).toBeTruthy();
    expect(screen.getByText('Reassign to Another AI')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('calls onDecision with accept', () => {
    const onDecision = vi.fn();
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={onDecision} />,
    );

    fireEvent.click(screen.getByText('Accept'));
    expect(onDecision).toHaveBeenCalledWith('accept');
  });

  it('calls onDecision with rework', () => {
    const onDecision = vi.fn();
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={onDecision} />,
    );

    fireEvent.click(screen.getByText('Rework'));
    expect(onDecision).toHaveBeenCalledWith('rework');
  });

  it('calls onDecision with stop', () => {
    const onDecision = vi.fn();
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={onDecision} />,
    );

    fireEvent.click(screen.getByText('Stop'));
    expect(onDecision).toHaveBeenCalledWith('stop');
  });

  it('shows reassign dropdown after clicking reassign button', () => {
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    // Initially no dropdown
    expect(screen.queryByRole('combobox')).toBeNull();

    // Click reassign button
    fireEvent.click(screen.getByText('Reassign to Another AI'));

    // Dropdown should appear
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByText('Select AI to reassign')).toBeTruthy();
  });

  it('calls onDecision with reassign and selected worker ID', () => {
    const onDecision = vi.fn();
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={onDecision} />,
    );

    // Show reassign dropdown
    fireEvent.click(screen.getByText('Reassign to Another AI'));

    // Select a different AI
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ai-3' } });

    // Confirm reassign
    fireEvent.click(screen.getByText('Confirm Reassign'));
    expect(onDecision).toHaveBeenCalledWith('reassign', 'ai-3');
  });

  it('defaults reassign to first candidate', () => {
    const onDecision = vi.fn();
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={onDecision} />,
    );

    fireEvent.click(screen.getByText('Reassign to Another AI'));
    fireEvent.click(screen.getByText('Confirm Reassign'));
    expect(onDecision).toHaveBeenCalledWith('reassign', 'ai-1');
  });

  it('renders all candidate options in reassign dropdown', () => {
    render(
      <ReviewDecisionPanel session={SESSION} candidates={CANDIDATES} onDecision={() => {}} />,
    );

    fireEvent.click(screen.getByText('Reassign to Another AI'));

    const select = screen.getByRole('combobox');
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('Claude');
    expect(options[1].textContent).toBe('GPT');
    expect(options[2].textContent).toBe('Gemini');
  });
});
