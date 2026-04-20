/**
 * DatabaseTab component tests.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { installArenaMock } from './setup';
import type { InvokeMock } from './setup';

import { DatabaseTab } from '../settings/DatabaseTab';

describe('DatabaseTab', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    ({ invoke } = installArenaMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows stats title', async () => {
    invoke.mockResolvedValue({ tables: [], sizeBytes: 0 });
    render(<DatabaseTab />);

    expect(screen.getByText('db.stats.title')).toBeInTheDocument();
  });

  it('renders table statistics', async () => {
    invoke.mockResolvedValue({
      tables: [
        { name: 'conversations', count: 10 },
        { name: 'messages', count: 42 },
      ],
      sizeBytes: 1024 * 500,
    });

    render(<DatabaseTab />);

    await waitFor(() => {
      expect(screen.getByText('conversations')).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // Size: 500.0 KB
    expect(screen.getByText(/500\.0 KB/)).toBeInTheDocument();
  });

  it('shows export and import buttons', async () => {
    invoke.mockResolvedValue({ tables: [], sizeBytes: 0 });
    render(<DatabaseTab />);

    expect(screen.getByText('db.export')).toBeInTheDocument();
    expect(screen.getByText('db.import')).toBeInTheDocument();
  });

  it('calls db:export on export click', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:export') return { success: true, path: '/tmp/backup.db' };
      return { tables: [], sizeBytes: 0 };
    });

    render(<DatabaseTab />);

    fireEvent.click(screen.getByText('db.export'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('db:export', undefined);
    });

    await waitFor(() => {
      expect(screen.getByText('db.exportSuccess')).toBeInTheDocument();
    });
  });

  it('calls db:import on import click with confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:import') return { success: true, requiresRestart: true };
      return { tables: [], sizeBytes: 0 };
    });

    render(<DatabaseTab />);

    fireEvent.click(screen.getByText('db.import'));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('db:import', undefined);
    });

    await waitFor(() => {
      expect(screen.getByText('db.importSuccess')).toBeInTheDocument();
    });
  });

  it('does not call db:import if confirm rejected', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    invoke.mockResolvedValue({ tables: [], sizeBytes: 0 });

    render(<DatabaseTab />);

    fireEvent.click(screen.getByText('db.import'));

    // Ensure confirm was called but not db:import
    expect(window.confirm).toHaveBeenCalled();
    // Small delay to make sure no async calls happen
    await new Promise((r) => setTimeout(r, 50));
    expect(invoke).not.toHaveBeenCalledWith('db:import', expect.anything());
  });

  it('formats bytes correctly', async () => {
    invoke.mockResolvedValue({ tables: [], sizeBytes: 2 * 1024 * 1024 + 512 * 1024 });

    render(<DatabaseTab />);

    await waitFor(() => {
      expect(screen.getByText(/2\.5 MB/)).toBeInTheDocument();
    });
  });

  it('calls db:stats on mount', async () => {
    invoke.mockResolvedValue({ tables: [], sizeBytes: 0 });
    render(<DatabaseTab />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('db:stats', undefined);
    });
  });
});
