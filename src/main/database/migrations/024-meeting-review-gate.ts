/**
 * Migration 024-meeting-review-gate — R12-C2 기획 회의록 검토 gate.
 *
 * 회의록 검토는 handoff_dispatch 와 역할이 다르다. handoff_dispatch 는 이미
 * 보낸 외주 의뢰서이고, meeting_review_gate 는 사용자가 공식 문서를 읽고
 * 승인 / 반려 / 중지를 결정하기 전의 대기 상태다.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '024-meeting-review-gate',
  sql: `
CREATE TABLE meeting_review_gate (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  target_role TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('planning_minutes')),
  status TEXT NOT NULL CHECK(status IN (
    'pending',
    'approved',
    'revision_requested',
    'restart_requested',
    'stopped'
  )),
  title TEXT NOT NULL,
  document_path TEXT NOT NULL,
  document_body_snapshot TEXT NOT NULL,
  user_note TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX idx_meeting_review_gate_project_status
  ON meeting_review_gate(project_id, status, created_at);
CREATE INDEX idx_meeting_review_gate_meeting
  ON meeting_review_gate(meeting_id);
`,
};
