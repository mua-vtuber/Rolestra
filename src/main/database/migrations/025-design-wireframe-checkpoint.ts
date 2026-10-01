/**
 * Migration 025-design-wireframe-checkpoint — R12-C2 3차 디자인 와이어프레임
 * 가벼운 확인.
 *
 * 공식 회의록 승인/반려가 아니므로 meeting_review_gate 와 분리한다.
 * 체크포인트는 디자인 중간 산출물에 대한 사용자 개입 기록이며, 4차의
 * 디자인 -> 기획 검수 요청서가 user_note 를 읽어 포함할 수 있다.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '025-design-wireframe-checkpoint',
  sql: `
CREATE TABLE design_checkpoint (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('wireframe')),
  status TEXT NOT NULL CHECK(status IN (
    'pending',
    'continued',
    'revision_requested',
    'auto_skipped'
  )),
  title TEXT NOT NULL,
  document_path TEXT NOT NULL,
  document_body_snapshot TEXT NOT NULL,
  user_note TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX idx_design_checkpoint_project_meeting
  ON design_checkpoint(project_id, meeting_id, created_at);
CREATE INDEX idx_design_checkpoint_status
  ON design_checkpoint(project_id, status, created_at);

CREATE TABLE design_checkpoint_preference (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  wireframe_auto_skip INTEGER NOT NULL DEFAULT 0 CHECK(wireframe_auto_skip IN (0, 1)),
  updated_at INTEGER NOT NULL
);
`,
};
