/**
 * Onboarding 정적 메타 — wizard step 정의 + Step2 staff card view-model 인터페이스.
 *
 * F1 (mock/fallback cleanup) 이전에는 본 파일이 `STAFF_CANDIDATES` 6 provider
 * 하드코딩 fixture 를 export 해 Step2 staff-grid 를 비-IPC 로 렌더했다. 이는
 * 사용자 ABSOLUTE PROHIBITIONS (mock data on production code path) 위반이라
 * 모듈에서 fixture 를 모두 제거했다. Step2 는 이제 `provider:detect` 결과만
 * 사용하며 (`OnboardingPage` + `useOnboardingState`), 본 파일은 view-model 형
 * 인터페이스 + 5 step 정의만 보관한다.
 *
 * `StaffCandidate` 인터페이스는 OBStaffCard / OBSummaryStrip 두 컴포넌트가
 * 공유하는 정규화된 카드 데이터 모양이다. OnboardingPage 가
 * `provider:detect` snapshot + i18n provider 사전 (`onboarding.providers.<id>`)
 * 을 합성해 매 렌더마다 빌드한다.
 */

export type OBStepStatus = 'pending' | 'current' | 'completed';

export interface OBStep {
  id: number;
  /** i18n key suffix (e.g. `'office'` → `t('onboarding.steps.office')`). */
  key: string;
  status: OBStepStatus;
}

/**
 * Step2 staff-grid 의 카드 한 장에 필요한 view-model.
 *
 * `id` 는 ProviderDetectionSnapshot.providerId (registry 내 provider id 또는
 * CLI command name). `name` / `vendor` / `tagline` / `bestFor` / `price` /
 * `initial` 은 i18n 사전 lookup 결과 (알려지지 않은 id 는 unknown fallback).
 * `detected` 는 snapshot.available, `selected` 는 사용자가 wizard 에서 토글한
 * 누적 선택 (`OnboardingState.selections.staff`).
 */
export interface StaffCandidate {
  id: string;
  name: string;
  vendor: string;
  /** One-line personality / strengths (e.g. "사려 깊은 시니어"). */
  tagline: string;
  /** Best-for keyword string (already comma-joined). */
  bestFor: string;
  /** Plan label (e.g. "$20/mo · Pro", "무료"). */
  price: string;
  /** Single-letter avatar fallback. */
  initial: string;
  /** True if Rolestra detected this CLI/runtime locally. */
  detected: boolean;
  /** True if the user has the card selected in the wizard. */
  selected: boolean;
}

export const ONBOARDING_STEPS: ReadonlyArray<OBStep> = [
  { id: 1, key: 'office', status: 'completed' },
  { id: 2, key: 'staff', status: 'current' },
  { id: 3, key: 'roles', status: 'pending' },
  { id: 4, key: 'permissions', status: 'pending' },
  { id: 5, key: 'firstProject', status: 'pending' },
];

export type DetectionState = 'selected' | 'detected' | 'alt';

export function detectionStateOf(c: StaffCandidate): DetectionState {
  if (c.selected) return 'selected';
  if (c.detected) return 'detected';
  return 'alt';
}
