/**
 * Channel role / purpose / handoff_mode 타입 — R12-C 채널 역할 land.
 *
 * - ChannelRole: 부서 채널의 능력 매핑 (RoleId 재사용) 또는 NULL (system 채널 / DM / legacy user).
 * - ChannelPurpose: 사용자 작성 자유 텍스트 또는 NULL.
 * - HandoffMode: 부서 인계 직전 confirm 모드 (디폴트 'check', R7 ApprovalService 와 별개).
 */

import type { RoleId } from './role-types';

/** 채널의 부서 매핑. NULL = system 채널 / DM / legacy user. */
export type ChannelRole = RoleId | null;

/** 채널 목적 자유 텍스트. NULL = 사용자 미작성. */
export type ChannelPurpose = string | null;

/** 부서 인계 직전 confirm 모드. */
export type HandoffMode = 'check' | 'auto';

/** 디폴트 = 'check' (사용자 본인 경험 반영 — "논스톱이라 생각했는데 중간 완성이라 화남" 의 정확한 해결책). */
export const DEFAULT_HANDOFF_MODE: HandoffMode = 'check';

/** 모든 HandoffMode 값. UI 토글 / zod schema 용. */
export const ALL_HANDOFF_MODES = ['check', 'auto'] as const;

/** type guard. */
export function isHandoffMode(value: unknown): value is HandoffMode {
  return typeof value === 'string' && (ALL_HANDOFF_MODES as readonly string[]).includes(value);
}

/**
 * R12-C2 T16b — "디자인 부서" 식별. spec §3 line 86 (디자인 부서 = [design.ui,
 * design.ux] 두 능력 묶음). 두 RoleId 중 하나면 design-workflow (T16) 가
 * 실행되어야 함. design.character / design.background 는 별도 부서 — 본
 * 분기에 포함 X.
 */
export function isDesignDepartmentRole(role: ChannelRole): boolean {
  return role === 'design.ui' || role === 'design.ux';
}
