/**
 * Onboarding wizard 도메인 타입 (R11-Task5).
 *
 * 첫 부팅 시 사용자가 거치는 5-step wizard 의 상태 / 선택 / provider detection
 * 결과를 main ↔ renderer 사이에서 일관된 형태로 주고받기 위한 shared 타입이다.
 * 단일-window 가정(Decision D6)이라 stream 이벤트는 두지 않고, IPC `onboarding:*`
 * 채널이 1회용 set/get/complete 로만 주고받는다. 영속화 대상은 step 5 까지의
 * 누적 선택뿐이며 마이그레이션 013 (R11-Task6) 이 `onboarding_state` 단일행
 * 테이블로 보관한다.
 */

import type { PermissionMode, ProjectKind } from './project-types';
import type { ProviderCapability, ProviderType } from './provider-types';

/** 1=office, 2=staff, 3=roles, 4=permissions, 5=firstProject (data 와 정합). */
export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

/**
 * 사용자가 step 별로 누적해 온 선택값. 모든 필드가 optional 이라 partial
 * patch 시 부분 갱신만 안전하게 적용된다.
 *
 * - `staff` — step 2 에서 체크된 provider id 목록
 * - `roles` — step 3 에서 provider id → role label 로 매핑
 * - `permissions` — step 4 에서 선택한 PermissionMode (project default)
 * - `firstProject` — step 5 에서 입력한 첫 프로젝트 (slug + kind)
 */
export interface OnboardingSelections {
  staff?: string[];
  roles?: Record<string, string>;
  permissions?: PermissionMode;
  firstProject?: {
    slug: string;
    kind: ProjectKind;
  };
}

/**
 * 첫 부팅 wizard 상태 1-row.
 *
 * - `completed` — true 가 되는 순간 ShellTopBar 의 "Restart onboarding" CTA
 *   외에는 wizard 진입 경로가 없다.
 * - `currentStep` — 사용자가 마지막으로 머문 step. resume 시 이 step 으로 점프.
 * - `selections` — 위 OnboardingSelections.
 * - `updatedAt` — Date.now() millisecond. 마이그레이션 013 의 row update 와 동기.
 */
export interface OnboardingState {
  completed: boolean;
  currentStep: OnboardingStep;
  selections: OnboardingSelections;
  updatedAt: number;
}

/**
 * `provider:detect` 가 반환하는 단일 provider 의 detection 결과.
 *
 * - `available` — 로컬에서 호출 가능한지 (CLI binary 설치 여부 / API key 등).
 * - `reason` — `available=false` 일 때 사용자에게 보일 단서 (locale 키 또는
 *   raw 메시지). available=true 면 생략.
 * - `capabilities` — provider 가 보고하는 capability 스냅샷. R11-Task9 후
 *   `'summarize'` 가 포함된다.
 */
export interface ProviderDetectionSnapshot {
  providerId: string;
  kind: ProviderType;
  available: boolean;
  reason?: string;
  capabilities: ProviderCapability[];
}
