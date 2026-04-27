/**
 * `buildStaffCandidates` — provider:detect snapshot 을 OBStaffCard 가 직접
 * 소비할 수 있는 정규화된 view-model 로 변환한다.
 *
 * F1 (mock/fallback cleanup) 이후 wizard Step2 의 단일 데이터 소스. 알려진
 * provider id (claude / gemini / codex / copilot / local / grok) 는 i18n
 * 사전 (`onboarding.providers.<id>`) 에서 표시 메타를 끌어오고, 알려지지
 * 않은 id 는 unknown fallback (사전: `onboarding.providers.unknown`) +
 * snapshot.providerId 자체를 name / initial 로 사용한다. detection 결과에
 * 없는 provider 는 카드 자체가 렌더링되지 않으므로 알려진 fixture 6 종이
 * 항상 카드로 표시되던 R11 동작과는 의도적으로 다르다 — 사용자가 "감지
 * 안 됐는데 알려진 provider" 를 보지 못하도록 하는 의도. (Settings → CLI
 * 탭에서 수동 추가 후 Step2 rescan 하면 카드가 등장한다.)
 */

import type { TFunction } from 'i18next';

import type { ProviderDetectionSnapshot } from '../../../shared/onboarding-types';
import type { StaffCandidate } from './onboarding-data';

const KNOWN_PROVIDER_IDS = [
  'claude',
  'gemini',
  'codex',
  'copilot',
  'local',
  'grok',
] as const;

type KnownProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

function isKnownProviderId(id: string): id is KnownProviderId {
  return (KNOWN_PROVIDER_IDS as ReadonlyArray<string>).includes(id);
}

export function buildStaffCandidates(
  snapshots: ReadonlyArray<ProviderDetectionSnapshot>,
  selectedIds: ReadonlyArray<string> | undefined,
  t: TFunction,
): ReadonlyArray<StaffCandidate> {
  const selectedSet = new Set(selectedIds ?? []);
  return snapshots.map((snapshot) => {
    const known = isKnownProviderId(snapshot.providerId);
    const base = `onboarding.providers.${known ? snapshot.providerId : 'unknown'}`;
    return {
      id: snapshot.providerId,
      name: known ? t(`${base}.name`) : snapshot.providerId,
      vendor: t(`${base}.vendor`),
      tagline: t(`${base}.tagline`),
      bestFor: t(`${base}.bestFor`),
      price: t(`${base}.price`),
      initial: known
        ? t(`${base}.initial`)
        : (snapshot.providerId.charAt(0).toUpperCase() || '?'),
      detected: snapshot.available,
      selected: selectedSet.has(snapshot.providerId),
    };
  });
}

/**
 * 첫 wizard 진입 (selections.staff === undefined) 에 한해 detection 결과
 * 중 available=true 인 모든 provider 를 pre-select 한다. 사용자가 한 번이라도
 * staff 배열을 비우거나 채우면 그 결정이 영속화되어 본 함수가 다시 갈아치우지
 * 않는다 (호출 측이 selections.staff !== undefined 일 때 본 함수를 부르지
 * 않도록 가드).
 */
export function defaultPreSelection(
  snapshots: ReadonlyArray<ProviderDetectionSnapshot>,
): string[] {
  return snapshots
    .filter((s) => s.available)
    .map((s) => s.providerId);
}
