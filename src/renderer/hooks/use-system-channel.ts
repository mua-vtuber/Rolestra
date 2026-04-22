/**
 * `useSystemChannel` — R7-Task10.
 *
 * Given a `projectId` and a system channel kind(`system_general` /
 * `system_approval` / `system_minutes`), asynchronously resolves the
 * matching channel id via the `channel:list` IPC. Used by widgets that
 * need to navigate to a system channel (ApprovalsWidget → #승인-대기,
 * future RecentWidget → #회의록 등).
 *
 * Contract:
 *   - `projectId=null` → returns `{ channelId: null, loading: false }`
 *     without firing IPC. Callers can safely render an inert row.
 *   - IPC error → logs a warning and surfaces `channelId: null`. The
 *     caller decides whether to block the navigation or fall back.
 *   - Strict-mode double-mount safe — fetch once per `projectId+kind`
 *     combo.
 */
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ChannelKind } from '../../shared/channel-types';

export interface UseSystemChannelResult {
  channelId: string | null;
  loading: boolean;
  error: Error | null;
}

export function useSystemChannel(
  projectId: string | null,
  kind: ChannelKind,
): UseSystemChannelResult {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const key = projectId === null ? null : `${projectId}|${kind}`;
    if (lastKeyRef.current === key) {
      return () => {
        mountedRef.current = false;
      };
    }
    lastKeyRef.current = key;

    if (projectId === null) {
      setChannelId(null);
      setLoading(false);
      setError(null);
      return () => {
        mountedRef.current = false;
      };
    }

    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { channels } = await invoke('channel:list', { projectId });
        if (!mountedRef.current) return;
        const found = channels.find((c) => c.kind === kind);
        setChannelId(found?.id ?? null);
      } catch (reason) {
        if (!mountedRef.current) return;
        const err =
          reason instanceof Error ? reason : new Error(String(reason));
        console.warn('[rolestra] useSystemChannel channel:list failed', err);
        setError(err);
        setChannelId(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [projectId, kind]);

  return { channelId, loading, error };
}
