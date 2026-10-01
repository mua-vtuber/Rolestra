/**
 * Migration 036-channel-read-state — per-channel read marker for the chat
 * list's unread counts (spec 2026-10-01-messenger-redesign.md R4-1).
 *
 * `channel_read_state.last_read_rowid` is the `messages.rowid` of the newest
 * message the user has seen in that channel. A rowid instead of a time:
 * `messages.rowid` is AUTOINCREMENT (migration 005), so it orders rows
 * exactly even when several share one millisecond, which `created_at`
 * cannot. A channel without a row has read nothing yet (the unread query
 * reads a missing marker as 0).
 *
 * `idx_messages_channel_unread (channel_id, author_kind, role)` serves the
 * unread count "AI messages after the marker": with the three columns fixed
 * by equality, index entries are ordered by rowid, so `rowid > marker` is a
 * range scan over the unread rows only (`channel-summary-repository.ts`).
 *
 * Backfill: messages stored before unread tracking existed count as read.
 * Every channel that already has messages gets a marker at its newest
 * message, so the first launch after this migration shows 0 unread instead
 * of the whole history. A channel with no messages gets no row; its first
 * AI message later counts as unread. Message rows whose channel no longer
 * exists (only possible in a database once written with foreign keys off)
 * are skipped — a marker for them would break the foreign key and block
 * startup.
 *
 * Idempotent: the table and index use IF NOT EXISTS, and the backfill is
 * INSERT OR IGNORE, so running the SQL again never changes or lowers an
 * existing marker (the runner also skips applied ids). Forward-only: no
 * existing table or row is changed.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '036-channel-read-state',
  sql: `
CREATE TABLE IF NOT EXISTS channel_read_state (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  last_read_rowid INTEGER NOT NULL CHECK (last_read_rowid >= 0)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_unread
  ON messages(channel_id, author_kind, role);

INSERT OR IGNORE INTO channel_read_state (channel_id, last_read_rowid)
SELECT m.channel_id, MAX(m.rowid)
  FROM messages m
 WHERE EXISTS (SELECT 1 FROM channels c WHERE c.id = m.channel_id)
 GROUP BY m.channel_id;
`,
};
