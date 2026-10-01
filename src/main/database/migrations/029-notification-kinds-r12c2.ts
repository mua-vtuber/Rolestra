/**
 * Migration 029-notification-kinds-r12c2 — notification_prefs CHECK 확장.
 *
 * 011-notifications 가 만든 `notification_prefs.key` 컬럼에는 알림 종류
 * 여섯 개만 허용하는 CHECK 가 걸려 있다. R12-C2 가 세 종류를 더한다:
 *
 *   handoff_auto_review  검토 부서가 끝나 리뷰 부서를 시작할 수 있을 때 (T30)
 *   queue_item_started   대기열이 다음 작업을 시작했을 때 (T34)
 *   audit_result         검토 결과가 나왔을 때 — 승인 대기 또는 기획 반려 (T34)
 *
 * CHECK 를 늘리지 않으면 새 종류의 pref row insert 가
 * SQLITE_CONSTRAINT_CHECK 로 실패하고, 사용자는 설정 화면에서 그 알림을
 * 켜거나 끌 수 없게 된다.
 *
 * SQLite 는 CHECK 하나만 바꾸는 명령이 없어서, 015-approval-circuit-breaker-kind
 * 가 쓴 "새 표를 만들고 옮겨 담고 바꿔치기" 방식을 그대로 따른다. 기존
 * CHECK 목록은 새 목록의 부분집합이라 모든 기존 row 가 그대로 통과한다.
 * 사용자가 꺼 둔 알림 설정도 값 그대로 옮겨진다.
 *
 * notification_log 는 손대지 않는다 — 그 표의 kind 컬럼에는 CHECK 가 없다.
 *
 * Migration files are immutable once applied (CLAUDE.md rule 7).
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '029-notification-kinds-r12c2',
  sql: `
-- 1. 넓힌 CHECK 로 새 표를 만든다. 컬럼 구성과 기본값은 011 과 동일.
CREATE TABLE notification_prefs_v2 (
  key TEXT PRIMARY KEY CHECK(key IN ('new_message','approval_pending','work_done','error','queue_progress','meeting_state','handoff_auto_review','queue_item_started','audit_result')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1
);

-- 2. 기존 row 를 값 그대로 옮긴다. 사용자가 꺼 둔 알림은 꺼진 채로 남는다.
INSERT INTO notification_prefs_v2 (key, enabled, sound_enabled)
SELECT key, enabled, sound_enabled FROM notification_prefs;

-- 3. 옛 표를 버리고 새 표를 그 이름으로 바꾼다.
DROP TABLE notification_prefs;
ALTER TABLE notification_prefs_v2 RENAME TO notification_prefs;
`,
};
