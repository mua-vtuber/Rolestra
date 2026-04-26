/**
 * OnboardingStateRepository — R11-Task6.
 *
 * Single-row persistence layer for the wizard state. Backs the
 * `onboarding_state` table shipped by migration 013 (single row enforced
 * via `CHECK (id = 1)`). The repository never decides defaults — it
 * returns `null` when the row is absent so {@link OnboardingService} can
 * surface the canonical first-boot default to the renderer.
 *
 * Why a separate repository when the table is one row:
 *   - Keeps the JSON serialisation (selections_json) at the SQL boundary.
 *     The service layer only ever sees structured `OnboardingSelections`.
 *   - Centralises CHECK-constraint awareness so a future schema change
 *     (extra column / version field) does not leak into the IPC handler.
 *   - Mirrors the `circuit-breaker-store.ts` shape so reviewers do not
 *     have to context-switch between two persistence dialects.
 *
 * Storage:
 *   - INSERT path uses `INSERT OR REPLACE INTO onboarding_state (id=1,...)`
 *     which both seeds the row on first call and overwrites it on
 *     subsequent calls. The CHECK on `id` rejects any other value at the
 *     SQL layer.
 *   - The `selections_json` blob is parsed eagerly on read; a malformed
 *     JSON body throws a structured error so the boot path notices an
 *     external write rather than silently dropping wizard state.
 *
 * Time:
 *   - The service supplies `updatedAt` (Date.now()) — the repository
 *     never touches the system clock so unit tests can drive deterministic
 *     timestamps via `vi.useFakeTimers`.
 */

import type Database from 'better-sqlite3';
import type {
  OnboardingSelections,
  OnboardingState,
  OnboardingStep,
} from '../../shared/onboarding-types';

/** Internal raw row shape — mirrors migration 013. */
interface OnboardingStateRow {
  id: number;
  completed: number;
  current_step: number;
  selections_json: string;
  updated_at: number;
}

/** Thrown when the persisted `selections_json` blob fails JSON.parse. */
export class OnboardingStateCorruptError extends Error {
  constructor(reason: string) {
    super(`onboarding_state.selections_json corrupt: ${reason}`);
    this.name = 'OnboardingStateCorruptError';
  }
}

/**
 * Defensive narrowing for the persisted current_step value. Migration 013
 * already enforces 1..5 via CHECK, but a future schema relax would silently
 * widen the type — clamp here so the service never returns 0 / 6.
 */
function narrowStep(raw: number): OnboardingStep {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) {
    return raw;
  }
  return 1;
}

export class OnboardingStateRepository {
  private readonly selectStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.selectStmt = db.prepare(
      `SELECT id, completed, current_step, selections_json, updated_at
         FROM onboarding_state
        WHERE id = 1`,
    );
    this.upsertStmt = db.prepare(
      `INSERT OR REPLACE INTO onboarding_state
         (id, completed, current_step, selections_json, updated_at)
         VALUES (1, @completed, @current_step, @selections_json, @updated_at)`,
    );
  }

  /**
   * Read the persisted row. Returns `null` when the table is empty
   * (first boot) — the service decides the default to surface.
   */
  read(): OnboardingState | null {
    const row = this.selectStmt.get() as OnboardingStateRow | undefined;
    if (!row) return null;

    let selections: OnboardingSelections;
    try {
      const parsed = JSON.parse(row.selections_json) as unknown;
      // The blob must be a JSON object — array / scalar would mean an
      // external writer corrupted the row. We surface this loudly.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new OnboardingStateCorruptError('not an object');
      }
      selections = parsed as OnboardingSelections;
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : `unknown (${String(err)})`;
      throw new OnboardingStateCorruptError(reason);
    }

    return {
      completed: row.completed === 1,
      currentStep: narrowStep(row.current_step),
      selections,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Persist the supplied state. Always writes id=1; the CHECK guarantees
   * single-row semantics regardless of caller intent.
   */
  write(state: OnboardingState): void {
    this.upsertStmt.run({
      completed: state.completed ? 1 : 0,
      current_step: state.currentStep,
      selections_json: JSON.stringify(state.selections),
      updated_at: state.updatedAt,
    });
  }
}
