/**
 * QueueActiveSpotlight — Set 3 design polish (시안 04 의 in_progress 카드).
 *
 * Renders a spotlight card for the single in_progress queue item. When no
 * such item exists the component returns `null` so callers can mount it
 * unconditionally without an empty wrapper.
 *
 * Theme branching:
 *   - warm: rounded card + warning-tinted border + label "현재 작업"
 *   - tactical: clip-path card + cyan accent + animated pulse on label
 *   - retro: ASCII frame `┌─ ./live` heading + `>> 현재 작업` + `[LIVE]`
 *
 * Source data:
 *   - parent passes the resolved in_progress item (or null). Aggregation
 *     stays in QueuePanel so this component is purely presentational.
 *
 * Testids:
 *   - `queue-active-spotlight`        (root, only rendered when item)
 *   - `queue-active-spotlight-prompt` (item.prompt)
 *   - `queue-active-spotlight-live`   (LIVE badge — retro only)
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import type { QueueItem } from '../../../shared/queue-types';

export interface QueueActiveSpotlightProps {
  item: QueueItem | null;
  className?: string;
}

export function QueueActiveSpotlight({
  item,
  className,
}: QueueActiveSpotlightProps): ReactElement | null {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  if (item === null) return null;

  const isRetro = themeKey === 'retro';
  const isTactical = themeKey === 'tactical';
  const startedTimestamp = item.startedAt;
  const startedLabel =
    typeof startedTimestamp === 'number'
      ? new Date(startedTimestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  if (isRetro) {
    return (
      <div
        data-testid="queue-active-spotlight"
        data-theme="retro"
        data-item-id={item.id}
        className={clsx(
          'border border-border-soft rounded-panel bg-sunk font-mono',
          className,
        )}
      >
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5 text-xs">
          <span className="text-fg-subtle">┌─</span>
          <span className="text-fg-muted">./live</span>
          <span className="flex-1" />
          <span
            data-testid="queue-active-spotlight-live"
            className="text-warning animate-pulse"
          >
            [LIVE]
          </span>
        </div>
        <div className="px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="text-warning">{'>>'}</span>
            <span>{t('queue.activeSpotlight.now')}</span>
            {startedLabel !== null && (
              <span className="ml-auto text-fg-subtle">{startedLabel}</span>
            )}
          </div>
          <div
            data-testid="queue-active-spotlight-prompt"
            className="mt-1.5 text-fg"
          >
            {item.prompt}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="queue-active-spotlight"
      data-theme={themeKey}
      data-item-id={item.id}
      className={clsx(
        'border border-warning ring-1 ring-warning rounded-panel bg-sunk px-3 py-2',
        isTactical && 'shadow-panel',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-hidden="true"
          className={clsx(
            'inline-block h-2 w-2 rounded-full bg-warning',
            isTactical && 'animate-pulse',
          )}
        />
        <span className="font-semibold text-warning">
          {t('queue.activeSpotlight.now')}
        </span>
        {startedLabel !== null && (
          <span className="ml-auto text-fg-muted">{startedLabel}</span>
        )}
      </div>
      <div
        data-testid="queue-active-spotlight-prompt"
        className="mt-1.5 text-sm text-fg"
      >
        {item.prompt}
      </div>
    </div>
  );
}
