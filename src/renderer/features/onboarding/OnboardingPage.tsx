/**
 * OnboardingPage — pre-office wizard shell (시안 06, step 2/5 staff selection).
 *
 * This page demonstrates the Onboarding visual language at design-polish
 * fidelity. Real provider detection / persistence wires up in R12+; for
 * the design-polish round we hold candidates in local state so users can
 * exercise the selection toggle without an IPC dependency.
 *
 * The page is mounted by App.tsx when `useAppViewStore.view === 'onboarding'`
 * — outside the normal Shell/NavRail/ProjectRail chrome.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { OBStaffCard } from './OBStaffCard';
import { OBStepper } from './OBStepper';
import { OBSummaryStrip } from './OBSummaryStrip';
import { OBTopBar } from './OBTopBar';
import {
  ONBOARDING_STEPS,
  STAFF_CANDIDATES,
  type StaffCandidate,
} from './onboarding-data';

export interface OnboardingPageProps {
  /** Invoked when the user clicks "나중에 하기" or the back/exit button. */
  onExit: () => void;
  className?: string;
}

const MIN_STAFF = 1;

export function OnboardingPage({
  onExit,
  className,
}: OnboardingPageProps): ReactElement {
  const { t } = useTranslation();
  const [candidates, setCandidates] =
    useState<ReadonlyArray<StaffCandidate>>(STAFF_CANDIDATES);

  const toggleSelected = (id: string): void => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, selected: !c.selected } : c,
      ),
    );
  };

  const selectedCount = candidates.filter((c) => c.selected).length;
  const canProceed = selectedCount >= MIN_STAFF;
  const currentStep = ONBOARDING_STEPS.find((s) => s.status === 'current');

  return (
    <div
      data-testid="onboarding-page"
      className={clsx('flex h-full min-h-screen flex-col bg-canvas text-fg', className)}
    >
      <OBTopBar
        currentStep={currentStep?.id ?? 1}
        totalSteps={ONBOARDING_STEPS.length}
        estimatedTime={t('onboarding.topBar.estTime')}
        onSkip={onExit}
      />

      <div className="flex flex-col gap-4 px-6 pt-4 pb-2">
        <OBStepper steps={ONBOARDING_STEPS} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h1
          data-testid="onboarding-heading"
          className="font-display text-2xl font-semibold text-fg"
        >
          {t('onboarding.heading')}
        </h1>
        <p
          data-testid="onboarding-description"
          className="mt-2 text-sm leading-relaxed text-fg-muted max-w-3xl"
        >
          {t('onboarding.description')}
        </p>

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
      </div>

      <div
        data-testid="onboarding-footer"
        className="flex items-center gap-3 border-t border-border-soft bg-panel-bg px-6 py-3"
      >
        <span className="text-xs text-fg-muted">
          {t('onboarding.footer.constraint', {
            count: selectedCount,
            min: MIN_STAFF,
          })}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          tone="ghost"
          size="sm"
          data-testid="onboarding-action-rescan"
        >
          {t('onboarding.actions.rescan')}
        </Button>
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid="onboarding-action-prev"
          onClick={onExit}
        >
          {t('onboarding.actions.prev')}
        </Button>
        <Button
          type="button"
          tone="primary"
          size="sm"
          data-testid="onboarding-action-next"
          aria-disabled={canProceed ? 'false' : 'true'}
          className={clsx(!canProceed && 'opacity-50 cursor-not-allowed')}
        >
          {t('onboarding.actions.next')}
        </Button>
      </div>
    </div>
  );
}
