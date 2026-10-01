import type { Migration } from '../migrator';

/** Forward-only visibility metadata and durable one-shot user rounds. */
export const migration: Migration = {
  id: '032-whispers',
  sql: `
ALTER TABLE messages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'whisper'));
ALTER TABLE messages ADD COLUMN whisper_recipient_id TEXT;
ALTER TABLE messages ADD COLUMN whisper_sender_name TEXT;
ALTER TABLE messages ADD COLUMN whisper_recipient_name TEXT;
ALTER TABLE messages ADD COLUMN whisper_source_message_id TEXT;
ALTER TABLE messages ADD COLUMN whisper_reply_to_message_id TEXT;

CREATE UNIQUE INDEX idx_messages_whisper_root_source
  ON messages(whisper_source_message_id)
  WHERE visibility = 'whisper' AND whisper_reply_to_message_id IS NULL;
CREATE UNIQUE INDEX idx_messages_whisper_reply_root
  ON messages(whisper_reply_to_message_id)
  WHERE visibility = 'whisper' AND whisper_reply_to_message_id IS NOT NULL;
CREATE INDEX idx_messages_visibility_channel_recipient
  ON messages(channel_id, visibility, whisper_recipient_id);

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
          AND source.visibility = 'public')
    ) THEN RAISE(ABORT, 'invalid whisper')
    WHEN NEW.visibility = 'public' AND (
      NEW.whisper_recipient_id IS NOT NULL OR NEW.whisper_sender_name IS NOT NULL OR
      NEW.whisper_recipient_name IS NOT NULL OR NEW.whisper_source_message_id IS NOT NULL OR
      NEW.whisper_reply_to_message_id IS NOT NULL
    ) THEN RAISE(ABORT, 'public message has whisper metadata')
    WHEN NEW.visibility = 'whisper' AND NEW.whisper_reply_to_message_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM messages root
        WHERE root.id = NEW.whisper_reply_to_message_id
          AND root.channel_id = NEW.channel_id
          AND root.visibility = 'whisper'
          AND root.whisper_reply_to_message_id IS NULL
          AND root.whisper_source_message_id = NEW.whisper_source_message_id
          AND root.author_id = NEW.whisper_recipient_id
          AND root.whisper_recipient_id = NEW.author_id)
      THEN RAISE(ABORT, 'invalid whisper reply')
  END;
END;

CREATE TABLE chat_whisper_rounds (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'finished', 'interrupted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_message_id)
);
`,
};
