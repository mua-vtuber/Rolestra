/**
 * SummaryModelCard — R12-S Task 11.
 *
 * "회의록 정리 담당" 설정 카드. 두 라디오:
 *   - "자동 (추천)" — settings.summaryModelProviderId = null 저장.
 *     resolver 가 4단계로 결정 (Haiku → Flash → 기타 → Ollama).
 *   - "특정 모델 지정" — summarize capability 있는 provider 만 노출.
 *
 * 두 모드 모두 현재 resolver 가 선택할 provider 라벨을 보여줘서
 * 사용자가 무엇이 실제로 사용될지 확인 가능. 후보가 모두 없으면 "사용
 * 가능한 모델이 없습니다" — 회의록은 결정문만 저장된다는 안내.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../ipc/invoke';
import { useSummaryModel } from '../../hooks/use-summary-model';
import type { ProviderInfo } from '../../../shared/provider-types';

export function SummaryModelCard(): ReactElement {
  const { t } = useTranslation();
  const { providerId, resolved, loading, error, setProvider } = useSummaryModel();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const refreshProviders = useCallback(async (): Promise<void> => {
    try {
      const { providers: list } = await invoke('provider:list', undefined);
      setProviders(list);
    } catch {
      // provider 목록 fetch 실패는 카드 표시에 치명적이지 않음 — 빈 배열
      // 로 두고 user 가 retry 가능.
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    // 마운트 시 1회 provider 목록 fetch (summarize capable 필터링용).
    // 비동기 setState 패턴 — set-state-in-effect 룰 회피 주석.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProviders();
  }, [refreshProviders]);

  const summarizeCapable = providers.filter((p) =>
    p.capabilities.includes('summarize'),
  );
  const isAuto = providerId === null;

  return (
    <section
      data-testid="settings-summary-model-card"
      className="space-y-3 max-w-xl border border-panel-border rounded-panel bg-sunk p-4"
    >
      <header>
        <h3 className="text-sm font-display font-semibold">
          {t('settings.summaryModel.cardTitle')}
        </h3>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.summaryModel.cardSubtitle')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-summary-model-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1"
        >
          {t('settings.summaryModel.error', { message: error.message })}
        </div>
      )}

      {loading ? (
        <p
          data-testid="settings-summary-model-loading"
          className="text-xs text-fg-muted italic"
        >
          {t('settings.summaryModel.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="settings-summary-model-mode"
              data-testid="settings-summary-model-radio-auto"
              checked={isAuto}
              onChange={() => {
                void setProvider(null);
              }}
            />
            <span>{t('settings.summaryModel.modeAuto')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="settings-summary-model-mode"
              data-testid="settings-summary-model-radio-manual"
              checked={!isAuto}
              onChange={() => {
                const fallback = summarizeCapable[0]?.id ?? null;
                if (fallback === null) return;
                void setProvider(fallback);
              }}
              disabled={summarizeCapable.length === 0}
            />
            <span>{t('settings.summaryModel.modeManual')}</span>
          </label>

          {!isAuto && (
            <select
              data-testid="settings-summary-model-select"
              className="bg-elev text-fg border border-border-soft rounded-panel px-2 py-1.5 text-sm"
              value={providerId ?? ''}
              onChange={(e) => {
                void setProvider(e.target.value);
              }}
            >
              {summarizeCapable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.model})
                </option>
              ))}
            </select>
          )}

          <p
            data-testid="settings-summary-model-current"
            className="text-xs text-fg-muted"
          >
            {resolved !== null
              ? t('settings.summaryModel.currentLabel', {
                  name: `${resolved.displayName} (${resolved.model})`,
                })
              : t('settings.summaryModel.currentNone')}
          </p>
        </div>
      )}
    </section>
  );
}
