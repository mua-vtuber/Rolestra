/**
 * OBSummaryStrip — 3-stat strip above the staff grid (시안 06).
 *
 * Stats: 선택됨 / 감지됨 / 예외처(alt)
 *
 * Theme branching:
 *   - warm: brand-tinted bg, large numbers
 *   - tactical: clip-path strip + cyan separators
 *   - retro: mono prompt `$ onboarding --staff` + 한 줄 형식
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import { type StaffCandidate } from './onboarding-data';

export interface OBSummaryStripProps {
  candidates: ReadonlyArray<StaffCandidate>;
  className?: string;
}

export function OBSummaryStrip({
  candidates,
  className,
}: OBSummaryStripProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const isRetro = themeKey === 'retro';
  const isTactical = themeKey === 'tactical';

  // Per 시안 06: selected/detected/alt 는 overlap 허용 카운트.
  // selected = c.selected, detected = c.detected, alt = !c.detected.
  // (detection-state mutually-exclusive 분기는 DetectionBadge 가 따로 처리.)
  const counts = candidates.reduce(
    (acc, c) => {
      if (c.selected) acc.selected += 1;
      if (c.detected) acc.detected += 1;
      else acc.alt += 1;
      return acc;
    },
    { selected: 0, detected: 0, alt: 0 },
  );

  if (isRetro) {
    return (
      <div
        data-testid="onboarding-summary-strip"
        data-theme="retro"
        className={clsx(
          'flex flex-col gap-1 px-3 py-2 border border-border-soft bg-sunk font-mono text-xs',
          className,
        )}
      >
        <div className="text-fg-muted">$ onboarding --staff</div>
        <div className="flex items-center gap-3 text-fg">
          <span data-testid="onboarding-summary-cell" data-stat="selected">
            <span className="text-brand font-semibold">
              {t('onboarding.summary.short.selected')}[{counts.selected}]
            </span>
          </span>
          <span data-testid="onboarding-summary-cell" data-stat="detected">
            <span className="text-success font-semibold">
              {t('onboarding.summary.short.detected')}[{counts.detected}]
            </span>
          </span>
          <span data-testid="onboarding-summary-cell" data-stat="alt">
            <span className="text-fg-muted font-semibold">
              {t('onboarding.summary.short.alternative')}[{counts.alt}]
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="onboarding-summary-strip"
      data-theme={themeKey}
      className={clsx(
        'grid grid-cols-3 gap-3 px-4 py-3 border border-border-soft bg-sunk',
        themeKey === 'warm' ? 'rounded-panel' : '',
        className,
      )}
    >
      {(['selected', 'detected', 'alt'] as const).map((stat, idx) => (
        <div
          key={stat}
          data-testid="onboarding-summary-cell"
          data-stat={stat}
          className={clsx(
            'flex flex-col',
            isTactical && idx > 0 && 'border-l border-panel-border pl-3',
          )}
        >
          <span
            data-testid="onboarding-summary-cell-value"
            className={clsx(
              'font-display text-2xl font-semibold leading-none',
              stat === 'selected' && 'text-brand',
              stat === 'detected' && 'text-success',
              stat === 'alt' && 'text-fg-muted',
            )}
          >
            {counts[stat]}
          </span>
          <span className="mt-1 text-[11px] font-medium text-fg-muted">
            {t(`onboarding.summary.${stat}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
