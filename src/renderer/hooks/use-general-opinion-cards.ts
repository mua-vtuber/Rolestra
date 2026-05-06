/**
 * `useGeneralOpinionCards` — 일반 채널 SsmBox (GeneralVariant) 의 카드 list +
 * 카운터 + 사용자 vote 묶음 fetcher (R12-C2 P4 T21).
 *
 * Contract:
 *   - mount + `channelId` 변경 시 `opinion:listGeneralCards` 1 회 호출 — strict-mode safe.
 *   - 초기 state: `loading=true, cards=null, error=null`
 *   - 성공: `loading=false, cards=[...]`
 *   - 실패: `loading=false, error=<Error>`. 초기 fetch 면 cards 는 null 유지,
 *     refresh 면 직전 카드 그대로 둠 (transient 실패 시 깜빡임 방지).
 *   - `refresh()` 직접 재호출.
 *   - `toggleLightVote(opinionId, vote)` — IPC 호출 후 결과의 카드만 in-place
 *     patch. 채널 단위 refetch 없이 빠른 반응성 + 다른 카드 안정성.
 *
 * Stream 구독:
 *   - `stream:channel-message` — 새 메시지 안 [##본문] 파서가 의견 카드를 등록할
 *     수 있으므로 일반 채널 (`channelId` match) 메시지 도착 시 refetch.
 *   - 회의 / 합의 stream 은 일반 채널과 무관 → 구독 X.
 *
 * `channelId === null` (채널 미선택 등) → IPC 호출 skip / cards=null.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type {
  GeneralOpinionCard,
  ToggleLightVoteResult,
} from '../../shared/opinion-types';
import type { StreamChannelMessagePayload } from '../../shared/stream-events';

export interface UseGeneralOpinionCardsResult {
  cards: GeneralOpinionCard[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  /**
   * 사용자 light vote 토글 — IPC 호출 후 결과의 카드 1 건만 갱신 (전체 list
   * refetch 없이). 호출자는 button onClick 등에서 await 필요 X.
   */
  toggleLightVote: (
    opinionId: string,
    vote: 'agree' | 'oppose',
  ) => Promise<void>;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useGeneralOpinionCards(
  channelId: string | null,
): UseGeneralOpinionCardsResult {
  const [cards, setCards] = useState<GeneralOpinionCard[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  const runFetch = useCallback(
    async (isInitial: boolean): Promise<void> => {
      if (channelId === null) {
        if (mountedRef.current) {
          setCards(null);
          setLoading(false);
          setError(null);
        }
        return;
      }
      setLoading(true);
      if (!isInitial) setError(null);
      try {
        const { result } = await invoke('opinion:listGeneralCards', {
          channelId,
        });
        if (!mountedRef.current) return;
        // stale response (channelId 가 호출 후 바뀐 경우) discard.
        if (channelIdRef.current !== channelId) return;
        setCards(result.cards);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
        if (isInitial) setCards(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [channelId],
  );

  useEffect(() => {
    mountedRef.current = true;
    void runFetch(true);
    return () => {
      mountedRef.current = false;
    };
  }, [runFetch]);

  // stream:channel-message — 같은 channelId 의 메시지 도착 시 refetch.
  // [##] 파서 / dm-auto-responder 가 카드를 등록할 수 있으므로.
  useEffect(() => {
    if (channelId === null) return undefined;
    const bridge = typeof window !== 'undefined' ? window.arena : undefined;
    const onStream = bridge?.onStream;
    if (!onStream) return undefined;

    const off = onStream(
      'stream:channel-message',
      (payload: StreamChannelMessagePayload) => {
        if (!mountedRef.current) return;
        if (payload.message.channelId !== channelId) return;
        void runFetch(false);
      },
    );
    return () => {
      off();
    };
  }, [channelId, runFetch]);

  const refresh = useCallback(async (): Promise<void> => {
    await runFetch(false);
  }, [runFetch]);

  const toggleLightVote = useCallback(
    async (opinionId: string, vote: 'agree' | 'oppose'): Promise<void> => {
      try {
        const { result } = await invoke('opinion:toggleLightVote', {
          opinionId,
          vote,
        });
        if (!mountedRef.current) return;
        applyToggleResult(setCards, result);
        setError(null);
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(toError(reason));
      }
    },
    [],
  );

  return { cards, loading, error, refresh, toggleLightVote };
}

/**
 * 토글 IPC 결과를 cards state 안 카드 1 건에 in-place patch. opinionId
 * 매칭 안 되면 (드물게 카드가 동시에 사라진 경우) skip — caller 가 다음
 * refetch 시 자연 정리.
 */
function applyToggleResult(
  setCards: React.Dispatch<
    React.SetStateAction<GeneralOpinionCard[] | null>
  >,
  result: ToggleLightVoteResult,
): void {
  setCards((prev) => {
    if (prev === null) return prev;
    return prev.map((card) =>
      card.opinion.id === result.opinionId
        ? {
            opinion: card.opinion,
            agreeCount: result.agreeCount,
            opposeCount: result.opposeCount,
            userVote: result.userVote,
          }
        : card,
    );
  });
}
