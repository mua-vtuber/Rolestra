/**
 * Migration 018-channels-role-purpose-handoff — R12-C 채널 역할 + 부서별 회의 형식.
 *
 * 1 phase 1 마이그레이션 원칙으로 Task 1 + Task 18 통합:
 *
 * - `channels.role TEXT`: RoleId (idea / planning / design.ui / design.ux /
 *   design.character / design.background / implement / review / general) 또는
 *   NULL (system 채널). NULL = 부서 매칭 없음 (system 채널 / DM / legacy user).
 *
 * - `channels.purpose TEXT`: 자유 텍스트 (사용자 작성 채널 목적). nullable.
 *
 * - `channels.handoff_mode TEXT NOT NULL DEFAULT 'check'`: 부서 인계 직전
 *   사용자 confirm 모드. 'check' (디폴트, 사용자 confirm 모달) | 'auto' (자동
 *   인계). R7 ApprovalService 와 별개 — R7 = 파일 적용 gate, handoff_mode =
 *   부서 인계 gate.
 *
 * - `channel_members.drag_order INTEGER`: 참여 멤버 발화 순서. 사용자가 우측
 *   사이드 패널에서 드래그하면 update. NULL = 미설정 (designated worker 디폴트
 *   알고리즘이 fallback 처리).
 *
 * - `providers.is_department_head TEXT NOT NULL DEFAULT '{}'`: 부서장 핀
 *   JSON. `Record<RoleId, boolean>` 직렬화. designated worker 디폴트 1순위.
 *
 * - system_general 전역화: 기존 프로젝트 종속 system_general row 들을
 *   가장 오래된 1개 (project_id NULL) 만 보존, 나머지 DELETE. R12-C 결정 —
 *   일반 채널은 프로젝트 외부 전역 1개. 채널 멤버 / 메시지는 FK CASCADE 로
 *   자동 정리.
 *
 * SQLite 의 ALTER TABLE ADD COLUMN 은 IF NOT EXISTS 미지원 — chain-level
 * idempotency (migrator tracking 표) 만 보장.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '018-channels-role-purpose-handoff',
  sql: `
ALTER TABLE channels ADD COLUMN role TEXT;
ALTER TABLE channels ADD COLUMN purpose TEXT;
ALTER TABLE channels ADD COLUMN handoff_mode TEXT NOT NULL DEFAULT 'check';

ALTER TABLE channel_members ADD COLUMN drag_order INTEGER;

ALTER TABLE providers ADD COLUMN is_department_head TEXT NOT NULL DEFAULT '{}';

-- system_general 전역화: 가장 오래된 1개만 project_id NULL 로 update
UPDATE channels
   SET project_id = NULL
 WHERE kind = 'system_general'
   AND id = (SELECT id FROM channels WHERE kind = 'system_general' ORDER BY created_at ASC LIMIT 1);

-- 나머지 system_general (project_id NOT NULL 인 것들) DELETE
-- channel_members / messages 등 FK CASCADE 로 자동 정리
DELETE FROM channels WHERE kind = 'system_general' AND project_id IS NOT NULL;
`,
};
