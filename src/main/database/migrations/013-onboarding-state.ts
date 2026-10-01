/**
 * Migration 013-onboarding-state — R11-Task6 (Decision D3).
 *
 * Adds the `onboarding_state` single-row table that backs the
 * {@link OnboardingService} (`src/main/onboarding/onboarding-service.ts`).
 * The first-boot 5-step wizard (office / staff / roles / permissions /
 * firstProject) needs durable state so a window close mid-wizard does
 * not throw the user back into the welcome screen — the renderer reads
 * `onboarding:get-state` on mount and resumes at `currentStep`.
 *
 * Design (spec §10 Task 6 + Decision Log D3 + D6):
 * - Single row enforced by `CHECK (id = 1)` + PRIMARY KEY on `id`.
 *   The repository's INSERT path always uses `id = 1`, the UPDATE path
 *   always WHERE-clauses on `id = 1`, so a runaway second row is
 *   impossible without going around the schema. Mirrors the
 *   `circuit_breaker_state` (012) "PK is structural, not synthetic"
 *   approach but with a stricter cardinality.
 * - `selections_json` is TEXT (JSON1 not required by the readers — the
 *   service `JSON.parse`s on read and `JSON.stringify`s on write so the
 *   renderer can keep working with structured `OnboardingSelections`).
 *   We deliberately do NOT split selections across columns: step 3/4/5
 *   payloads are heterogeneous and a future step would either force a
 *   schema migration or a sparse-column nullable mess. The string blob
 *   is bounded by the zod `onboarding:set-state` schema (max 64 staff
 *   ids × 200-char role labels) so a malicious renderer cannot bloat
 *   the row.
 * - `completed` is a strict `0|1` integer. Once flipped to `1` the row
 *   never reverts via the same channel — `AboutTab` "Restart onboarding"
 *   must call `onboarding:set-state` with `{completed:false,
 *   currentStep:1, selections:{}}` to start over (handler enforces this
 *   semantic; complete() one-way only via `onboarding:complete`).
 * - `current_step` is an INTEGER restricted to 1..5 by CHECK so a
 *   bypass via raw SQL still cannot land an out-of-range step. The
 *   shared `OnboardingStep` literal union mirrors this range; CHECK is
 *   defence-in-depth.
 * - `updated_at` is the millisecond Date.now(), same convention as the
 *   other v3 tables. The service writes it on every mutation so the UI
 *   can show "last edited 5m ago" if we ever want it without another
 *   migration.
 * - `IF NOT EXISTS` on the CREATE so a manual migration re-run is a
 *   no-op even outside the migrator's already-applied skip (D10
 *   defence-in-depth, mirrors 012).
 *
 * Migration files are immutable once applied (CLAUDE.md rule 7).
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '013-onboarding-state',
  sql: `
CREATE TABLE IF NOT EXISTS onboarding_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  selections_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
`,
};
