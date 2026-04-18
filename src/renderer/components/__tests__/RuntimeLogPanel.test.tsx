/**
 * RuntimeLogPanel component tests.
 *
 * Tests rendering, collapsible behavior, level-based styling.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { installArenaMock } from './setup';
import type { StreamLogEvent } from '../../../shared/stream-types';

import { RuntimeLogPanel } from '../chat/RuntimeLogPanel';

// ── Test Data ─────────────────────────────────────────────────────────

function makeLogEvent(overrides?: Partial<StreamLogEvent>): StreamLogEvent {
  return {
    conversationId: 'conv-1',
    level: 'info',
    message: 'Test message',
    timestamp: 1700000000000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('RuntimeLogPanel', () => {
  beforeEach(() => {
    installArenaMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns empty fragment when no entries', () => {
    const { container } = render(<RuntimeLogPanel entries={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders toggle button with entry count', () => {
    const entries = [makeLogEvent(), makeLogEvent({ timestamp: 1700000001000 })];
    render(<RuntimeLogPanel entries={entries} />);

    expect(screen.getByText(/log\.runtime\.title/)).toBeInTheDocument();
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument();
  });

  it('starts collapsed and hides entries', () => {
    render(<RuntimeLogPanel entries={[makeLogEvent()]} />);

    // Should not show the message yet (collapsed)
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('expands on toggle click to show entries', () => {
    const entries = [makeLogEvent({ message: 'Hello world' })];
    render(<RuntimeLogPanel entries={entries} />);

    // Click toggle
    fireEvent.click(screen.getByText(/log\.runtime\.title/));

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('collapses again on second toggle click', () => {
    render(<RuntimeLogPanel entries={[makeLogEvent({ message: 'Visible' })]} />);

    const toggle = screen.getByText(/log\.runtime\.title/);
    fireEvent.click(toggle); // expand
    expect(screen.getByText('Visible')).toBeInTheDocument();

    fireEvent.click(toggle); // collapse
    expect(screen.queryByText('Visible')).not.toBeInTheDocument();
  });

  it('applies level-based CSS classes', () => {
    const entries = [
      makeLogEvent({ level: 'info', message: 'info-msg', timestamp: 1 }),
      makeLogEvent({ level: 'warn', message: 'warn-msg', timestamp: 2 }),
      makeLogEvent({ level: 'error', message: 'error-msg', timestamp: 3 }),
    ];
    render(<RuntimeLogPanel entries={entries} />);
    fireEvent.click(screen.getByText(/log\.runtime\.title/));

    const infoEl = screen.getByText('info-msg').closest('.runtime-log-entry');
    const warnEl = screen.getByText('warn-msg').closest('.runtime-log-entry');
    const errorEl = screen.getByText('error-msg').closest('.runtime-log-entry');

    expect(infoEl?.className).toContain('log-entry--info');
    expect(warnEl?.className).toContain('log-entry--warn');
    expect(errorEl?.className).toContain('log-entry--error');
  });

  it('shows participant ID when present', () => {
    const entries = [makeLogEvent({ participantId: 'claude-3', message: 'with-participant' })];
    render(<RuntimeLogPanel entries={entries} />);
    fireEvent.click(screen.getByText(/log\.runtime\.title/));

    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('omits participant ID when absent', () => {
    const entries = [makeLogEvent({ message: 'no-participant' })];
    render(<RuntimeLogPanel entries={entries} />);
    fireEvent.click(screen.getByText(/log\.runtime\.title/));

    const entry = screen.getByText('no-participant').closest('.runtime-log-entry');
    expect(entry?.querySelector('.runtime-log-participant')).toBeNull();
  });

  it('shows level badge in uppercase', () => {
    render(<RuntimeLogPanel entries={[makeLogEvent({ level: 'warn' })]} />);
    fireEvent.click(screen.getByText(/log\.runtime\.title/));

    expect(screen.getByText('[WARN]')).toBeInTheDocument();
  });
});
