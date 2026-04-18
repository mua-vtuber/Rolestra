/**
 * Tests for useRoundSettings hook.
 *
 * Validates initial IPC sync and round setting updates.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useRoundSettings } from '../useRoundSettings';

describe('useRoundSettings', () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts with rounds = 1', () => {
    const { result } = renderHook(() => useRoundSettings());
    expect(result.current.rounds).toBe(1);
  });

  it('syncs initial rounds to backend on mount', () => {
    renderHook(() => useRoundSettings());
    expect(invoke).toHaveBeenCalledWith('chat:set-rounds', { rounds: 1 });
  });

  // ── handleSetRounds ────────────────────────────────────────────

  it('handleSetRounds updates local state', () => {
    const { result } = renderHook(() => useRoundSettings());

    act(() => { result.current.handleSetRounds(5); });

    expect(result.current.rounds).toBe(5);
  });

  it('handleSetRounds calls chat:set-rounds IPC', () => {
    const { result } = renderHook(() => useRoundSettings());
    invoke.mockClear(); // Clear the initial mount call

    act(() => { result.current.handleSetRounds(3); });

    expect(invoke).toHaveBeenCalledWith('chat:set-rounds', { rounds: 3 });
  });

  it('handleSetRounds supports "unlimited"', () => {
    const { result } = renderHook(() => useRoundSettings());
    invoke.mockClear();

    act(() => { result.current.handleSetRounds('unlimited'); });

    expect(result.current.rounds).toBe('unlimited');
    expect(invoke).toHaveBeenCalledWith('chat:set-rounds', { rounds: 'unlimited' });
  });

  it('multiple calls update correctly', () => {
    const { result } = renderHook(() => useRoundSettings());

    act(() => { result.current.handleSetRounds(2); });
    expect(result.current.rounds).toBe(2);

    act(() => { result.current.handleSetRounds(10); });
    expect(result.current.rounds).toBe(10);

    act(() => { result.current.handleSetRounds(1); });
    expect(result.current.rounds).toBe(1);
  });
});
