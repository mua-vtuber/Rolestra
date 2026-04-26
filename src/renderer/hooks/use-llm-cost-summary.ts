/**
 * `useLlmCostSummary` — fetches the rolling-window LLM usage summary
 * (`llm:cost-summary`) for the AutonomyDefaultsTab "LLM 사용량" card.
 *
 * R11-Task8 design:
 *   - Single round-trip per `periodDays` change. The backend service
 *     composes provider-level token sums + USD estimate (D5: settings-
 *     supplied unit price × tokens) so the renderer never re-aggregates.
 *   - `periodDays === null` is the "skip fetch" sentinel. The Settings
 *     tab always passes a positive value, but tests + future surfaces
 *     can park the hook by passing null.
 *   - `refetch()` is exposed so the unit-price input can refresh the
 *     summary after a successful `config:update-settings` round-trip
 *     (the USD estimate depends on the unit price the user just typed).
 *
 * Strict-mode safe — same pattern as `use-approval-detail`: a
 * mountedRef guards every setState after an await, and the fetch
 * dependency is `periodDays` so a strict-mode double-mount does not
 * double-fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { LlmCostSummary } from '../../shared/llm-cost-types';

export interface UseLlmCostSummaryResult {
  summary: LlmCostSummary | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Module-scoped sentinel so a `null` cache key stays distinguishable
 * from "no fetch attempted yet". Mirrors the pattern in
 * `use-approval-detail`.
 */
const UNSET = Symbol('use-llm-cost-summary:unset');

export function useLlmCostSummary(
  periodDays: number | null,
): UseLlmCostSummaryResult {
  const [summary, setSummary] = useState<LlmCostSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(periodDays !== null);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const lastFetchedRef = useRef<number | null | typeof UNSET>(UNSET);

  const runFetch = useCallback(async (): Promise<void> => {
    if (periodDays === null) return;
    setLoading(true);
    setError(null);
    try {
      const { summary: next } = await invoke('llm:cost-summary', {
        periodDays,
      });
      if (!mountedRef.current) return;
      setSummary(next);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      setSummary(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    mountedRef.current = true;
    if (lastFetchedRef.current !== periodDays) {
      lastFetchedRef.current = periodDays;
      void runFetch();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch, periodDays]);

  if (periodDays === null) {
    return {
      summary: null,
      loading: false,
      error: null,
      refetch: runFetch,
    };
  }
  return { summary, loading, error, refetch: runFetch };
}
