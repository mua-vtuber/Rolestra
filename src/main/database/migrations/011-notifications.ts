/**
 * Migration 011-notifications: notification_prefs + notification_log.
 *
 * Copied verbatim from spec
 * `docs/superpowers/specs/2026-04-18-rolestra-design.md` §5.2 011_notifications.sql
 * (lines 446-463).
 *
 * Tables:
 * - notification_prefs — per-kind on/off + sound flag. PK is the kind name,
 *   constrained to the six kinds listed in spec (new_message,
 *   approval_pending, work_done, error, queue_progress, meeting_state).
 * - notification_log   — append-only history of fired notifications.
 *   `channel_id` references `channels(id)` ON DELETE SET NULL so the log
 *   row survives channel deletion (audit preservation per §12 Security).
 *
 * Depends on 003-channels (for the channel_id FK target).
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '011-notifications',
  sql: `
CREATE TABLE notification_prefs (
  key TEXT PRIMARY KEY CHECK(key IN ('new_message','approval_pending','work_done','error','queue_progress','meeting_state')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  clicked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`,
};
