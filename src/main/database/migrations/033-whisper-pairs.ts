import type { Migration } from '../migrator';

/**
 * 2026-09-28 whisper rules: whispers are free, so one user message may start
 * several root whispers. The root limit moves from "one per user message" to
 * "one per user message and sender → recipient pair"; a reply stays limited
 * to one per root (`idx_messages_whisper_reply_root`, unchanged).
 *
 * The root index keeps its 032 name and is recreated right away with the
 * pair columns, so no named schema object disappears (forward-only, see
 * tools/inspectors/mig-non-forward-only.ts). Every row valid under 032
 * already has at most one root per user message, so it is also unique per
 * pair and the new index builds on existing data. The 032 insert trigger
 * checks each row's own fields only and needs no change.
 */
export const migration: Migration = {
  id: '033-whisper-pairs',
  sql: `
DROP INDEX idx_messages_whisper_root_source;
CREATE UNIQUE INDEX idx_messages_whisper_root_source
  ON messages(whisper_source_message_id, author_id, whisper_recipient_id)
  WHERE visibility = 'whisper' AND whisper_reply_to_message_id IS NULL;
`,
};
