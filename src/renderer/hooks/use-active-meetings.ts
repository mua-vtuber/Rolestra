/**
 * `useActiveMeetings` — fetches the top-N active meetings for the R4
 * dashboard TasksWidget (spec §7.5).
 *
 * Contract mirrors {@link useDashboardKpis}:
 * - On mount: calls `meeting:list-active` once, strict-mode safe.
 * - Initial state: `loading=true, data=null, error=null`.
 * - On success: `loading=false, data={meetings: [...]}`.
 * - On error: `loading=false, error=<Error>`, `data` stays null on the
 *   initial fetch. Refresh keeps the last good `data` so the widget
 *   doesn't flash empty rows during a transient failure.
 * - `refresh()` re-runs the fetch.
 *
 * The hook owns NO transformation beyond the IPC response — the repo
 * already shapes the rows for the widget (joined project/channel names,
 * stateIndex, elapsedMs).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ActiveMeetingSummary } from '../../shared/meeting-types';
import type {
  StreamMeetingStateChangedPayload,
  StreamMeetingErrorPayload,
} from '../../shared/stream-events';

export interface UseActiveMeetingsResult {
  meetings: ActiveMeetingSummary[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useActiveMeetings(limit?: number): UseActiveMeetingsResult {
  const [meetings, setMeetings] = useState<ActiveMeetingSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const didMountFetchRef = useRef(false);
  const mountedRef = useRef(true);

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        // The channel accepts `{ limit? } | undefined`; passing `{}` keeps
        // the default. Omitting `limit` explicitly lets the repo's clamp
        // pipeline (default=10) own the fallback.
        const { meetings: list } = await invoke(
          'meeting:list-active',
          limit === undefined ? {} : { limit },
        );
        if (!mountedRef.current) return;
        setMeetings(list);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setMeetings(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [limit],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (didMountFetchRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    didMountFetchRef.current = true;
    void runFetch(true);
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  // dogfooding 2026-05-01 #1-4 / 추가2 — stream-driven refresh.
  // 사용자 보고: 합의 패널 / 채널 진행중 라벨 / SSM 진행도 가 stale —
  // 회의 시작 / state 변경 / 종료 / abort 시 자동 갱신 안 됨.
  // 원래 mount 시 한 번만 fetch 했는데, 활성 회의 목록은 라이브 데이터라
  // streambridge 가 emit 하는 4 이벤트 (state-changed / turn-done /
  // error / turn-skipped) 받을 때마다 refetch.
  // 모든 이벤트가 active list 의 변화를 반드시 의미하지는 않지만 (예:
  // turn-token 은 빠짐) refetch 비용은 cheap 하고 stale 노출이 더 큰 문제.
  // turn-token 만 의도적 제외 — 매 토큰 마다 IPC 라운드트립은 과함.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return undefined;

    const triggerRefresh = (): void => {
      if (!mountedRef.current) return;
      void runFetch(false);
    };

    const offState = onStream(
      'stream:meeting-state-changed',
      (_payload: StreamMeetingStateChangedPayload) => {
        triggerRefresh();
      },
    );
    const offError = onStream(
      'stream:meeting-error',
      (_payload: StreamMeetingErrorPayload) => {
        triggerRefresh();
      },
    );
    const offTurnDone = onStream('stream:meeting-turn-done', () => {
      triggerRefresh();
    });
    const offTurnSkipped = onStream('stream:meeting-turn-skipped', () => {
      triggerRefresh();
    });
    return () => {
      offState();
      offError();
      offTurnDone();
      offTurnSkipped();
    };
  }, [runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  return { meetings, loading, error, refresh };
}
