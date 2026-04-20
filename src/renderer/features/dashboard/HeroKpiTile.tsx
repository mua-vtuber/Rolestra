/**
 * HeroKpiTile — single KPI tile rendered inside the Dashboard Hero row.
 *
 * State model:
 * - `value === null`  → loading / unavailable: render a skeleton block and
 *                       mark the tile with `aria-busy="true"`.
 * - `value === 0`     → zero is an *explicit* empty state: the digit `0`
 *                       is rendered in `text-fg-muted` so it reads as a
 *                       soft visual hint — never silently hidden.
 * - `value > 0`       → normal rendering in default `text-fg`.
 *
 * Icons:
 *   Per-variant glyphs are kept as emoji literals in JSX.
 *   `eslint-plugin-i18next` accepts emoji as non-translatable content (they
 *   are icon-equivalent, not user-copy). Keeping them here avoids an
 *   i18n key for what is effectively a static decorative symbol.
 *
 * Styling:
 *   No hex colors anywhere in this file — only Tailwind token classes
 *   (`text-fg`, `text-fg-muted`, `bg-panel-bg`, `border-panel-border`,
 *   `rounded-panel`). CSS vars resolve through `tailwind.config.ts`.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

export type HeroKpiVariant = 'projects' | 'meetings' | 'approvals' | 'completed';

export interface HeroKpiTileProps {
  variant: HeroKpiVariant;
  /** Pre-translated label. Parent passes `t('dashboard.kpi.*')`. */
  label: string;
  /** Current count. `null` = loading / unavailable (renders skeleton). */
  value: number | null;
  /** Extra className forwarded to the outer tile element. */
  className?: string;
}

const VARIANT_ICON: Record<HeroKpiVariant, string> = {
  projects: '📁',
  meetings: '💬',
  approvals: '🔔',
  completed: '✅',
};

export function HeroKpiTile({
  variant,
  label,
  value,
  className,
}: HeroKpiTileProps): ReactElement {
  const isLoading = value === null;
  const isZero = value === 0;

  return (
    <div
      data-testid="hero-kpi-tile"
      data-variant={variant}
      aria-busy={isLoading ? 'true' : 'false'}
      className={clsx(
        'flex flex-col gap-2 bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel px-4 py-3',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-base leading-none">
          {VARIANT_ICON[variant]}
        </span>
        <span className="text-xs font-medium text-fg-muted">{label}</span>
      </div>
      {isLoading ? (
        <div
          data-testid="hero-kpi-skeleton"
          aria-hidden="true"
          className="h-8 w-16 rounded bg-sunk animate-pulse"
        />
      ) : (
        <span
          data-testid="hero-kpi-value"
          className={clsx(
            'font-display text-3xl font-semibold leading-none',
            isZero ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}
