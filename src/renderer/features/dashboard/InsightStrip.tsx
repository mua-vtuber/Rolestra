/**
 * InsightStrip — bottom 4-cell aggregate metrics row for the Dashboard.
 *
 * R4 scope (Task 8):
 * - Structural 4-cell strip rendered at the bottom of DashboardPage.
 * - Real stream aggregates land in R6; until then every cell value
 *   defaults to the i18n'd em-dash (`dashboard.insight.placeholder`).
 * - Tone mapping (`up` / `down` / `neutral`) is wired through a prop so
 *   R6 can drive it directly from aggregate deltas without touching the
 *   component contract again.
 *
 * Prop behaviour:
 * - `cells` omitted → render the 4 canonical placeholder cells
 *   (weeklyDelta / avgResponse / cumApprovals / reviewRate) each with
 *   `value = t('dashboard.insight.placeholder')` and `tone = 'neutral'`.
 * - `cells` provided → render exactly what's passed (NO auto-padding to
 *   4). Callers must be explicit about what they are showing; silently
 *   padding would let a bug upstream leak through as an apparently
 *   well-formed strip. The acceptance criteria require "4 cells always
 *   render" only for the default placeholder path; custom `cells`
 *   callers own their own cardinality. See tests for both paths.
 *
 * Styling:
 * - Zero hex literals — every color flows through the Tailwind theme
 *   token aliases (`text-fg`, `text-fg-muted`, `text-success`,
 *   `text-danger`) which resolve to CSS vars per theme.
 * - Vertical `<Separator>` primitives sit between cells for the subtle
 *   divider look borrowed from the design sample.
 */
import { clsx } from 'clsx';
import { Fragment, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '../../components/primitives/separator';

export type InsightTone = 'up' | 'down' | 'neutral';

export interface InsightCell {
  /** Pre-translated label. Callers pass `t('dashboard.insight.*')`. */
  label: string;
  /** Pre-formatted value string. `"—"` (the i18n placeholder) for missing. */
  value: string;
  /** Tone → value color class. Defaults to `'neutral'`. */
  tone?: InsightTone;
}

export interface InsightStripProps {
  /**
   * Optional explicit cell list. When omitted, the component renders 4
   * canonical placeholder cells using the `dashboard.insight.*` i18n
   * labels. When provided, renders exactly what's passed — no padding,
   * no truncation.
   */
  cells?: InsightCell[];
  className?: string;
}

const TONE_VALUE_CLASS: Record<InsightTone, string> = {
  up: 'text-success',
  down: 'text-danger',
  neutral: 'text-fg',
};

export function InsightStrip({
  cells,
  className,
}: InsightStripProps): ReactElement {
  const { t } = useTranslation();
  const placeholder = t('dashboard.insight.placeholder');

  const resolved: InsightCell[] =
    cells ?? [
      {
        label: t('dashboard.insight.weeklyDelta'),
        value: placeholder,
        tone: 'neutral',
      },
      {
        label: t('dashboard.insight.avgResponse'),
        value: placeholder,
        tone: 'neutral',
      },
      {
        label: t('dashboard.insight.cumApprovals'),
        value: placeholder,
        tone: 'neutral',
      },
      {
        label: t('dashboard.insight.reviewRate'),
        value: placeholder,
        tone: 'neutral',
      },
    ];

  return (
    <div
      role="region"
      aria-label={t('dashboard.insight.ariaLabel')}
      data-testid="dashboard-insight-strip"
      className={clsx(
        'flex flex-row items-stretch gap-3 rounded-panel border border-panel-border bg-panel-bg px-4 py-3 shadow-panel',
        className,
      )}
    >
      {resolved.map((cell, index) => {
        const tone: InsightTone = cell.tone ?? 'neutral';
        // Never render an empty string — fall back to the i18n placeholder.
        const value = cell.value.length > 0 ? cell.value : placeholder;
        return (
          <Fragment key={`${cell.label}-${index}`}>
            {index > 0 && (
              <Separator
                orientation="vertical"
                aria-hidden="true"
                data-testid="insight-separator"
                className="self-stretch"
              />
            )}
            <div
              data-testid="insight-cell"
              data-tone={tone}
              className="flex min-w-0 flex-1 flex-col gap-1"
            >
              <span className="text-xs font-medium text-fg-muted truncate">
                {cell.label}
              </span>
              <span
                data-testid="insight-value"
                className={clsx(
                  'font-mono text-lg font-semibold leading-none truncate',
                  TONE_VALUE_CLASS[tone],
                )}
              >
                {value}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
