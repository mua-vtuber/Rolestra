/**
 * `useProviders` — the registered AIs' connection data (`provider:list`):
 * type, model and config (CLI command / API endpoint + key ref / local
 * address). The settings AI tab joins it with `useMembers` (name, avatar,
 * work status) to show how each AI is connected.
 *
 * Same contract as {@link useMembers}: strict-mode safe initial fetch,
 * `null` data with an `error` on initial failure (never an empty list in
 * place of a failed call), last-good retention on refresh, and a refetch
 * whenever the channel invalidation bus fires (AI add / delete / rename
 * all notify it).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribeChannelsInvalidation } from './channel-invalidation-bus';
import { invoke } from '../ipc/invoke';
import type { ProviderInfo } from '../../shared/provider-types';

export interface UseProvidersResult {
  providers: ProviderInfo[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useProviders(): UseProvidersResult {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(async (isInitial: boolean): Promise<void> => {
    setLoading(true);
    if (!isInitial) setError(null);
    try {
      const { providers: list } = await invoke('provider:list', undefined);
      if (!mountedRef.current) return;
      setProviders(list);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
      if (isInitial) setProviders(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!didMountFetchRef.current) {
      didMountFetchRef.current = true;
      void runFetch(true);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  useEffect(() => subscribeChannelsInvalidation(async () => {
    if (!mountedRef.current) return;
    await runFetch(false);
  }), [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { providers, loading, error, refresh };
}
