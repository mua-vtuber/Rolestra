/**
 * Tests for useTheme hook.
 *
 * Validates theme application on mount and settings-saved event sync.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { installArenaMock, type InvokeMock } from './setup';

// We need the real useTheme, not a mock
// But setup.ts mocks useErrorDialog which is fine

describe('useTheme', () => {
  let invoke: InvokeMock;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = installArenaMock();
    invoke = mocks.invoke;
    // Default: return dark theme from settings
    invoke.mockResolvedValue({ settings: { uiTheme: 'dark' } });
    // Reset data-theme
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets data-theme to dark by default', async () => {
    const { useTheme } = await import('../useTheme');

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  it('sets data-theme from settings response', async () => {
    invoke.mockResolvedValue({ settings: { uiTheme: 'light' } });
    const { useTheme } = await import('../useTheme');

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  it('updates theme on arena:settings-saved event', async () => {
    const { useTheme } = await import('../useTheme');

    renderHook(() => useTheme());

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('arena:settings-saved', {
          detail: { uiTheme: 'light' },
        }),
      );
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
