/**
 * Migration 035-whisper-threads — spec `docs/specs/2026-10-01-chat-silence-and-whisper-threads.md` F2-6.
 *
 * A whisper thread is the root whisper (A→B) plus up to three alternating
 * replies (B→A, A→B, B→A). Until now the DB allowed exactly one reply per
 * root (032 `idx_messages_whisper_reply_root`, 032 insert trigger).
 *
 * 1. `messages.whisper_thread_seq` — the row's position in its thread: the
 *    root is 1, replies are 2, 3, 4. Public rows keep NULL.
 * 2. Backfill: every existing root becomes 1, every existing reply 2 (032/033
 *    allowed only one reply per root, so each was the second message).
 *    `whisper_reply_to_message_id` keeps its meaning: it points at the
 *    thread's root, for every reply position.
 * 3. `idx_messages_whisper_reply_root` becomes unique per (root, position).
 * 4. The 032 insert trigger `messages_whisper_insert_check` is replaced. It
 *    required every reply to go from the root recipient back to the root
 *    sender, which would reject position 3 (the root sender answering), so
 *    it cannot stay beside a new trigger. The new one keeps every 032 check
 *    and adds: a whisper has a position; a root is position 1; a reply is
 *    position 2..4 between the root pair, with the direction set by parity
 *    (even = the root recipient sends, odd = the root sender sends); the
 *    previous position of the thread exists; a public row has no position.
 *
 * Both named objects are dropped and recreated under their 032 names in this
 * same migration, so no named schema object disappears (forward-only, see
 * tools/inspectors/mig-non-forward-only.ts; SQLite has no CREATE OR REPLACE
 * for either). Re-running is safe: the migrator records this id in the same
 * transaction and skips it afterwards, and the backfill statement computes
 * each value from the row's own reply pointer only, so running it again
 * gives the same result (`migration-035-whisper-threads.test.ts`). A
 * failure aborts the transaction and blocks startup (migrator rule).
 */
import type { Migration } from '../migrator';

/**
 * Highest thread position the DB accepts. Same value as
 * `CHAT_WHISPER_THREAD_MAX_MESSAGES` in `src/main/channels/chat-limits.ts`
 * (root included). Written here as a literal on purpose: an applied
 * migration must never change, so it cannot follow a later edit of the app
 * constant; the migration test pins the two together.
 */
const WHISPER_THREAD_MAX_SEQ = 4;

/** Root = 1, reply = 2 for every whisper written before threads existed. */
export const WHISPER_THREAD_SEQ_BACKFILL_SQL = `
UPDATE messages
   SET whisper_thread_seq = CASE WHEN whisper_reply_to_message_id IS NULL THEN 1 ELSE 2 END
 WHERE visibility = 'whisper';
`;

export const migration: Migration = {
  id: '035-whisper-threads',
  sql: `
ALTER TABLE messages ADD COLUMN whisper_thread_seq INTEGER;

${WHISPER_THREAD_SEQ_BACKFILL_SQL}

DROP INDEX idx_messages_whisper_reply_root;
CREATE UNIQUE INDEX idx_messages_whisper_reply_root
  ON messages(whisper_reply_to_message_id, whisper_thread_seq)
  WHERE visibility = 'whisper' AND whisper_reply_to_message_id IS NOT NULL;

DROP TRIGGER messages_whisper_insert_check;
CREATE TRIGGER messages_whisper_insert_check BEFORE INSERT ON messages BEGIN
  SELECT CASE
    WHEN NEW.visibility = 'whisper' AND (
      NEW.author_kind != 'member' OR NEW.role != 'assistant' OR
      NEW.whisper_recipient_id IS NULL OR NEW.whisper_recipient_id = '' OR
      NEW.author_id = NEW.whisper_recipient_id OR
      NEW.whisper_sender_name IS NULL OR NEW.whisper_sender_name = '' OR
      NEW.whisper_recipient_name IS NULL OR NEW.whisper_recipient_name = '' OR
      NEW.whisper_source_message_id IS NULL OR NEW.whisper_source_message_id = '' OR
      NOT EXISTS (SELECT 1 FROM messages source
        WHERE source.id = NEW.whisper_source_message_id
          AND source.channel_id = NEW.channel_id
          AND source.author_kind = 'user' AND source.role = 'user'
          AND source.visibility = 'public') OR
      NEW.whisper_thread_seq IS NULL OR
      NEW.whisper_thread_seq != CAST(NEW.whisper_thread_seq AS INTEGER) OR
      (NEW.whisper_reply_to_message_id IS NULL AND NEW.whisper_thread_seq != 1)
    ) THEN RAISE(ABORT, 'invalid whisper')
    WHEN NEW.visibility = 'public' AND (
      NEW.whisper_recipient_id IS NOT NULL OR NEW.whisper_sender_name IS NOT NULL OR
      NEW.whisper_recipient_name IS NOT NULL OR NEW.whisper_source_message_id IS NOT NULL OR
      NEW.whisper_reply_to_message_id IS NOT NULL OR NEW.whisper_thread_seq IS NOT NULL
    ) THEN RAISE(ABORT, 'public message has whisper metadata')
    WHEN NEW.visibility = 'whisper' AND NEW.whisper_reply_to_message_id IS NOT NULL AND (
      NEW.whisper_thread_seq < 2 OR NEW.whisper_thread_seq > ${WHISPER_THREAD_MAX_SEQ} OR
      NOT EXISTS (SELECT 1 FROM messages root
        WHERE root.id = NEW.whisper_reply_to_message_id
          AND root.channel_id = NEW.channel_id
          AND root.visibility = 'whisper'
          AND root.whisper_reply_to_message_id IS NULL
          AND root.whisper_source_message_id = NEW.whisper_source_message_id
          AND (
            (NEW.whisper_thread_seq % 2 = 0
              AND root.author_id = NEW.whisper_recipient_id
              AND root.whisper_recipient_id = NEW.author_id) OR
            (NEW.whisper_thread_seq % 2 = 1
              AND root.author_id = NEW.author_id
              AND root.whisper_recipient_id = NEW.whisper_recipient_id))) OR
      (NEW.whisper_thread_seq > 2 AND NOT EXISTS (SELECT 1 FROM messages previous
        WHERE previous.visibility = 'whisper'
          AND previous.whisper_reply_to_message_id = NEW.whisper_reply_to_message_id
          AND previous.whisper_thread_seq = NEW.whisper_thread_seq - 1))
    ) THEN RAISE(ABORT, 'invalid whisper reply')
  END;
END;
`,
};
