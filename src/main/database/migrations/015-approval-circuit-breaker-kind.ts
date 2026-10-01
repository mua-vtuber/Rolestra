/**
 * Migration 015-approval-circuit-breaker-kind — production bug fix.
 *
 * The R11-Task4 work added `kind='circuit_breaker'` to the
 * `ApprovalKind` union (`src/shared/approval-types.ts`) and to the
 * production-side breaker handler (`src/main/engine/v3-side-effects.ts
 * handleBreakerFired` line 329) but never relaxed the matching DB
 * CHECK constraint introduced in 006-approval-inbox. The result is
 * that whenever a Circuit Breaker tripwire fires in production, the
 * audit row insert silently fails with `SQLITE_CONSTRAINT_CHECK` —
 * the breaker still downgrades autonomy to manual (the side-effect
 * chain swallows the throw and continues), but the audit trail loses
 * the row. The Playwright autonomy-queue spec exposes this because
 * the dev hook (`dev:trip-circuit-breaker`) fails loudly with the
 * same constraint error before the spec ever observes the downgrade.
 *
 * SQLite cannot drop or alter a single CHECK constraint in place, so
 * we follow the canonical "rebuild and copy" pattern (same approach
 * used in any forward-only migration that needs to widen a constraint).
 * The new table carries the same primary key + foreign keys + indexes;
 * only the `kind` CHECK list is widened.
 *
 * Migration files are immutable once applied (CLAUDE.md rule 7).
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '015-approval-circuit-breaker-kind',
  sql: `
-- 1. Build the new table alongside the existing one. CHECK list now
--    includes 'circuit_breaker' so handleBreakerFired's audit insert
--    succeeds.
CREATE TABLE approval_items_v2 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('cli_permission','mode_transition','consensus_decision','review_outcome','failure_report','circuit_breaker')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  requester_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','superseded')),
  decision_comment TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER DEFAULT NULL
);

-- 2. Move existing rows over verbatim. The old CHECK list is a strict
--    subset of the new one so every existing row passes.
INSERT INTO approval_items_v2
  (id, kind, project_id, channel_id, meeting_id, requester_id,
   payload_json, status, decision_comment, created_at, decided_at)
SELECT
  id, kind, project_id, channel_id, meeting_id, requester_id,
  payload_json, status, decision_comment, created_at, decided_at
FROM approval_items;

-- 3. Drop the old table (and its index — the CREATE INDEX is rebuilt
--    after the rename so we don't depend on cascade behaviour).
DROP INDEX IF EXISTS idx_approval_status;
DROP TABLE approval_items;

-- 4. Rename the new table into place + recreate the index that the
--    inbox listing depends on.
ALTER TABLE approval_items_v2 RENAME TO approval_items;
CREATE INDEX idx_approval_status ON approval_items(status, created_at);
-- Application-level rule still applies: approval_items hard DELETE 금지.
`,
};
