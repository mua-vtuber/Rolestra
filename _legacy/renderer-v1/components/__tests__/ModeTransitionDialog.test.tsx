/**
 * Tests for ModeTransitionDialog component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ModeTransitionDialog } from '../chat/ModeTransitionDialog';
import type { ModeJudgment } from '../../../shared/session-state-types';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'session.modeTransition.title': 'Work Mode Transition Request',
        'session.modeTransition.approve': 'Switch to Work Mode',
        'session.modeTransition.reject': 'Continue Conversation',
        'session.modeTransition.judgment.work': 'Work',
        'session.modeTransition.judgment.conversation': 'Conversation',
        'session.modeTransition.reason.code_change': 'Code change needed',
        'session.modeTransition.reason.execution_needed': 'Execution needed',
        'session.modeTransition.reason.further_discussion': 'Further discussion needed',
        'session.modeTransition.reason.no_action': 'No action needed',
        'consensus.participant': 'Participant',
        'consensus.vote': 'Vote',
        'consensus.reason': 'Reason',
      };
      if (key === 'session.modeTransition.description' && opts) {
        return `${opts.work}/${opts.total} AIs suggest switching to work mode.`;
      }
      return map[key] ?? key;
    },
  }),
}));

const JUDGMENTS: ModeJudgment[] = [
  { participantId: 'ai-1', participantName: 'Claude', judgment: 'work', reason: 'code_change' },
  { participantId: 'ai-2', participantName: 'GPT', judgment: 'work' },
  { participantId: 'ai-3', participantName: 'Gemini', judgment: 'conversation', reason: 'further_discussion' },
];

describe('ModeTransitionDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title and description with correct counts', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    expect(screen.getByText('Work Mode Transition Request')).toBeTruthy();
    expect(screen.getByText('2/3 AIs suggest switching to work mode.')).toBeTruthy();
  });

  it('renders all participant judgments', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('GPT')).toBeTruthy();
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('renders judgment labels', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    const workChips = screen.getAllByText('Work');
    expect(workChips).toHaveLength(2);
    expect(screen.getByText('Conversation')).toBeTruthy();
  });

  it('renders reasons as translated labels with fallback dash', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    expect(screen.getByText('Code change needed')).toBeTruthy();
    expect(screen.getByText('Further discussion needed')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
  });

  it('calls onRespond(true) when approve clicked', () => {
    const onRespond = vi.fn();
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Switch to Work Mode'));
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it('calls onRespond(false) when reject clicked', () => {
    const onRespond = vi.fn();
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Continue Conversation'));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it('renders approve and reject buttons', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    expect(screen.getByText('Switch to Work Mode')).toBeTruthy();
    expect(screen.getByText('Continue Conversation')).toBeTruthy();
  });

  it('renders table headers', () => {
    render(<ModeTransitionDialog judgments={JUDGMENTS} onRespond={() => {}} />);

    expect(screen.getByText('Participant')).toBeTruthy();
    expect(screen.getByText('Vote')).toBeTruthy();
    expect(screen.getByText('Reason')).toBeTruthy();
  });
});
