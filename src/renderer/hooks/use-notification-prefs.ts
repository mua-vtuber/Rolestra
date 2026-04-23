/**
 * `useNotificationPrefs` — renderer-side view of the per-kind notification
 * preference map (R9-Task4).
 *
 * Surface:
 *   - mount-fetch `notification:get-prefs` (single call, mirror-only)
 *   - `setKind(kind, { enabled?, soundEnabled? })` → patch invoke
 *     `notification:update-prefs` with `{ patch: { [kind]: entry } }`. The
 *     handler returns the full prefs map; we replace local state with the
 *     response so partial patches always produce a consistent local view.
 *   - `test(kind)` → `notification:test` (diagnostic fire for a single
 *     kind — main-side still obeys the prefs gate by design)
 *   - subscribes to `stream:notification-prefs-changed` and replaces the
 *     entire prefs snapshot when the broadcast arrives. The payload
 *     carries the full map, so no merge is needed.
 *
 * State shape is `NotificationPrefs | null` until first fetch resolves;
 * callers render a loading placeholder while `isLoading` is true.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type {
  NotificationKind,
  NotificationPrefs,
} from '../../shared/notification-types';
import type { StreamV3PayloadOf } from '../../shared/stream-events';

export interface UseNotificationPrefsResult {
  prefs: NotificationPrefs | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  setKind: (
    kind: NotificationKind,
    patch: { enabled?: boolean; soundEnabled?: boolean },
  ) => Promise<void>;
  test: (kind: NotificationKind) => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useNotificationPrefs(): UseNotificationPrefsResult {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const didMountFetchRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const { prefs: next } = await invoke('notification:get-prefs', undefined);
      if (!mountedRef.current) return;
      setPrefs(next);
      setError(null);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(toError(reason));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!didMountFetchRef.current) {
      didMountFetchRef.current = true;
      void refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Stream subscription — replace with the authoritative snapshot.
  useEffect(() => {
    const arena =
      typeof window !== 'undefined'
        ? (window as unknown as { arena?: { onStream?: unknown } }).arena
        : undefined;
    const onStream = arena?.onStream as
      | (<T extends string>(
          type: T,
          cb: (payload: unknown) => void,
        ) => () => void)
      | undefined;
    if (!onStream) return;
    const unsub = onStream('stream:notification-prefs-changed', (rawPayload) => {
      const payload =
        rawPayload as StreamV3PayloadOf<'stream:notification-prefs-changed'>;
      setPrefs(payload.prefs);
    });
    return unsub;
  }, []);

  const setKind = useCallback(
    async (
      kind: NotificationKind,
      patch: { enabled?: boolean; soundEnabled?: boolean },
    ): Promise<void> => {
      try {
        const { prefs: next } = await invoke('notification:update-prefs', {
          patch: { [kind]: patch },
        });
        if (!mountedRef.current) return;
        setPrefs(next);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        throw reason;
      }
    },
    [],
  );

  const test = useCallback(async (kind: NotificationKind): Promise<void> => {
    try {
      await invoke('notification:test', { kind });
      if (mountedRef.current) setError(null);
    } catch (reason) {
      if (mountedRef.current) setError(toError(reason));
      throw reason;
    }
  }, []);

  return { prefs, isLoading, error, refresh, setKind, test };
}
