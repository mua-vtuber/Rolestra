/**
 * Migration 016-meeting-paused-and-kind — D-A 메시지 자동 회의 트리거 지원.
 *
 * - `paused_at INTEGER`: 일시정지 시각 (ms epoch). 명시 default 없음 —
 *   SQLite 의 NULLable INTEGER 칼럼은 미설정 시 자동으로 NULL.
 *   NULL = 일시정지 아님. `idx_meetings_active_per_channel` 의 partial
 *   조건 (`ended_at IS NULL`) 은 그대로 — paused 도 active 로 계산되어
 *   채널당 활성 회의 1 개 제약 유지.
 *
 * - `kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','auto'))`:
 *   회의 트리거 종류. 'manual' = 사용자 [회의 시작] 클릭, 'auto' = D-A
 *   메시지 자동 트리거. 동작 분기 안 함, 통계 / debug 용. 기존 행은
 *   기본값 'manual' 로 채워짐.
 *
 * 마이그레이션은 chain-level idempotency 만 보장 (migrator 가
 * `migrations` tracking 표를 보고 이미 적용된 항목을 건너뜀).
 * SQLite 의 `ALTER TABLE ADD COLUMN` 은 IF NOT EXISTS 절을 지원하지
 * 않으므로 SQL 자체를 두 번 실행하면 throw — 정상 동작 (run-twice 는
 * tracking 으로 차단).
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '016-meeting-paused-and-kind',
  sql: `
ALTER TABLE meetings ADD COLUMN paused_at INTEGER;
ALTER TABLE meetings ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','auto'));
`,
};
