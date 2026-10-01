/**
 * Migration 007-queue: queue_items (autonomy queue per project, CD-2).
 *
 * Depends on 002-projects, 003-channels, 004-meetings. Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (007_queue.sql).
 *
 * Key invariants:
 * - FK on project_id is CASCADE (queue is fully owned by the project).
 * - FKs on target_channel_id and started_meeting_id are SET NULL because the
 *   queue item itself is the historical record — the originating channel or
 *   meeting may be deleted without destroying the queue history.
 * - order_index is NOT part of any unique constraint: duplicates within the
 *   same project are allowed (sparse reordering strategy: 1000/2000/3000).
 *
 * Recovery rule (application-level): on startup, any `status='in_progress'`
 * item is reverted to 'pending' and surfaced to the user.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '007-queue',
  sql: `
CREATE TABLE queue_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,  -- 큐 항목 실행 대상 채널 (기본 #일반)
  order_index INTEGER NOT NULL,                                       -- 정렬용 (소수 간격으로 재정렬 용이: 1000, 2000, 3000)
  prompt TEXT NOT NULL,                                               -- 사용자 입력 원문
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','failed','cancelled','paused')),
  started_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL, -- 실행 중/완료 시 연결된 회의
  started_at INTEGER DEFAULT NULL,
  finished_at INTEGER DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_queue_project_order ON queue_items(project_id, status, order_index);

-- 복구 규칙: 앱 재시작 시 status='in_progress'인 항목은 'pending'으로 되돌리고 사용자에게 안내
-- (연결된 meeting이 살아있으면 이어받기 옵션 제공).
`,
};
