/**
 * Migration 004-meetings: meetings.
 *
 * Depends on 003-channels. Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (004_meetings.sql).
 *
 * Includes:
 * - Partial unique index idx_meetings_active_per_channel enforcing
 *   at most one active (ended_at IS NULL) meeting per channel.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '004-meetings',
  sql: `
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic TEXT DEFAULT '',
  state TEXT NOT NULL,
  state_snapshot_json TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER DEFAULT NULL,
  outcome TEXT DEFAULT NULL CHECK(outcome IN ('accepted','rejected','aborted') OR outcome IS NULL)
);

CREATE INDEX idx_meetings_channel ON meetings(channel_id);
-- 1채널 1활성회의 (ended_at IS NULL인 레코드는 channel_id당 최대 1개)
CREATE UNIQUE INDEX idx_meetings_active_per_channel
  ON meetings(channel_id) WHERE ended_at IS NULL;
`,
};
