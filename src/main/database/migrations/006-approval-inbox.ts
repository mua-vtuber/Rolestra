/**
 * Migration 006-approval-inbox: approval_items (approval inbox records).
 *
 * Depends on 002-projects, 003-channels, 004-meetings. Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (006_approval_inbox.sql).
 *
 * Key invariants:
 * - All parent FKs use ON DELETE SET NULL so deleting a project/channel/meeting
 *   does NOT erase the audit trail (CB-7: "감사 유실 방지").
 * - Application-level rule (not enforced in DDL): approval_items must never be
 *   hard-deleted; closing an item means setting status='superseded' or 'expired'.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '006-approval-inbox',
  sql: `
-- 감사 유실 방지 (CB-7): 부모 삭제 시 레코드 보존, 하드 DELETE 금지
CREATE TABLE approval_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('cli_permission','mode_transition','consensus_decision','review_outcome','failure_report')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  requester_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','superseded')),
  decision_comment TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER DEFAULT NULL
);
CREATE INDEX idx_approval_status ON approval_items(status, created_at);
-- 애플리케이션 레벨 규칙: approval_items는 hard DELETE 금지. status='superseded'/'expired'로만 종료.
`,
};
