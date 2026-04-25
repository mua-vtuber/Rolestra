/**
 * OBTopBar — slim top bar for the Onboarding shell (시안 06).
 *
 * Layout:
 *   - left: R logo + "Rolestra 시작하기" + "current/total 단계" + estimated time
 *   - right: "나중에 하기" link (calls onSkip)
 *
 * Pre-office shell — no NavRail, no project-rail. The Onboarding wizard
 * deliberately occupies the full Electron window so the user can focus
 * on configuration without sidebar navigation noise.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';

export interface OBTopBarProps {
  currentStep: number;
  totalSteps: number;
  /** Localised "약 4분 남음" — rendered as-is. */
  estimatedTime: string;
  onSkip: () => void;
  className?: string;
}

export function OBTopBar({
  currentStep,
  totalSteps,
  estimatedTime,
  onSkip,
  className,
}: OBTopBarProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const isRetro = themeKey === 'retro';

  return (
    <div
      data-testid="onboarding-topbar"
      data-theme={themeKey}
      className={clsx(
        'flex items-center gap-3 px-4 py-2 border-b border-border bg-topbar-bg',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'inline-flex h-7 w-7 items-center justify-center font-semibold',
          'bg-logo-bg text-logo-fg',
          isRetro ? 'border border-brand font-mono' : 'rounded-panel shadow-logo',
        )}
      >
        R
      </div>
      <span className="text-sm font-semibold text-fg">
        {t('onboarding.topBar.title')}
      </span>
      <span
        data-testid="onboarding-topbar-step-meta"
        className="text-xs text-fg-muted"
      >
        {currentStep}/{totalSteps}{' '}
        {t('onboarding.topBar.stepUnit')}
        {' · '}
        {estimatedTime}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        data-testid="onboarding-topbar-skip"
        onClick={onSkip}
        className="text-xs text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-panel px-2 py-1"
      >
        {t('onboarding.topBar.skip')}
      </button>
    </div>
  );
}
