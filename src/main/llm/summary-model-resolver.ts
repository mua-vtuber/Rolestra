/**
 * Summary Model Resolver — R12-S 회의록 정리 모델 자동 선택.
 *
 * 우선순위:
 *   1. 사용자 명시 (settings.summaryModelProviderId)
 *   2. Anthropic API + Haiku (저렴 + 품질)
 *   3. Gemini API + Flash
 *   4. summarize capability 있는 기타 api/cli
 *   5. Local Ollama (오프라인 fallback)
 *
 * 사용자 명시 id 가 registry 에 없거나, 자동 후보가 모두 없으면 null —
 * calling code (MeetingSummaryService) 가 정리 skip 하도록 위임. 사용자가
 * 명시한 provider 가 summarize capability 가 없는 경우의 처리는
 * MeetingSummaryService 가 담당 (loud throw — Task 10).
 */

import type { ProviderInfo } from '../../shared/provider-types';

export interface SummaryModelSettings {
  /** null = 자동 선택. 그 외 = 사용자 명시 providerId. */
  summaryModelProviderId: string | null;
}

export function resolveSummaryProvider(
  settings: SummaryModelSettings,
  all: ProviderInfo[],
): ProviderInfo | null {
  // 1. 사용자 명시
  if (settings.summaryModelProviderId !== null) {
    return all.find((p) => p.id === settings.summaryModelProviderId) ?? null;
  }

  const ready = all.filter(
    (p) => p.status === 'ready' && p.capabilities.includes('summarize'),
  );

  // 2. Anthropic Haiku
  const haiku = ready.find(
    (p) => p.type === 'api' && /haiku/i.test(p.model),
  );
  if (haiku) return haiku;

  // 3. Gemini Flash
  const flash = ready.find(
    (p) => p.type === 'api' && /flash/i.test(p.model),
  );
  if (flash) return flash;

  // 4. 기타 api/cli (summarize capability 만족 + ready 만)
  const otherApiCli = ready.find((p) => p.type === 'api' || p.type === 'cli');
  if (otherApiCli) return otherApiCli;

  // 5. Local Ollama
  const local = ready.find((p) => p.type === 'local');
  if (local) return local;

  return null;
}
