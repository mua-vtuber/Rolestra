/**
 * Tests for SessionStatusBar component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SessionStatusBar } from '../chat/SessionStatusBar';
import type { SessionInfo, SessionState } from '../../../shared/session-state-types';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'round' in opts) return `Round ${opts.round}`;
      return key;
    },
  }),
}));

function makeSessionInfo(state: SessionState, overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    state,
    projectPath: null,
    conversationRound: 1,
    modeJudgments: [],
    workRound: 0,
    retryCount: 0,
    maxRetries: 3,
    proposal: null,
    proposalHash: null,
    votes: [],
    workerId: null,
    aggregatorId: null,
    aggregatorStrategy: 'designated',
    ...overrides,
  };
}

const ALL_STATES: SessionState[] = [
  'CONVERSATION',
  'MODE_TRANSITION_PENDING',
  'WORK_DISCUSSING',
  'SYNTHESIZING',
  'VOTING',
  'CONSENSUS_APPROVED',
  'EXECUTING',
  'REVIEWING',
  'USER_DECISION',
  'DONE',
  'FAILED',
  'PAUSED',
];

describe('SessionStatusBar', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(ALL_STATES)('renders i18n key for state: %s', (state) => {
    render(<SessionStatusBar sessionInfo={makeSessionInfo(state)} />);
    expect(screen.getByText(`session.state.${state}`)).toBeTruthy();
  });

  it('applies correct variant class for each state', () => {
    const variantMap: Record<SessionState, string> = {
      CONVERSATION: 'info',
      MODE_TRANSITION_PENDING: 'warning',
      WORK_DISCUSSING: 'info',
      SYNTHESIZING: 'info',
      VOTING: 'warning',
      CONSENSUS_APPROVED: 'success',
      EXECUTING: 'warning',
      REVIEWING: 'info',
      USER_DECISION: 'warning',
      DONE: 'success',
      FAILED: 'error',
      PAUSED: 'muted',
    };

    for (const state of ALL_STATES) {
      const { container } = render(<SessionStatusBar sessionInfo={makeSessionInfo(state)} />);
      const bar = container.querySelector('.session-status-bar');
      expect(bar?.classList.contains(`session-status-bar--${variantMap[state]}`)).toBe(true);
      cleanup();
    }
  });

  it('shows work round when workRound > 0', () => {
    render(<SessionStatusBar sessionInfo={makeSessionInfo('WORK_DISCUSSING', { workRound: 2 })} />);
    expect(screen.getByText('Round 2')).toBeTruthy();
  });

  it('does not show work round when workRound is 0', () => {
    render(<SessionStatusBar sessionInfo={makeSessionInfo('CONVERSATION', { workRound: 0 })} />);
    expect(screen.queryByText(/Round/)).toBeNull();
  });
});
