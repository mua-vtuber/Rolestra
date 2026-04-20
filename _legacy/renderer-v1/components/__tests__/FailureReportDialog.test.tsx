/**
 * Tests for FailureReportDialog component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FailureReportDialog } from '../chat/FailureReportDialog';
import type { FailureReportData } from '../chat/FailureReportDialog';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'failure.title': `${opts?.stage ?? ''} step failed`,
        'failure.retry': 'Retry',
        'failure.stop': 'Stop',
        'failure.reassign': 'Reassign facilitator',
      };
      return map[key] ?? key;
    },
  }),
}));

const MOCK_PARTICIPANTS = [
  { id: 'ai-1', type: 'api' as const, displayName: 'AI One', model: 'test', capabilities: [] as string[], status: 'ready' as const, config: { type: 'api' as const, endpoint: '', apiKeyRef: '', model: '' } },
  { id: 'ai-2', type: 'api' as const, displayName: 'AI Two', model: 'test', capabilities: [] as string[], status: 'ready' as const, config: { type: 'api' as const, endpoint: '', apiKeyRef: '', model: '' } },
];

describe('FailureReportDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders failure title and reason', () => {
    const report: FailureReportData = {
      stage: 'EXECUTE',
      reason: 'Something went wrong',
      options: ['retry', 'stop'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={() => {}}
      />,
    );

    expect(screen.getByText('EXECUTE step failed')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders retry and stop buttons', () => {
    const report: FailureReportData = {
      stage: 'EXECUTE',
      reason: 'Error',
      options: ['retry', 'stop'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={() => {}}
      />,
    );

    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('calls onResolve with retry', () => {
    const onResolve = vi.fn();
    const report: FailureReportData = {
      stage: 'EXECUTE',
      reason: 'Error',
      options: ['retry', 'stop'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={onResolve}
      />,
    );

    fireEvent.click(screen.getByText('Retry'));
    expect(onResolve).toHaveBeenCalledWith('retry');
  });

  it('calls onResolve with stop', () => {
    const onResolve = vi.fn();
    const report: FailureReportData = {
      stage: 'REVIEW',
      reason: 'Error',
      options: ['retry', 'stop'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={onResolve}
      />,
    );

    fireEvent.click(screen.getByText('Stop'));
    expect(onResolve).toHaveBeenCalledWith('stop');
  });

  it('renders reassign option with participant dropdown', () => {
    const report: FailureReportData = {
      stage: 'EXECUTE',
      reason: 'Error',
      options: ['retry', 'stop', 'reassign'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={() => {}}
      />,
    );

    expect(screen.getByText('Reassign facilitator')).toBeTruthy();
    // Participant names should be in the dropdown
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
  });

  it('calls onResolve with reassign and selected facilitator', () => {
    const onResolve = vi.fn();
    const report: FailureReportData = {
      stage: 'EXECUTE',
      reason: 'Error',
      options: ['retry', 'stop', 'reassign'],
    };

    render(
      <FailureReportDialog
        report={report}
        participants={MOCK_PARTICIPANTS}
        onResolve={onResolve}
      />,
    );

    // Change selection to second participant
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ai-2' } });

    fireEvent.click(screen.getByText('Reassign facilitator'));
    expect(onResolve).toHaveBeenCalledWith('reassign', 'ai-2');
  });
});
