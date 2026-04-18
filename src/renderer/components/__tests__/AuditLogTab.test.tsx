/**
 * AuditLogTab component tests.
 *
 * Tests IPC-driven audit log display, filtering, and clear action.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installArenaMock, type InvokeMock } from './setup';

import { AuditLogTab } from '../settings/AuditLogTab';

// ── Test Data ─────────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<import('../../../shared/execution-types').AuditEntry>) {
  return {
    operationId: 'op-001',
    aiId: 'gpt-4o',
    action: 'write' as const,
    targetPath: '/project/src/index.ts',
    timestamp: 1700000000000,
    result: 'success' as const,
    rollbackable: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AuditLogTab', () => {
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
    await act(async () => { render(<AuditLogTab />); });
    expect(screen.getByText('audit.empty')).toBeInTheDocument();
  });

  it('renders audit entries in table', async () => {
    const entries = [
      makeEntry({ aiId: 'claude-3', action: 'read', result: 'success' }),
      makeEntry({ operationId: 'op-002', aiId: 'gpt-4o', action: 'execute', result: 'denied' }),
    ];
    invoke.mockResolvedValue({ entries });
    await act(async () => { render(<AuditLogTab />); });

    // Check AI IDs (unique to table rows, not in dropdowns)
    expect(screen.getByText('claude-3')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    // Verify table is rendered (2 data rows)
    const tbody = document.querySelector('tbody');
    expect(tbody).toBeTruthy();
    expect(tbody!.querySelectorAll('tr')).toHaveLength(2);
  });

  it('applies result chip classes', async () => {
    const entries = [
      makeEntry({ operationId: 'op-s', result: 'success' }),
      makeEntry({ operationId: 'op-d', result: 'denied' }),
      makeEntry({ operationId: 'op-f', result: 'failed' }),
    ];
    invoke.mockResolvedValue({ entries });
    await act(async () => { render(<AuditLogTab />); });

    // Find chips only inside tbody (not dropdown options)
    const tbody = document.querySelector('tbody')!;
    const chips = tbody.querySelectorAll('.chip');
    // Each row has action chip + result chip = 6 total, result chips are at indices 1,3,5
    const resultChips = Array.from(chips).filter((c) => /^(success|denied|failed)$/.test(c.textContent ?? ''));
    expect(resultChips[0].className).toContain('chip--success');
    expect(resultChips[1].className).toContain('chip--warning');
    expect(resultChips[2].className).toContain('chip--error');
  });

  it('fetches with filter params when changed', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<AuditLogTab />); });

    // Change action filter to 'write'
    const actionSelect = screen.getByDisplayValue('audit.filter.allActions');
    await act(async () => {
      fireEvent.change(actionSelect, { target: { value: 'write' } });
    });

    const lastCall = invoke.mock.calls[invoke.mock.calls.length - 1];
    expect(lastCall[0]).toBe('audit:list');
    expect((lastCall[1] as Record<string, unknown>).action).toBe('write');
  });

  it('filters by AI ID text input', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<AuditLogTab />); });

    const aiInput = screen.getByPlaceholderText('audit.filter.aiId');
    await act(async () => {
      await userEvent.type(aiInput, 'claude');
    });

    const lastCall = invoke.mock.calls[invoke.mock.calls.length - 1];
    expect(lastCall[0]).toBe('audit:list');
    expect((lastCall[1] as Record<string, unknown>).aiId).toContain('claude');
  });

  it('calls audit:clear and empties table', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'audit:list') return { entries: [makeEntry()] };
      if (channel === 'audit:clear') return { cleared: 1 };
      return undefined;
    });

    await act(async () => { render(<AuditLogTab />); });
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('audit.clear'));
    });

    expect(screen.getByText('audit.empty')).toBeInTheDocument();
    const clearCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'audit:clear');
    expect(clearCalls.length).toBe(1);
  });

  it('renders filter controls', async () => {
    invoke.mockResolvedValue({ entries: [] });
    await act(async () => { render(<AuditLogTab />); });

    expect(screen.getByPlaceholderText('audit.filter.aiId')).toBeInTheDocument();
    expect(screen.getByDisplayValue('audit.filter.allActions')).toBeInTheDocument();
    expect(screen.getByDisplayValue('audit.filter.allResults')).toBeInTheDocument();
    expect(screen.getByText('audit.clear')).toBeInTheDocument();
  });

  it('truncates operationId in display', async () => {
    invoke.mockResolvedValue({ entries: [makeEntry({ operationId: 'abcdefghijklmnop' })] });
    await act(async () => { render(<AuditLogTab />); });

    expect(screen.getByText('abcdefgh')).toBeInTheDocument();
  });
});
