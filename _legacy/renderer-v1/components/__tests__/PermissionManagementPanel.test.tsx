/**
 * PermissionManagementPanel component tests.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { installArenaMock } from './setup';
import type { InvokeMock } from './setup';

import { PermissionManagementPanel } from '../settings/PermissionManagementPanel';

describe('PermissionManagementPanel', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    ({ invoke } = installArenaMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows title and read-only notice', async () => {
    invoke.mockResolvedValue({ rules: [] });
    render(<PermissionManagementPanel />);

    expect(screen.getByText('permission.rules.title')).toBeInTheDocument();
    expect(screen.getByText('permission.rules.readOnly')).toBeInTheDocument();
  });

  it('shows empty message when no rules', async () => {
    invoke.mockResolvedValue({ rules: [] });
    render(<PermissionManagementPanel />);

    await waitFor(() => {
      expect(screen.getByText('permission.rules.empty')).toBeInTheDocument();
    });
  });

  it('renders permission rules table', async () => {
    invoke.mockResolvedValue({
      rules: [
        { aiId: 'ai-1', path: '/project', read: true, write: false, execute: false },
        { aiId: 'ai-2', path: '/project', read: true, write: true, execute: true },
      ],
    });

    render(<PermissionManagementPanel />);

    await waitFor(() => {
      expect(screen.getByText('ai-1')).toBeInTheDocument();
    });

    expect(screen.getByText('ai-2')).toBeInTheDocument();

    // Check table headers
    expect(screen.getByText('permission.participant')).toBeInTheDocument();
    expect(screen.getByText('permission.rules.path')).toBeInTheDocument();
    expect(screen.getByText('permission.rules.read')).toBeInTheDocument();
    expect(screen.getByText('permission.rules.write')).toBeInTheDocument();
    expect(screen.getByText('permission.rules.execute')).toBeInTheDocument();
  });

  it('shows check/cross marks for permissions', async () => {
    invoke.mockResolvedValue({
      rules: [
        { aiId: 'ai-1', path: '/project', read: true, write: false, execute: false },
      ],
    });

    render(<PermissionManagementPanel />);

    await waitFor(() => {
      expect(screen.getByText('ai-1')).toBeInTheDocument();
    });

    const tbody = document.querySelector('tbody');
    expect(tbody).not.toBeNull();
    const cells = tbody!.querySelectorAll('td');
    // ai-1, /project, ✓, ✗, ✗
    expect(cells[2].textContent).toBe('\u2713'); // read = true
    expect(cells[3].textContent).toBe('\u2717'); // write = false
    expect(cells[4].textContent).toBe('\u2717'); // execute = false
  });

  it('calls permission:list-rules on mount', async () => {
    invoke.mockResolvedValue({ rules: [] });
    render(<PermissionManagementPanel />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('permission:list-rules', {});
    });
  });
});
