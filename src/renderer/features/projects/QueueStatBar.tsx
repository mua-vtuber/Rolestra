/**
 * QueueStatBar — Set 3 design polish (시안 04 의 4-stat strip).
 *
 * Layout:
 *   - warm: 4 cells with number-on-top, label-bottom, rounded chip-like padding
 *   - tactical: same 4 cells + clip-path corners + cyan vertical separators
 *   - retro: mono prompt `done[N] active[N] wait[N] fail[N]` single line
 *
 * Source data:
 *   - parent passes already-aggregated counts derived from `useQueue.items`.
 *   - all 4 stats are always rendered (zero shown as `0`, never hidden).
 *
 * Tests-driven testids:
 *   - `queue-stat-bar` (root)
 *   - `queue-stat-bar-cell` (per stat)
 *   - `queue-stat-bar-ascii` (retro mono prompt)
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';

export interface QueueStatBarCounts {
  pending: number;
  inProgress: number;
  doneToday: number;
  failed: number;
}

export interface QueueStatBarProps {
  counts: QueueStatBarCounts;
  className?: string;
}

type StatKey = 'pending' | 'inProgress' | 'doneToday' | 'failed';

const STAT_ORDER: ReadonlyArray<StatKey> = [
  'pending',
  'inProgress',
  'doneToday',
  'failed',
];

const TONE_BY_KEY: Record<StatKey, string> = {
  pending: 'text-fg-subtle',
  inProgress: 'text-warning',
  doneToday: 'text-success',
  failed: 'text-danger',
};

const ASCII_BY_KEY: Record<StatKey, string> = {
  pending: 'wait',
  inProgress: 'active',
  doneToday: 'done',
  failed: 'fail',
};

export function QueueStatBar({ counts, className }: QueueStatBarProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  const isRetro = themeKey === 'retro';
  const isTactical = themeKey === 'tactical';

  const valueOf = (key: StatKey): number => {
    if (key === 'pending') return counts.pending;
    if (key === 'inProgress') return counts.inProgress;
    if (key === 'doneToday') return counts.doneToday;
    return counts.failed;
  };
  const labelOf = (key: StatKey): string => {
    if (key === 'pending') return t('queue.statBar.pending');
    if (key === 'inProgress') return t('queue.statBar.inProgress');
    if (key === 'doneToday') return t('queue.statBar.doneToday');
    return t('queue.statBar.failed');
  };

  if (isRetro) {
    return (
      <div
        data-testid="queue-stat-bar"
        data-theme="retro"
        role="status"
        aria-label={t('queue.statBar.aria')}
        className={clsx(
          'flex items-center gap-3 px-3 py-2 font-mono text-xs',
          'border border-border-soft rounded-panel bg-sunk',
          className,
        )}
      >
        <span data-testid="queue-stat-bar-ascii" className="text-fg-muted">
          $ queue --summary
        </span>
        {STAT_ORDER.map((key) => (
          <span
            key={key}
            data-testid="queue-stat-bar-cell"
            data-stat={key}
            className={clsx('font-semibold', TONE_BY_KEY[key])}
          >
            {ASCII_BY_KEY[key]}[{valueOf(key)}]
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="queue-stat-bar"
      data-theme={themeKey}
      role="status"
      aria-label={t('queue.statBar.aria')}
      className={clsx(
        'grid grid-cols-4 gap-2 px-3 py-2 border border-border-soft rounded-panel bg-sunk',
        className,
      )}
    >
      {STAT_ORDER.map((key, idx) => (
        <div
          key={key}
          data-testid="queue-stat-bar-cell"
          data-stat={key}
          className={clsx(
            'flex flex-col items-start',
            isTactical && idx > 0 && 'border-l border-panel-border pl-3',
          )}
        >
          <span
            data-testid="queue-stat-bar-cell-value"
            className={clsx(
              'font-display text-2xl font-semibold leading-none',
              TONE_BY_KEY[key],
            )}
          >
            {valueOf(key)}
          </span>
          <span className="mt-1 text-[11px] font-medium text-fg-muted">
            {labelOf(key)}
          </span>
        </div>
      ))}
    </div>
  );
}
