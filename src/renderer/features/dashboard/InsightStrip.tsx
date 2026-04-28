/**
 * InsightStrip — aggregate metrics row primitive.
 *
 * Pure presentation component. Callers MUST supply `cells` — the
 * component never fabricates placeholder values. R4 originally shipped a
 * 4-cell em-dash default ("real aggregates land in R6") which became a
 * forbidden mock per CLAUDE.md (no placeholder data on production code
 * paths). F3 (cleanup-2026-04-27) removed that default; until V4 wires
 * real aggregations the strip is not mounted on `DashboardPage`. Tests
 * and future callers that have real data pass it through `cells`.
 *
 * Prop behaviour:
 * - `cells` is required. Renders exactly what's passed — no padding, no
 *   truncation. Callers own their own cardinality.
 * - Empty value strings render as `dashboard.insight.placeholder` (the
 *   i18n em-dash) so a partial cell does not collapse to zero-width.
 *   This is a presentation-layer guard, not a fallback for missing
 *   data: callers MUST pass formatted values, but if formatting yields
 *   `''` the row still has visual height.
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
  /** Pre-formatted value string. */
  value: string;
  /** Tone → value color class. Defaults to `'neutral'`. */
  tone?: InsightTone;
}

export interface InsightStripProps {
  /** Explicit cell list. Required — no default placeholder rendering. */
  cells: InsightCell[];
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
      {cells.map((cell, index) => {
        const tone: InsightTone = cell.tone ?? 'neutral';
        // Empty value → presentation-layer placeholder so a degenerate
        // string does not collapse the row. Callers MUST pass formatted
        // values; this only guards visual height.
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
