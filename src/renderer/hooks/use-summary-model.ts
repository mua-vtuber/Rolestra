/**
 * `useSummaryModel` — R12-S Task 11.
 *
 * 설정 카드의 회의록 정리 모델 선택 hook. 두 가지 IPC 묶음:
 *   - `config:get-settings` 의 summaryModelProviderId (사용자 명시 / null=auto)
 *   - `settings:getResolvedSummaryModel` 의 현재 resolver 결과 (자동 / 명시 양쪽 미리보기)
 *
 * `setProvider(id | null)` 는 `settings:setSummaryModel` 호출 후 두 값을
 * 다시 fetch — 사용자가 "자동" → "특정" 토글하면 즉시 currentLabel 갱신.
 *
 * 호출지가 사용자 인터랙션마다 reload — IPC round-trip 두 번씩 들어가지만
 * settings 카드는 클릭 빈도가 낮아 비용 무시 가능.
 */
import { useCallback, useEffect, useState } from 'react';

import { invoke } from '../ipc/invoke';
import type { ProviderInfo } from '../../shared/provider-types';

export interface UseSummaryModelResult {
  /** 사용자 명시 providerId. null = 자동 모드. */
  providerId: string | null;
  /** 현재 resolver 결과. null = 후보 없음 (정리 skip). */
  resolved: ProviderInfo | null;
  loading: boolean;
  error: Error | null;
  /** 사용자 토글 — null = 자동, string = 특정 provider. */
  setProvider(id: string | null): Promise<void>;
}

export function useSummaryModel(): UseSummaryModelResult {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { settings } = await invoke('config:get-settings', undefined);
      const { provider } = await invoke(
        'settings:getResolvedSummaryModel',
        undefined,
      );
      setProviderId(settings.summaryModelProviderId);
      setResolved(provider);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 마운트 시 1회 fetch — refresh 가 async 라 setState 는 effect body 가
    // 끝난 후 fire 한다. set-state-in-effect 룰이 useCallback 추적으로 잡는데,
    // 패턴 자체는 use-channels / use-channel-messages 와 동일 (룰 회피용 주석).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const setProvider = useCallback(
    async (id: string | null): Promise<void> => {
      try {
        await invoke('settings:setSummaryModel', { providerId: id });
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      }
    },
    [refresh],
  );

  return { providerId, resolved, loading, error, setProvider };
}
