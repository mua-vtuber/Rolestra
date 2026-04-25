/**
 * DetectionBadge — small status chip shown in the corner of OBStaffCard.
 *
 * State × theme matrix:
 *   - selected (brand tone)
 *     - retro: `[X]`
 *     - others: solid pill "선택됨"
 *   - detected (success tone)
 *     - retro: `[D]`
 *     - others: tinted pill "감지됨"
 *   - alt (muted tone)
 *     - retro: `[ ]`
 *     - others: outline pill "대안"
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { DetectionState } from './onboarding-data';

export interface DetectionBadgeProps {
  state: DetectionState;
  className?: string;
}

const RETRO_GLYPH: Record<DetectionState, string> = {
  selected: '[X]',
  detected: '[D]',
  alt: '[ ]',
};

const TONE_CLASS: Record<DetectionState, string> = {
  selected: 'bg-brand text-white border-brand',
  detected: 'bg-sunk text-success border-success',
  alt: 'bg-sunk text-fg-muted border-border-soft',
};

export function DetectionBadge({
  state,
  className,
}: DetectionBadgeProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const isRetro = themeKey === 'retro';
  const isWarm = themeKey === 'warm';

  const label = (() => {
    if (state === 'selected') return t('onboarding.cardLabels.selected');
    if (state === 'detected') return t('onboarding.cardLabels.detected');
    return t('onboarding.cardLabels.alt');
  })();

  if (isRetro) {
    return (
      <span
        data-testid="onboarding-detection-badge"
        data-state={state}
        data-theme="retro"
        className={clsx(
          'font-mono text-xs',
          state === 'selected' && 'text-brand',
          state === 'detected' && 'text-success',
          state === 'alt' && 'text-fg-muted',
          className,
        )}
      >
        {RETRO_GLYPH[state]}
      </span>
    );
  }

  return (
    <span
      data-testid="onboarding-detection-badge"
      data-state={state}
      data-theme={themeKey}
      className={clsx(
        'inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border',
        TONE_CLASS[state],
        isWarm ? 'rounded-full' : 'rounded-panel',
        className,
      )}
    >
      {label}
    </span>
  );
}
