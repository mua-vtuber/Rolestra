import type { Migration } from '../migrator';

/** Keep delivery after general-chat history clears, while committing it with the message. */
export const migration: Migration = {
  id: '037-vote-result-message',
  sql: `
CREATE TABLE IF NOT EXISTS chat_vote_result_deliveries (
  vote_id TEXT PRIMARY KEY REFERENCES chat_votes(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE
);

CREATE TRIGGER IF NOT EXISTS messages_vote_result_delivery
AFTER INSERT ON messages
WHEN json_valid(NEW.meta_json) AND json_type(NEW.meta_json, '$.chatVoteResult.voteId') = 'text'
BEGIN
  INSERT INTO chat_vote_result_deliveries (vote_id, message_id)
  SELECT id, NEW.id FROM chat_votes
  WHERE id = json_extract(NEW.meta_json, '$.chatVoteResult.voteId')
    AND channel_id = NEW.channel_id;
END;
`,
};
