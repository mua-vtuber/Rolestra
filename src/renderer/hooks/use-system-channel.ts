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
import { useEffect, useReducer, useRef } from 'react';

import { invoke } from '../ipc/invoke';
import type { ChannelKind } from '../../shared/channel-types';

export interface UseSystemChannelResult {
  channelId: string | null;
  loading: boolean;
  error: Error | null;
}

interface State {
  channelId: string | null;
  loading: boolean;
  error: Error | null;
}
type Action =
  | { type: 'reset' }
  | { type: 'fetchStart' }
  | { type: 'fetchSuccess'; channelId: string | null }
  | { type: 'fetchError'; error: Error };

const INITIAL_STATE: State = {
  channelId: null,
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'fetchStart':
      return { ...state, loading: true, error: null };
    case 'fetchSuccess':
      return { channelId: action.channelId, loading: false, error: null };
    case 'fetchError':
      return { channelId: null, loading: false, error: action.error };
  }
}

export function useSystemChannel(
  projectId: string | null,
  kind: ChannelKind,
): UseSystemChannelResult {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
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
      dispatch({ type: 'reset' });
      return () => {
        mountedRef.current = false;
      };
    }

    dispatch({ type: 'fetchStart' });
    (async () => {
      try {
        const { channels } = await invoke('channel:list', { projectId });
        if (!mountedRef.current) return;
        const found = channels.find((c) => c.kind === kind);
        dispatch({ type: 'fetchSuccess', channelId: found?.id ?? null });
      } catch (reason) {
        if (!mountedRef.current) return;
        const err =
          reason instanceof Error ? reason : new Error(String(reason));
        console.warn('[rolestra] useSystemChannel channel:list failed', err);
        dispatch({ type: 'fetchError', error: err });
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [projectId, kind]);

  return state;
}
