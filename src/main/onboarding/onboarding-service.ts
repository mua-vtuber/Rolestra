/**
 * OnboardingService — R11-Task6.
 *
 * Coordinates the first-boot 5-step wizard between the renderer (via the
 * three `onboarding:*` IPC channels in
 * `src/main/ipc/handlers/onboarding-handler.ts`) and the persisted single
 * row in `onboarding_state` (migration 013). Holds no in-memory cache —
 * every read goes through {@link OnboardingStateRepository.read} so a
 * second window or a renderer reload always sees the latest wizard
 * progress.
 *
 * Responsibilities:
 *   - {@link getState} — return the persisted state, or seed the canonical
 *     first-boot default (`completed=false, currentStep=1, selections={}`)
 *     when the repository row is absent. The default is also written
 *     through to disk so a follow-up `set-state` patches against a row
 *     that already exists, and so `provider:detect` cache calls (Task 8
 *     cost summary) can rely on `updated_at` being non-null.
 *   - {@link applyPartial} — partial patch (used by step 2~5 progress
 *     saves). The `completed` field is intentionally ignored here even if
 *     the renderer sends it; only `complete()` flips the row to done.
 *     This protects the AboutTab "restart" flow from a renderer bug
 *     accidentally re-completing a freshly-reset row.
 *   - {@link complete} — mark `completed=true` + bump `updated_at`. Called
 *     by `onboarding:complete` after the user clicks the step-5 finish
 *     button. Idempotent — the wizard never reverts via this path.
 *
 * Why the service does not own a Zustand-like event emitter:
 *   The renderer is single-window (Decision D6) so a second listener
 *   would have nothing to observe. If a R12+ multi-window mode arrives,
 *   wire `streamBridge.connect({ onboarding: ... })` here and emit a
 *   `stream:onboarding-state-changed` push instead of refactoring callers.
 */

import type {
  OnboardingSelections,
  OnboardingState,
  OnboardingStep,
} from '../../shared/onboarding-types';
import type { OnboardingStateRepository } from './onboarding-state-repository';

/**
 * Default state surfaced on first boot. Centralised so both
 * `getState` (creates row) and `complete()` (after a reset cycle) can
 * agree on what "fresh" means.
 */
function buildDefaultState(now: number): OnboardingState {
  return {
    completed: false,
    currentStep: 1,
    selections: {},
    updatedAt: now,
  };
}

/**
 * Merge a partial patch onto the current state. Pure function — the
 * service wraps it with the repository write. Exported for unit tests
 * that want to drive the merge logic without spinning up a DB.
 */
export function mergeOnboardingPartial(
  current: OnboardingState,
  partial: Partial<OnboardingState>,
  now: number,
): OnboardingState {
  // Selections merge field-by-field (not full overwrite) so step N can
  // patch only its slice without dropping step N-1's choices.
  const mergedSelections: OnboardingSelections = {
    ...current.selections,
    ...(partial.selections ?? {}),
  };

  // currentStep clamps to the literal union range — the zod schema
  // already validates the input, but defence-in-depth keeps an unsafe
  // call-site (Bypassing the IPC layer e.g. in a unit test) honest.
  let nextStep: OnboardingStep = current.currentStep;
  const incoming = partial.currentStep;
  if (
    incoming === 1 ||
    incoming === 2 ||
    incoming === 3 ||
    incoming === 4 ||
    incoming === 5
  ) {
    nextStep = incoming;
  }

  return {
    // `completed` is deliberately not flipped here — only complete()
    // changes that field. A renderer bug that tries to set completed=true
    // through set-state silently keeps the previous value, which the
    // OnboardingPage uses to decide "should I close myself?".
    completed: current.completed,
    currentStep: nextStep,
    selections: mergedSelections,
    updatedAt: now,
  };
}

export class OnboardingService {
  constructor(
    private readonly repo: OnboardingStateRepository,
    private readonly nowFn: () => number = Date.now,
  ) {}

  /**
   * Return the persisted wizard state. Seeds + persists the canonical
   * default on first call so subsequent set-state mutations always patch
   * a real row.
   */
  getState(): OnboardingState {
    const persisted = this.repo.read();
    if (persisted) return persisted;
    const fresh = buildDefaultState(this.nowFn());
    this.repo.write(fresh);
    return fresh;
  }

  /**
   * Apply a partial patch and return the new full state. Calls
   * {@link mergeOnboardingPartial} so the merge logic is reused by the
   * unit test suite.
   */
  applyPartial(partial: Partial<OnboardingState>): OnboardingState {
    const current = this.getState();
    const next = mergeOnboardingPartial(current, partial, this.nowFn());
    this.repo.write(next);
    return next;
  }

  /**
   * One-way flip to `completed=true`. Idempotent: a second call simply
   * bumps `updated_at` without otherwise mutating selections / step.
   */
  complete(): void {
    const current = this.getState();
    this.repo.write({
      ...current,
      completed: true,
      updatedAt: this.nowFn(),
    });
  }

  /**
   * Reset the wizard. Used by AboutTab "Restart onboarding" — the row is
   * rewritten with the canonical default but the table itself is not
   * dropped (a future feature might want a `previous_completed_at`
   * audit column without touching this contract).
   */
  reset(): OnboardingState {
    const fresh = buildDefaultState(this.nowFn());
    this.repo.write(fresh);
    return fresh;
  }
}
