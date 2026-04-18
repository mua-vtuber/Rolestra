/**
 * Tests for showError and useErrorDialog.
 *
 * Validates custom event dispatch and hook memoization.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// We need the REAL useErrorDialog/showError, not the mock from setup
// Use vi.unmock to undo the mock from setup
vi.unmock('../useErrorDialog');

// Mock the dependency: formatIpcError
vi.mock('../../../shared/ipc-error', () => ({
  formatIpcError: vi.fn((err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'An unexpected error occurred';
  }),
}));

describe('showError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches arena:error custom event', async () => {
    const { showError } = await import('../useErrorDialog');

    const handler = vi.fn();
    window.addEventListener('arena:error', handler);

    showError('test-context', new Error('test error'));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.context).toBe('test-context');
    expect(event.detail.message).toBe('test error');

    window.removeEventListener('arena:error', handler);
  });

  it('handles string errors', async () => {
    const { showError } = await import('../useErrorDialog');

    const handler = vi.fn();
    window.addEventListener('arena:error', handler);

    showError('ctx', 'string error');

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.message).toBe('string error');

    window.removeEventListener('arena:error', handler);
  });
});

describe('useErrorDialog', () => {
  it('returns a memoized function', async () => {
    const { useErrorDialog } = await import('../useErrorDialog');

    const { result, rerender } = renderHook(() => useErrorDialog());
    const firstRef = result.current;
    rerender();
    expect(result.current).toBe(firstRef);
  });
});
