/**
 * OnboardingPage — first-boot 5-step wizard (R11-Task6).
 *
 * Composition:
 *   - Step 1 (office)        → welcome / what-is-this copy + "시작" CTA
 *   - Step 2 (staff)         → existing OBStaffCard grid (R10 polish set 4)
 *   - Step 3 (roles)         → Step3RoleAssignment per selected provider
 *   - Step 4 (permissions)   → Step4Permissions radio group
 *   - Step 5 (firstProject)  → Step5FirstProject kind + slug
 *
 * State source-of-truth:
 *   - {@link useOnboardingState} round-trips against `onboarding:*` IPC.
 *     The hook's `state` is the persisted row; every "Next" button
 *     issues a `set-state` patch so a window close mid-wizard resumes
 *     at the same step + same selections.
 *   - When the bridge is missing (vitest jsdom env without preload), the
 *     hook falls back to local state — the existing R10 design-polish
 *     test (`OnboardingPage.test.tsx`) keeps passing without IPC mocks.
 *
 * Step gating:
 *   - Step 2 needs ≥1 selected staff.
 *   - Step 3 needs every selected staff to have a non-empty role string.
 *   - Step 4 always satisfied (default = `hybrid`).
 *   - Step 5 needs slug.length > 0.
 *   The footer's primary button is `aria-disabled='true'` until the step
 *   passes its gate; clicking is a no-op so screen readers still see the
 *   element but cannot advance. Step 1 has no gate.
 *
 * Step 5 finishes via `complete()` which flips the persisted row +
 * unmounts the wizard via the parent `onExit` (App.tsx switches view to
 * the dashboard). The actual `project:create` invocation lives in
 * App.tsx because the wizard does not own ProjectService — it only
 * collects the inputs.
 */
import { clsx } from 'clsx';
import { useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { OBStaffCard } from './OBStaffCard';
import { OBStepper } from './OBStepper';
import { OBSummaryStrip } from './OBSummaryStrip';
import { OBTopBar } from './OBTopBar';
import { Step3RoleAssignment } from './steps/Step3RoleAssignment';
import { Step4Permissions } from './steps/Step4Permissions';
import { Step5FirstProject } from './steps/Step5FirstProject';
import {
  ONBOARDING_STEPS,
  STAFF_CANDIDATES,
  type OBStep,
  type OBStepStatus,
  type StaffCandidate,
} from './onboarding-data';
import { useOnboardingState } from './use-onboarding-state';
import type {
  OnboardingSelections,
  OnboardingStep,
} from '../../../shared/onboarding-types';
import type {
  PermissionMode,
  ProjectKind,
} from '../../../shared/project-types';

export interface OnboardingPageProps {
  /** Invoked when the user clicks "나중에 하기" / "이전" / completes step 5. */
  onExit: () => void;
  /**
   * Optional callback fired when step 5 finishes (after `onboarding:complete`
   * resolves) so App.tsx can decide whether to spawn `project:create` or
   * just bounce to the dashboard. Wire site treats a missing callback as
   * "skip project creation" — the user can always reach
   * `ProjectCreateModal` from the dashboard.
   */
  onCompleteWithProject?: (input: {
    kind: ProjectKind;
    slug: string;
  }) => void;
  className?: string;
}

const MIN_STAFF = 1;
const TOTAL_STEPS = 5 as const;

/**
 * Re-derive `OBStepper` rows from the persisted current step. We keep
 * the static `ONBOARDING_STEPS` keys so the i18n labels stay anchored
 * but mark statuses dynamically — `completed` for steps below current,
 * `current` for the active step, `pending` afterwards.
 */
function buildStepperRows(
  currentStep: OnboardingStep,
): ReadonlyArray<OBStep> {
  return ONBOARDING_STEPS.map((step) => {
    let status: OBStepStatus = 'pending';
    if (step.id < currentStep) status = 'completed';
    else if (step.id === currentStep) status = 'current';
    return { ...step, status };
  });
}

/**
 * Map persisted `selections.staff` (provider id list) onto the
 * STAFF_CANDIDATES fixture so the visual grid (existing OBStaffCard) keeps
 * working with the new state shape. Cards not yet selected fall back to
 * their fixture default; an explicit empty array means "user deselected
 * everything mid-wizard".
 */
function mergeStaffSelection(
  staff: ReadonlyArray<string> | undefined,
): ReadonlyArray<StaffCandidate> {
  if (!staff) return STAFF_CANDIDATES;
  const set = new Set(staff);
  return STAFF_CANDIDATES.map((c) => ({
    ...c,
    selected: set.has(c.id),
  }));
}

export function OnboardingPage({
  onExit,
  onCompleteWithProject,
  className,
}: OnboardingPageProps): ReactElement {
  const { t } = useTranslation();
  const {
    state,
    setStep,
    patchSelections,
    complete,
  } = useOnboardingState();

  // Step 2 staff selection is derived from the persisted selections.staff
  // list each render. The visual fixture (STAFF_CANDIDATES) supplies card
  // order + display copy — the hook only provides the selection mask.
  // Avoiding local state here keeps the persisted row + UI in lock-step
  // and dodges a setState-in-effect lint warning.
  const candidates = useMemo<ReadonlyArray<StaffCandidate>>(
    () => mergeStaffSelection(state.selections.staff),
    [state.selections.staff],
  );

  const currentStep: OnboardingStep = state.currentStep;
  const stepperRows = useMemo(
    () => buildStepperRows(currentStep),
    [currentStep],
  );

  const selectedStaffIds = useMemo(
    () => candidates.filter((c) => c.selected).map((c) => c.id),
    [candidates],
  );
  const selectedCount = selectedStaffIds.length;

  // `?? {}` would create a new identity every render and invalidate the
  // canProceed memo's deps; memoise the fallback so the empty record
  // sticks across renders that don't actually mutate selections.roles.
  const roles = useMemo<NonNullable<OnboardingSelections['roles']>>(
    () => state.selections.roles ?? {},
    [state.selections.roles],
  );
  const permissions: PermissionMode =
    state.selections.permissions ?? 'hybrid';
  const firstProjectKind: ProjectKind =
    state.selections.firstProject?.kind ?? 'new';
  const firstProjectSlug: string =
    state.selections.firstProject?.slug ?? '';

  // ── Step gates ────────────────────────────────────────────────
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return true;
      case 2:
        return selectedCount >= MIN_STAFF;
      case 3:
        // every selected provider must have a non-empty trimmed role
        return (
          selectedStaffIds.length > 0 &&
          selectedStaffIds.every((id) => (roles[id] ?? '').trim().length > 0)
        );
      case 4:
        return true; // default 'hybrid' always valid
      case 5:
        return firstProjectSlug.trim().length > 0;
      default:
        return false;
    }
  }, [currentStep, selectedCount, selectedStaffIds, roles, firstProjectSlug]);

  // ── Handlers ──────────────────────────────────────────────────
  const toggleSelected = useCallback(
    (id: string): void => {
      // Recompute the next staff id list off the live `candidates` mask,
      // then patch the persisted row. The visual updates on the next
      // render once the hook resolves with the new state — synchronously
      // in test envs (the hook short-circuits without window.arena),
      // asynchronously in production.
      const next = candidates.map((c) =>
        c.id === id ? { ...c, selected: !c.selected } : c,
      );
      const ids = next.filter((c) => c.selected).map((c) => c.id);
      void patchSelections({ staff: ids });
    },
    [candidates, patchSelections],
  );

  const handleRolesChange = useCallback(
    (next: NonNullable<OnboardingSelections['roles']>): void => {
      void patchSelections({ roles: next });
    },
    [patchSelections],
  );

  const handlePermissionsChange = useCallback(
    (mode: PermissionMode): void => {
      void patchSelections({ permissions: mode });
    },
    [patchSelections],
  );

  const handleFirstProjectChange = useCallback(
    (input: { kind: ProjectKind; slug: string }): void => {
      void patchSelections({ firstProject: input });
    },
    [patchSelections],
  );

  const goToStep = useCallback(
    (step: OnboardingStep): void => {
      void setStep(step);
    },
    [setStep],
  );

  const handlePrev = useCallback((): void => {
    if (currentStep <= 1) {
      onExit();
      return;
    }
    goToStep((currentStep - 1) as OnboardingStep);
  }, [currentStep, goToStep, onExit]);

  const handleNext = useCallback((): void => {
    if (!canProceed) return;
    if (currentStep < TOTAL_STEPS) {
      goToStep((currentStep + 1) as OnboardingStep);
      return;
    }
    // Step 5 → complete + delegate first-project creation to App.tsx.
    void complete().then(() => {
      if (onCompleteWithProject && firstProjectSlug.trim().length > 0) {
        onCompleteWithProject({
          kind: firstProjectKind,
          slug: firstProjectSlug.trim(),
        });
      }
      onExit();
    });
  }, [
    canProceed,
    currentStep,
    goToStep,
    complete,
    onCompleteWithProject,
    onExit,
    firstProjectKind,
    firstProjectSlug,
  ]);

  // ── Step body ─────────────────────────────────────────────────
  const heading = t(`onboarding.step${currentStep}.heading`, {
    defaultValue: t('onboarding.heading'),
  });
  const description = t(`onboarding.step${currentStep}.description`, {
    defaultValue: t('onboarding.description'),
  });

  return (
    <div
      data-testid="onboarding-page"
      data-current-step={currentStep}
      className={clsx(
        'flex h-full min-h-screen flex-col bg-canvas text-fg',
        className,
      )}
    >
      <OBTopBar
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        estimatedTime={t('onboarding.topBar.estTime')}
        onSkip={onExit}
      />

      <div className="flex flex-col gap-4 px-6 pt-4 pb-2">
        <OBStepper steps={stepperRows} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h1
          data-testid="onboarding-heading"
          className="font-display text-2xl font-semibold text-fg"
        >
          {heading}
        </h1>
        <p
          data-testid="onboarding-description"
          className="mt-2 text-sm leading-relaxed text-fg-muted max-w-3xl"
        >
          {description}
        </p>

        {currentStep === 1 && (
          <section
            data-testid="onboarding-step-1"
            className="mt-6 max-w-2xl rounded-panel border border-border-soft bg-panel-bg p-4 text-sm leading-relaxed text-fg"
          >
            {t('onboarding.step1.body')}
          </section>
        )}

        {currentStep === 2 && (
          <>
            <div className="mt-4">
              <OBSummaryStrip candidates={candidates} />
            </div>
            <div
              data-testid="onboarding-staff-grid"
              className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {candidates.map((candidate) => (
                <OBStaffCard
                  key={candidate.id}
                  candidate={candidate}
                  onToggleSelected={toggleSelected}
                />
              ))}
            </div>
          </>
        )}

        {currentStep === 3 && (
          <div className="mt-4">
            <Step3RoleAssignment
              staff={selectedStaffIds}
              roles={roles}
              onChange={handleRolesChange}
            />
          </div>
        )}

        {currentStep === 4 && (
          <div className="mt-4">
            <Step4Permissions
              value={permissions}
              onChange={handlePermissionsChange}
            />
          </div>
        )}

        {currentStep === 5 && (
          <div className="mt-4">
            <Step5FirstProject
              kind={firstProjectKind}
              slug={firstProjectSlug}
              onChange={handleFirstProjectChange}
            />
          </div>
        )}
      </div>

      <div
        data-testid="onboarding-footer"
        className="flex items-center gap-3 border-t border-border-soft bg-panel-bg px-6 py-3"
      >
        <span className="text-xs text-fg-muted">
          {currentStep === 2
            ? t('onboarding.footer.constraint', {
                count: selectedCount,
                min: MIN_STAFF,
              })
            : t(`onboarding.footer.step${currentStep}`, {
                defaultValue: '',
              })}
        </span>
        <span className="flex-1" />
        {currentStep === 2 && (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            data-testid="onboarding-action-rescan"
          >
            {t('onboarding.actions.rescan')}
          </Button>
        )}
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid="onboarding-action-prev"
          onClick={handlePrev}
        >
          {t('onboarding.actions.prev')}
        </Button>
        <Button
          type="button"
          tone="primary"
          size="sm"
          data-testid="onboarding-action-next"
          aria-disabled={canProceed ? 'false' : 'true'}
          onClick={canProceed ? handleNext : undefined}
          className={clsx(!canProceed && 'opacity-50 cursor-not-allowed')}
        >
          {currentStep < TOTAL_STEPS
            ? t('onboarding.actions.next')
            : t('onboarding.actions.finish')}
        </Button>
      </div>
    </div>
  );
}
