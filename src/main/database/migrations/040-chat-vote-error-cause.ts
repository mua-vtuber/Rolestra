import type { Migration } from '../migrator';

/**
 * Why a vote participant's `provider_error` failure happened (spec 2026-10-08
 * F3). `error_cause` holds a `ProviderFailureCause` code and `error_detail` a
 * short app-made marker (`HTTP 503`, `claude`); existing rows keep NULL in
 * both (cause unknown).
 *
 * No CHECK constraint: the cause list grows over time and a CHECK would mean
 * rebuilding the table each time. `chat-vote-repository.ts` checks the value
 * on write and throws on an unknown value when reading.
 *
 * Like 032, `ALTER TABLE ADD COLUMN` fails when run twice; the migrator skips
 * an applied id, so that never happens.
 */
export const migration: Migration = {
  id: '040-chat-vote-error-cause',
  sql: `
ALTER TABLE chat_vote_participants ADD COLUMN error_cause TEXT;
ALTER TABLE chat_vote_participants ADD COLUMN error_detail TEXT;
`,
};
