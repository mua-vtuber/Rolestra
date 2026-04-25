/**
 * OBStepper — 5-step horizontal progress indicator for the Onboarding wizard.
 *
 * Status × theme matrix:
 *   - completed: ✓ icon, success tone
 *   - current: filled circle, brand tone
 *   - pending: outlined circle, fg-muted tone
 *
 * Retro renders ASCII bracket markers ([✓] / [▶] / [N]) instead of circles.
 */
import { clsx } from 'clsx';
import { Fragment, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { OBStep, OBStepStatus } from './onboarding-data';

export interface OBStepperProps {
  steps: ReadonlyArray<OBStep>;
  className?: string;
}

const TONE_BY_STATUS: Record<OBStepStatus, string> = {
  completed: 'text-success',
  current: 'text-brand',
  pending: 'text-fg-muted',
};

export function OBStepper({ steps, className }: OBStepperProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const isRetro = themeKey === 'retro';

  return (
    <ol
      data-testid="onboarding-stepper"
      data-theme={themeKey}
      className={clsx('flex items-center gap-3', className)}
    >
      {steps.map((step, idx) => {
        const label = t(`onboarding.steps.${step.key}`);
        return (
          <Fragment key={step.id}>
            <li
              data-testid="onboarding-stepper-step"
              data-step-id={step.id}
              data-status={step.status}
              className={clsx(
                'flex items-center gap-2 text-sm',
                TONE_BY_STATUS[step.status],
              )}
            >
              {isRetro ? (
                <span data-testid="onboarding-stepper-marker" className="font-mono">
                  {step.status === 'completed'
                    ? '[✓]'
                    : step.status === 'current'
                      ? '[▶]'
                      : `[${step.id}]`}
                </span>
              ) : (
                <span
                  data-testid="onboarding-stepper-marker"
                  aria-hidden="true"
                  className={clsx(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold border',
                    step.status === 'completed' && 'bg-success text-white border-success',
                    step.status === 'current' && 'bg-brand text-white border-brand',
                    step.status === 'pending' && 'border-fg-muted',
                  )}
                >
                  {step.status === 'completed' ? '✓' : step.id}
                </span>
              )}
              <span className={clsx(step.status === 'current' && 'font-semibold')}>
                {label}
              </span>
            </li>
            {idx < steps.length - 1 && (
              <span
                aria-hidden="true"
                data-testid="onboarding-stepper-connector"
                className="h-px w-4 bg-border-soft"
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
