/** Projectless chat rooms, frozen participant personas, and CLI checkpoints. */
import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '030-chat-rooms',
  sql: `
CREATE TABLE chat_rooms (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

-- Separate from channel_members: its legacy null-project unique index permits
-- only one membership per provider, while rooms need many.
CREATE TABLE chat_room_members (
  channel_id TEXT NOT NULL REFERENCES chat_rooms(channel_id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  persona_source TEXT NOT NULL CHECK(persona_source IN ('default','custom')),
  role TEXT NOT NULL,
  personality TEXT NOT NULL,
  expertise TEXT NOT NULL,
  legacy_persona TEXT NOT NULL,
  effective_persona TEXT NOT NULL,
  PRIMARY KEY (channel_id, provider_id),
  UNIQUE (channel_id, sort_order)
);

CREATE TABLE cli_chat_sessions (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  last_message_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, provider_id)
);
`,
};
