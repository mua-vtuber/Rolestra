/**
 * Tests for useConsensus hook.
 *
 * Validates consensus state management and action dispatch via IPC.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installArenaMock } from './setup';
import { useConsensus } from '../useConsensus';
import type { ConsensusInfo } from '../../../shared/consensus-types';

describe('useConsensus', () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ invoke } = installArenaMock());
  });

  it('starts with null consensus and empty comment', () => {
    const { result } = renderHook(() => useConsensus());
    expect(result.current.consensus).toBeNull();
    expect(result.current.consensusComment).toBe('');
  });

  it('setConsensus updates consensus state', () => {
    const { result } = renderHook(() => useConsensus());
    const info: ConsensusInfo = {
      phase: 'VOTING',
      round: 1,
      retryCount: 0,
      maxRetries: 3,
      proposal: 'test proposal',
      votes: [],
      aggregatorId: 'ai-1',
      aggregatorStrategy: 'designated',
    };
    act(() => { result.current.setConsensus(info); });
    expect(result.current.consensus).toEqual(info);
  });

  it('setConsensusComment updates comment', () => {
    const { result } = renderHook(() => useConsensus());
    act(() => { result.current.setConsensusComment('my feedback'); });
    expect(result.current.consensusComment).toBe('my feedback');
  });

  // ── handleConsensusAction: approve ─────────────────────────────

  it('dispatches AGREE on approve action', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.setConsensusComment('looks good'); });
    act(() => { result.current.handleConsensusAction('approve'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'AGREE',
      comment: 'looks good',
    });
  });

  it('clears comment after approve', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.setConsensusComment('feedback'); });
    act(() => { result.current.handleConsensusAction('approve'); });
    expect(result.current.consensusComment).toBe('');
  });

  // ── handleConsensusAction: reject ──────────────────────────────

  it('dispatches BLOCK on reject action with blockReasonType', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.handleConsensusAction('reject', 'security'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'BLOCK',
      comment: undefined,
      blockReasonType: 'security',
    });
  });

  it('uses "unknown" as default blockReasonType for reject', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.handleConsensusAction('reject'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'BLOCK',
      comment: undefined,
      blockReasonType: 'unknown',
    });
  });

  // ── handleConsensusAction: revise ──────────────────────────────

  it('dispatches DISAGREE on revise action', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.handleConsensusAction('revise'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'DISAGREE',
      comment: undefined,
    });
  });

  // ── handleConsensusAction: abort ───────────────────────────────

  it('dispatches ABORT on abort action', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.setConsensusComment('stopping'); });
    act(() => { result.current.handleConsensusAction('abort', 'data_loss'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'ABORT',
      comment: 'stopping',
      blockReasonType: 'data_loss',
    });
  });

  it('uses "unknown" as default blockReasonType for abort', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.handleConsensusAction('abort'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'ABORT',
      comment: undefined,
      blockReasonType: 'unknown',
    });
  });

  it('trims whitespace-only comment to undefined', () => {
    invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsensus());

    act(() => { result.current.setConsensusComment('   '); });
    act(() => { result.current.handleConsensusAction('approve'); });

    expect(invoke).toHaveBeenCalledWith('consensus:respond', {
      decision: 'AGREE',
      comment: undefined,
    });
  });
});
