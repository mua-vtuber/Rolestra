/**
 * Migration 012-circuit-breaker-state — R10-Task9.
 *
 * Adds the `circuit_breaker_state` table that backs
 * {@link CircuitBreakerStore} (`src/main/queue/circuit-breaker-store.ts`).
 * The four tripwire counters (`files_per_turn`, `cumulative_cli_ms`,
 * `queue_streak`, `same_error`) — previously kept only in the
 * `CircuitBreaker` instance's memory — now persist per project so a
 * restart no longer drops the counter state mid-streak.
 *
 * Design (spec §10 Task 9 + Decision Log D10):
 * - PRIMARY KEY `(project_id, tripwire)` — at most 4 rows per project.
 * - `last_reset_at` is nullable: a fresh row that has never been reset
 *   carries `NULL` (the in-memory `CircuitBreaker` treats this the same
 *   as the construction-time zero state).
 * - All `CREATE` statements use `IF NOT EXISTS` so a re-run of this
 *   single migration is a no-op even outside the migrator's
 *   already-applied skip (defence-in-depth — D10 sells this as the only
 *   forward-only addition R10 ships).
 * - No FK to `projects(id)`. The store seeds rows on demand via
 *   `flush()` UPSERT and `reset()` UPSERT, never as a side effect of
 *   project creation, so a stale `project_id` in the row set is benign
 *   (the next hydrate simply ignores rows the in-memory map does not
 *   reference). Project deletion cleanup is left to a future GC task —
 *   it is safer to leak 4 rows than to chain a CASCADE on a table
 *   neither the projects nor the channels module references.
 *
 * Migration files are immutable once applied (CLAUDE.md rule 7).
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '012-circuit-breaker-state',
  sql: `
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  project_id TEXT NOT NULL,
  tripwire TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  last_reset_at INTEGER,
  last_updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, tripwire)
);
CREATE INDEX IF NOT EXISTS idx_cbs_project ON circuit_breaker_state(project_id);
`,
};
