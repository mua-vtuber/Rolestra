/**
 * Migration 017-providers-roles-skills — R12-S 페르소나/스킬 분리.
 *
 * - `roles TEXT NOT NULL DEFAULT '[]'`: JSON-serialized RoleId 배열.
 *   예: '["planning","design.ui","design.ux"]'. 빈 배열 = legacy 동작
 *   (R12-C 진입 전까지 부서 매칭 없음).
 *
 * - `skill_overrides TEXT`: JSON-serialized Record<RoleId, string> (nullable).
 *   사용자 customize prompt 템플릿. NULL = catalog default 사용.
 *
 * persona 컬럼 의미는 *문서 수준* 으로만 변경 (캐릭터 only) — 기존 데이터는
 * 그대로. 사용자가 직원 편집 모달에서 정리하라는 안내만 띄움 (Task 8).
 *
 * SQLite 의 ALTER TABLE ADD COLUMN 은 IF NOT EXISTS 미지원 — chain-level
 * idempotency (migrator tracking 표) 만 보장.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '017-providers-roles-skills',
  sql: `
ALTER TABLE providers ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE providers ADD COLUMN skill_overrides TEXT;
`,
};
