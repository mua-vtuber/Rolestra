/**
 * Tests for WorkerSelectionDialog component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WorkerSelectionDialog } from '../chat/WorkerSelectionDialog';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'session.workerSelection.title': 'Worker Selection',
        'session.workerSelection.description': 'Consensus approved. Select an AI to perform the task.',
        'session.workerSelection.proposal': 'Consensus Document',
        'session.workerSelection.selectWorker': 'Select AI to perform the work',
        'session.workerSelection.confirm': 'Confirm Selection',
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

describe('WorkerSelectionDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title and description', () => {
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="Fix the bug" onSelect={() => {}} />);
    expect(screen.getByText('Worker Selection')).toBeTruthy();
    expect(screen.getByText('Consensus approved. Select an AI to perform the task.')).toBeTruthy();
  });

  it('renders proposal text', () => {
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="Fix the bug" onSelect={() => {}} />);
    expect(screen.getByText('Fix the bug')).toBeTruthy();
    expect(screen.getByText('Consensus Document')).toBeTruthy();
  });

  it('does not render proposal block when proposal is empty', () => {
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="" onSelect={() => {}} />);
    expect(screen.queryByText('Consensus Document')).toBeNull();
  });

  it('renders all candidate options', () => {
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="test" onSelect={() => {}} />);
    const select = screen.getByRole('combobox');
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('Claude');
    expect(options[1].textContent).toBe('GPT');
    expect(options[2].textContent).toBe('Gemini');
  });

  it('calls onSelect with first candidate by default', () => {
    const onSelect = vi.fn();
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="test" onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Confirm Selection'));
    expect(onSelect).toHaveBeenCalledWith('ai-1');
  });

  it('calls onSelect with changed selection', () => {
    const onSelect = vi.fn();
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="test" onSelect={onSelect} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ai-3' } });
    fireEvent.click(screen.getByText('Confirm Selection'));
    expect(onSelect).toHaveBeenCalledWith('ai-3');
  });

  it('disables confirm button when no candidates', () => {
    render(<WorkerSelectionDialog candidates={[]} proposal="test" onSelect={() => {}} />);
    const btn = screen.getByText('Confirm Selection');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders select worker label', () => {
    render(<WorkerSelectionDialog candidates={CANDIDATES} proposal="test" onSelect={() => {}} />);
    expect(screen.getByText('Select AI to perform the work')).toBeTruthy();
  });
});
