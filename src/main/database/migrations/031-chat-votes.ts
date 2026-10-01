import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '031-chat-votes',
  sql: `
CREATE TABLE chat_votes (
  id TEXT PRIMARY KEY,
  opinion_id TEXT NOT NULL UNIQUE REFERENCES opinion(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX chat_votes_one_running_per_channel
  ON chat_votes(channel_id) WHERE status = 'running';
CREATE TABLE chat_vote_participants (
  vote_id TEXT NOT NULL REFERENCES chat_votes(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  persona TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','submitted','failed')),
  opinion TEXT,
  vote TEXT CHECK(vote IN ('agree','oppose','abstain')),
  error TEXT CHECK(error IN ('provider_unavailable','invalid_response','provider_error','timeout','interrupted')),
  PRIMARY KEY(vote_id, provider_id),
  UNIQUE(vote_id, sort_order)
);
`,
};
