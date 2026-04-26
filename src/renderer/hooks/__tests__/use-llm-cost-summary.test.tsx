// @vitest-environment jsdom

import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLlmCostSummary } from '../use-llm-cost-summary';
import type { LlmCostSummary } from '../../../shared/llm-cost-types';

const SAMPLE_SUMMARY: LlmCostSummary = {
  byProvider: [
    {
      providerId: 'claude',
      tokenIn: 1000,
      tokenOut: 500,
      estimatedUsd: 0.0045,
    },
  ],
  totalTokens: 1500,
  periodStartAt: 1_000_000,
  periodEndAt: 2_000_000,
};

function installArena(
  invokeImpl: (channel: string, data: unknown) => unknown,
): { invoke: ReturnType<typeof vi.fn> } {
  const invokeFn = vi.fn(invokeImpl);
  vi.stubGlobal('arena', { platform: 'linux', invoke: invokeFn });
  return { invoke: invokeFn };
}

describe('useLlmCostSummary (R11-Task8)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('periodDays=null → no IPC, parked state', async () => {
    const { invoke } = installArena(() => {
      throw new Error('should not be called');
    });
    const { result } = renderHook(() => useLlmCostSummary(null));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('periodDays set → fetches summary and stores it', async () => {
    const { invoke } = installArena((channel, data) => {
      expect(channel).toBe('llm:cost-summary');
      expect(data).toEqual({ periodDays: 30 });
      return Promise.resolve({ summary: SAMPLE_SUMMARY });
    });
    const { result } = renderHook(() => useLlmCostSummary(30));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toEqual(SAMPLE_SUMMARY);
    expect(result.current.error).toBeNull();
  });

  it('IPC failure → error set, summary stays null', async () => {
    installArena(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useLlmCostSummary(30));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.summary).toBeNull();
  });

  it('periodDays change → refetches with the new value', async () => {
    const { invoke } = installArena((_, data) =>
      Promise.resolve({
        summary: {
          ...SAMPLE_SUMMARY,
          periodEndAt:
            (data as { periodDays: number }).periodDays * 1_000_000,
        },
      }),
    );
    const { result, rerender } = renderHook(
      ({ days }: { days: number | null }) => useLlmCostSummary(days),
      { initialProps: { days: 7 as number | null } },
    );
    await waitFor(() => {
      expect(result.current.summary?.periodEndAt).toBe(7_000_000);
    });
    rerender({ days: 30 });
    await waitFor(() => {
      expect(result.current.summary?.periodEndAt).toBe(30_000_000);
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refetch() triggers another invoke without changing periodDays', async () => {
    const { invoke } = installArena(() =>
      Promise.resolve({ summary: SAMPLE_SUMMARY }),
    );
    const { result } = renderHook(() => useLlmCostSummary(30));
    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });
    await act(async () => {
      await result.current.refetch();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('switch to null parks state without further IPC', async () => {
    const { invoke } = installArena(() =>
      Promise.resolve({ summary: SAMPLE_SUMMARY }),
    );
    const { result, rerender } = renderHook(
      ({ days }: { days: number | null }) => useLlmCostSummary(days),
      { initialProps: { days: 30 as number | null } },
    );
    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ days: null });
    await waitFor(() => {
      expect(result.current.summary).toBeNull();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });
});
