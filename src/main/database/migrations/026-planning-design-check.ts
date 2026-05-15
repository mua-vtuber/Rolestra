/**
 * Migration 026-planning-design-check — R12-C2 4차 디자인 -> 기획 검수.
 *
 * 기획 검수는 사용자 공식 회의록 승인/반려가 아니므로 meeting_review_gate 와
 * 분리한다. 이 테이블은 디자인 검수 요청서, 기획 검수 결과, 되돌림 횟수,
 * 구현/디자인 되돌림 의뢰서 id 를 한 곳에 보존한다.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '026-planning-design-check',
  sql: `
CREATE TABLE planning_design_check (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_design_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  design_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  design_channel_role TEXT NOT NULL,
  planning_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  implementation_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  request_title TEXT NOT NULL,
  request_body TEXT NOT NULL,
  final_design_minutes_path TEXT NOT NULL,
  final_design_minutes_body TEXT NOT NULL,
  snapshot_desktop_path TEXT,
  snapshot_mobile_path TEXT,
  wireframe_checkpoints_json TEXT NOT NULL,
  wireframe_user_notes_json TEXT NOT NULL,
  return_count INTEGER NOT NULL DEFAULT 0 CHECK(return_count >= 0),
  verdict TEXT CHECK(verdict IN ('aligned', 'misaligned', 'needs_user_decision')),
  status TEXT NOT NULL CHECK(status IN (
    'request_created',
    'aligned',
    'returned_to_design',
    'needs_user_decision'
  )),
  reason TEXT,
  revision_direction TEXT,
  implementation_dispatch_id TEXT,
  design_return_dispatch_id TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX idx_planning_design_check_project_status
  ON planning_design_check(project_id, status, created_at);
CREATE INDEX idx_planning_design_check_design_meeting
  ON planning_design_check(source_design_meeting_id);
CREATE INDEX idx_planning_design_check_return_scope
  ON planning_design_check(project_id, design_channel_id, planning_channel_id, status);
`,
};
