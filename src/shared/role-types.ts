/**
 * Role / Skill 식별자 — R12-S 페르소나/스킬 분리.
 *
 * 10 능력 (9 직원 + 1 시스템) 의 type-level 정의. 카탈로그 본문 (prompt
 * 텍스트, tool 권한 matrix) 은 src/shared/skill-catalog.ts 에 위치한다.
 *
 * 본 union 은 forward-only — 새 role 추가 시 catalog + i18n + UI chip
 * 모두 동기 업데이트.
 */

/** 직원에게 부여 가능한 능력 (9). */
export type RoleId =
  | 'idea'
  | 'planning'
  | 'design.ui'
  | 'design.ux'
  | 'design.character'
  | 'design.background'
  | 'implement'
  | 'review'
  | 'general';

/** 시스템만 호출 — 직원 부여 X. */
export type SystemSkillId = 'meeting-summary';

/** Skill catalog entry 의 ID 합집합. */
export type SkillId = RoleId | SystemSkillId;

/** Tool 권한 matrix 키. */
export type ToolGrant =
  | 'file.read'
  | 'file.write'
  | 'command.exec'
  | 'db.read'
  | 'web.search';

/** 카탈로그 항목 = system prompt + tool 권한 matrix + 외부 endpoint slot. */
export interface SkillTemplate {
  /** 능력 ID. */
  id: SkillId;
  /** UI 라벨 (i18n 키 fallback). */
  label: { ko: string; en: string };
  /** 한국어 system prompt 본문 (default — settings.ts 의 i18n 분기는 R11 D9 따름). */
  systemPromptKo: string;
  /** boolean matrix — 직원이 그 부서에서 활성 시 적용. */
  toolGrants: Record<ToolGrant, boolean>;
  /** 외부 자원 endpoint slot (R12-S 는 schema 만, 호출은 후속). */
  externalEndpoints: string[];
}

/** 9 직원 능력의 readonly array — UI chip / 검증 enum. */
export const ALL_ROLE_IDS: readonly RoleId[] = [
  'idea',
  'planning',
  'design.ui',
  'design.ux',
  'design.character',
  'design.background',
  'implement',
  'review',
  'general',
] as const;

/** type guard. */
export function isRoleId(value: string): value is RoleId {
  return (ALL_ROLE_IDS as readonly string[]).includes(value);
}
