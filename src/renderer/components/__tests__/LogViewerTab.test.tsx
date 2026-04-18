/**
 * LogViewerTab component tests.
 *
 * Tests IPC-driven structured log display, filtering, summary stats, and export.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { installArenaMock, type InvokeMock } from './setup';

import { LogViewerTab } from '../settings/LogViewerTab';

// ── Test Data ─────────────────────────────────────────────────────────

function makeLogEntry(overrides?: Partial<import('../../../shared/log-types').StructuredLogEntry>) {
  return {
    level: 'info' as const,
    timestamp: 1700000000000,
    component: 'provider',
    action: 'generate',
    result: 'success' as const,
    latencyMs: 150,
    tokenCount: { input: 100, output: 50, total: 150 },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('LogViewerTab', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    ({ invoke } = installArenaMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows empty state when no entries', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<LogViewerTab />); });
    expect(screen.getByText('log.viewer.empty')).toBeInTheDocument();
  });

  it('renders log entries in table', async () => {
    const entries = [
      makeLogEntry({ component: 'consensus', action: 'vote', level: 'warn' }),
      makeLogEntry({ component: 'execution', action: 'apply', result: 'failure', level: 'error' }),
    ];
    invoke.mockResolvedValue({ entries });
    await act(async () => { render(<LogViewerTab />); });

    // Check actions (unique to table, not in dropdowns)
    expect(screen.getByText('vote')).toBeInTheDocument();
    expect(screen.getByText('apply')).toBeInTheDocument();
    // Verify table has 2 data rows
    const tbody = document.querySelector('tbody');
    expect(tbody).toBeTruthy();
    expect(tbody!.querySelectorAll('tr')).toHaveLength(2);
  });

  it('computes summary stats correctly', async () => {
    const entries = [
      makeLogEntry({ latencyMs: 100, tokenCount: { input: 50, output: 50, total: 100 } }),
      makeLogEntry({ latencyMs: 200, tokenCount: { input: 100, output: 100, total: 200 }, result: 'failure' }),
    ];
    invoke.mockResolvedValue({ entries });
    await act(async () => { render(<LogViewerTab />); });

    // Summary stats rendered as "label: <strong>value</strong>" inside spans
    // Use container query to find strong elements with specific values
    const strongs = document.querySelectorAll('.action-buttons strong');
    const values = Array.from(strongs).map((s) => s.textContent?.trim());
    expect(values).toContain('2');              // entries count
    expect(values).toContain('log.viewer.ms');  // avg latency (mock t() returns key as-is)
    expect(values).toContain('300');             // total tokens
    expect(values).toContain('1');               // error count
  });

  it('applies level chip classes', async () => {
    const entries = [
      makeLogEntry({ level: 'info' }),
      makeLogEntry({ level: 'warn', timestamp: 1700000001000 }),
      makeLogEntry({ level: 'error', timestamp: 1700000002000 }),
    ];
    invoke.mockResolvedValue({ entries });
    await act(async () => { render(<LogViewerTab />); });

    // Find chips only inside tbody (not dropdown options)
    const tbody = document.querySelector('tbody')!;
    const levelChips = tbody.querySelectorAll('td:nth-child(2) .chip');
    expect(levelChips[0].className).toContain('chip--info');
    expect(levelChips[1].className).toContain('chip--warning');
    expect(levelChips[2].className).toContain('chip--error');
  });

  it('fetches with component filter', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<LogViewerTab />); });

    const componentSelect = screen.getByDisplayValue('log.viewer.allComponents');
    await act(async () => {
      fireEvent.change(componentSelect, { target: { value: 'consensus' } });
    });

    const lastCall = invoke.mock.calls[invoke.mock.calls.length - 1];
    expect(lastCall[0]).toBe('log:list');
    expect((lastCall[1] as Record<string, unknown>).component).toBe('consensus');
  });

  it('fetches with level filter', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<LogViewerTab />); });

    const levelSelect = screen.getByDisplayValue('log.viewer.allLevels');
    await act(async () => {
      fireEvent.change(levelSelect, { target: { value: 'error' } });
    });

    const lastCall = invoke.mock.calls[invoke.mock.calls.length - 1];
    expect(lastCall[0]).toBe('log:list');
    expect((lastCall[1] as Record<string, unknown>).level).toBe('error');
  });

  it('triggers JSON export', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'log:list') return { entries: [makeLogEntry()] };
      if (channel === 'log:export') return { content: '[]', filename: 'arena-log-1.json' };
      return undefined;
    });

    // Mock URL.createObjectURL and URL.revokeObjectURL
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    await act(async () => { render(<LogViewerTab />); });
    await act(async () => {
      fireEvent.click(screen.getByText('log.export.json'));
    });

    const exportCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'log:export');
    expect(exportCalls.length).toBe(1);
    expect((exportCalls[0][1] as Record<string, unknown>).format).toBe('json');
  });

  it('triggers Markdown export', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'log:list') return { entries: [makeLogEntry()] };
      if (channel === 'log:export') return { content: '# Logs', filename: 'arena-log-1.md' };
      return undefined;
    });

    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    await act(async () => { render(<LogViewerTab />); });
    await act(async () => {
      fireEvent.click(screen.getByText('log.export.markdown'));
    });

    const exportCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'log:export');
    expect(exportCalls.length).toBe(1);
    expect((exportCalls[0][1] as Record<string, unknown>).format).toBe('markdown');
  });

  it('shows latency as dash when not present', async () => {
    invoke.mockResolvedValue({ entries: [makeLogEntry({ latencyMs: undefined })] });
    await act(async () => { render(<LogViewerTab />); });

    // The last cell in the data row (latency column) should show '-'
    const tbody = document.querySelector('tbody')!;
    const cells = tbody.querySelectorAll('tr:first-child td');
    expect(cells[cells.length - 1].textContent).toBe('-');
  });

  it('renders filter controls', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<LogViewerTab />); });

    expect(screen.getByDisplayValue('log.viewer.allComponents')).toBeInTheDocument();
    expect(screen.getByDisplayValue('log.viewer.allLevels')).toBeInTheDocument();
    expect(screen.getByText('log.export.json')).toBeInTheDocument();
    expect(screen.getByText('log.export.markdown')).toBeInTheDocument();
  });
});
