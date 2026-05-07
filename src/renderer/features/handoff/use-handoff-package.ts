/**
 * useHandoffPackage — R12-C2 P6 T29.
 *
 * 받는 부서 채널 단위 unopened 의뢰서 lookup hook. SsmBox 가 부서 채널 진입 시
 * 호출 → unopened 의뢰서 1 통이라도 있으면 카드 표시 결정.
 *
 * 동작:
 *   1. channelId 변경 시 invoke('handoff:list-by-channel', unopenedOnly=true)
 *   2. items.length > 0 → 첫 row (가장 최근) → invoke('handoff:read-with-minutes')
 *      → state set (item + minutesBody + nextActions)
 *   3. invoke('handoff:open') 호출 — opened_at 캐시 (idempotent). 카드 closed
 *      후 같은 채널 재진입 시 unopenedOnly 결과에서 빠짐 (재 surface X — 사용자
 *      [패키지 다시 보기] 버튼이 별 entry, T29 시점 mount 보류).
 *   4. stream:handoff-dispatched (auto / check 결과) 도착 시 받는 채널 일치하면
 *      재 fetch — 새 의뢰서가 들어와도 surface 갱신.
 *
 * IPC 실패 시 silent — error 만 console.warn (UI 는 카드 미표시 fallback).
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../ipc/invoke';
import type { HandoffDispatchRowSummary } from '../../../shared/handoff/dispatch-row-summary';
import type { StreamHandoffDispatchedPayload } from '../../../shared/stream-events';

interface PendingPackage {
  item: HandoffDispatchRowSummary;
  minutesBody: string | null;
  nextActions: string[];
}

export interface UseHandoffPackageResult {
  /** unopened 의뢰서 1 통. null = 없음 또는 미로딩. */
  pending: PendingPackage | null;
  /** 사용자 [닫기] / 회의 시작 후 카드 hide. */
  dismiss: () => void;
  /** 강제 재 fetch (디버그 / 회의 종결 후 재 surface). */
  refresh: () => Promise<void>;
}

export function useHandoffPackage(
  channelId: string | null,
): UseHandoffPackageResult {
  const [pending, setPending] = useState<PendingPackage | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const fetchPending = useCallback(async (): Promise<void> => {
    if (channelId === null) {
      setPending(null);
      return;
    }
    try {
      const { items } = await invoke('handoff:list-by-channel', {
        channelId,
        unopenedOnly: true,
      });
      // 사용자가 이미 닫은 의뢰서는 surface 안 함 (같은 세션 안 hide 보존).
      const candidate = items.find((i) => !dismissedIds.has(i.id));
      if (candidate === undefined) {
        setPending(null);
        return;
      }
      const { item, minutesBody, nextActions } = await invoke(
        'handoff:read-with-minutes',
        { dispatchRowId: candidate.id },
      );
      // open mark — 사용자가 카드를 *볼 수 있는* 상태가 되면 1 회 호출.
      try {
        await invoke('handoff:open', { dispatchRowId: candidate.id });
      } catch (err) {
        console.warn(
          '[useHandoffPackage] handoff:open threw',
          err instanceof Error ? err.message : String(err),
        );
      }
      setPending({ item, minutesBody, nextActions });
    } catch (err) {
      console.warn(
        '[useHandoffPackage] list/read threw',
        err instanceof Error ? err.message : String(err),
      );
      setPending(null);
    }
  }, [channelId, dismissedIds]);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  // stream:handoff-dispatched 도착 시 받는 채널 일치하면 재 fetch.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream || channelId === null) return;
    const off = onStream(
      'stream:handoff-dispatched',
      (payload: StreamHandoffDispatchedPayload) => {
        if (payload.targetChannelId !== channelId) return;
        void fetchPending();
      },
    );
    return off;
  }, [channelId, fetchPending]);

  const dismiss = useCallback((): void => {
    if (pending === null) return;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(pending.item.id);
      return next;
    });
    setPending(null);
  }, [pending]);

  return {
    pending,
    dismiss,
    refresh: fetchPending,
  };
}
