/**
 * Migration 014-llm-cost-audit-log — R11-Task8 (Decision D4 + D5).
 *
 * Adds the append-only `llm_cost_audit_log` table that backs the
 * {@link LlmCostRepository} (`src/main/llm/llm-cost-repository.ts`).
 * Every successful summarize-capability provider call inside
 * {@link MeetingSummaryService} writes one row so the Settings tab can
 * render a "누적 토큰 + 추정 비용" card without re-walking provider logs.
 *
 * Design (spec §10 Task 8 + Decision Log D4 + D5 + R11 D7 종결 첫 항목):
 * - Append-only. The repository never updates or deletes a row — the
 *   only writer is `INSERT`. Removing rows is left to a future GC task
 *   (Settings UI will show the rolling 30-day window so older rows
 *   become irrelevant on their own; deletion can be a no-op until the
 *   table grows past a meaningful size, which a single chat session is
 *   unlikely to do).
 * - `id INTEGER PRIMARY KEY AUTOINCREMENT` — monotonic so the ordering
 *   reflects real chronological order even if `created_at` ties.
 * - `meeting_id` is nullable. The summarize call site lives inside
 *   `MeetingOrchestrator.postMinutes` so the meeting id is always known
 *   in production, but the column stays nullable so a future caller
 *   (smoke / classifier / probe) can write rows without faking an id.
 * - `provider_id TEXT NOT NULL` — the BaseProvider id (registry key).
 *   We do NOT add an FK — provider rows live in `providers` but the
 *   registry can also have ephemeral instances (CLI re-detection, smoke
 *   probes), and a stale row pointing at a removed provider is benign
 *   (the Settings card just labels it `provider_id`).
 * - `token_in` / `token_out` are NOT NULL with a CHECK >= 0 — providers
 *   that fail to report usage MUST NOT poison the audit log. The
 *   `MeetingSummaryService` extracts these from `consumeLastTokenUsage()`
 *   and skips the append entirely when both are 0 so the table doesn't
 *   accumulate noise rows.
 * - `created_at INTEGER NOT NULL` — millisecond Date.now(), same
 *   convention as `circuit_breaker_state` (012) and `onboarding_state`
 *   (013).
 * - Two indexes for the only two queries the repository runs:
 *   - `idx_llm_cost_audit_provider` on (provider_id, created_at) for
 *     the per-provider rolling window aggregation that powers the
 *     Settings card byProvider list.
 *   - `idx_llm_cost_audit_meeting` on (meeting_id) so a future
 *     "회의별 비용" drill-down can stay O(rows-for-meeting) instead of
 *     scanning the table.
 * - `IF NOT EXISTS` on the CREATE statements so a manual migration
 *   re-run is a no-op even outside the migrator's already-applied skip
 *   (defence-in-depth, mirrors 012 + 013 — D10's "single forward-only
 *   addition" pattern carries forward).
 *
 * Migration files are immutable once applied (CLAUDE.md rule 7).
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '014-llm-cost-audit-log',
  sql: `
CREATE TABLE IF NOT EXISTS llm_cost_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT,
  provider_id TEXT NOT NULL,
  token_in INTEGER NOT NULL DEFAULT 0 CHECK (token_in >= 0),
  token_out INTEGER NOT NULL DEFAULT 0 CHECK (token_out >= 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_cost_audit_provider
  ON llm_cost_audit_log(provider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_cost_audit_meeting
  ON llm_cost_audit_log(meeting_id);
`,
};
