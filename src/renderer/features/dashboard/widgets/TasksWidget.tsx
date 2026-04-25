/**
 * TasksWidget — top-left widget in the R4 dashboard 2×2 grid.
 *
 * Lists up to N active meetings with a progress gauge per row (SSM
 * stateIndex / SESSION_STATE_COUNT). Data comes from
 * {@link useActiveMeetings}; styling stays on Tailwind token classes —
 * no hex literals.
 *
 * R4 scope: click handlers are absent. A future phase (R5 routing) will
 * attach per-row navigation via the optional `onRowActivate` prop; the
 * prop is declared now so the attachment point already exists.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../../components/primitives';
import { ProgressGauge } from '../ProgressGauge';
import { useActiveMeetings } from '../../../hooks/use-active-meetings';
import { SESSION_STATE_COUNT } from '../../../../shared/constants';
import type { ActiveMeetingSummary } from '../../../../shared/meeting-types';

export interface TasksWidgetProps {
  /** Max rows to render. Defaults to 10 (matches spec §7.5 widget cap). */
  limit?: number;
  /** Future (R5): invoked when a meeting row is activated. Defaults to no-op. */
  onRowActivate?: (meeting: ActiveMeetingSummary) => void;
  className?: string;
}

function noop(): void {
  /* intentionally empty — R4 rows are not yet interactive */
}

/**
 * Format "Xm Ys" elapsed label. We keep this in ASCII digits + unit
 * letters to avoid locale-specific number formatting branches; the
 * surrounding widget uses `t()` for the template so the LABEL localises
 * ("3m 14s" → "3분 14초" via the i18n template).
 */
function formatElapsed(ms: number): { minutes: number; seconds: number } {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return {
    minutes: Math.floor(totalSec / 60),
    seconds: totalSec % 60,
  };
}

export function TasksWidget({
  limit,
  onRowActivate = noop,
  className,
}: TasksWidgetProps): ReactElement {
  const { t } = useTranslation();
  const { meetings, loading, error } = useActiveMeetings(limit);
  const count = meetings === null ? undefined : meetings.length;

  const body = (() => {
    if (meetings === null && loading) {
      return (
        <div
          data-testid="tasks-widget-loading"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.tasks.loading')}
        </div>
      );
    }
    if (error !== null) {
      const message =
        error.message && error.message.length > 0
          ? error.message
          : t('dashboard.tasks.error');
      return (
        <div
          role="alert"
          data-testid="tasks-widget-error"
          className="text-sm text-danger py-2"
        >
          {message}
        </div>
      );
    }
    const list = meetings ?? [];
    if (list.length === 0) {
      return (
        <div
          data-testid="tasks-widget-empty"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.tasks.empty')}
        </div>
      );
    }
    return (
      <ul
        data-testid="tasks-widget-list"
        className="flex flex-col gap-3"
      >
        {list.map((meeting) => {
          const { minutes, seconds } = formatElapsed(meeting.elapsedMs);
          return (
            <li
              key={meeting.id}
              data-testid="tasks-widget-row"
              data-meeting-id={meeting.id}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm font-medium text-fg truncate"
                  title={meeting.topic}
                >
                  {meeting.topic.length > 0 ? meeting.topic : meeting.channelName}
                </span>
                <button
                  type="button"
                  data-testid="tasks-widget-row-activate"
                  onClick={() => onRowActivate(meeting)}
                  className="text-xs text-fg-muted hover:text-fg"
                  aria-label={meeting.topic}
                >
                  {t('dashboard.tasks.elapsed', { minutes, seconds })}
                </button>
              </div>
              <ProgressGauge
                value={meeting.stateIndex}
                total={SESSION_STATE_COUNT}
                label={`${meeting.projectName ?? meeting.channelName} · ${meeting.stateName}`}
              />
            </li>
          );
        })}
      </ul>
    );
  })();

  return (
    <Card
      data-testid="tasks-widget"
      className={clsx('flex flex-col', className)}
    >
      <CardHeader heading={t('dashboard.tasks.title')} count={count} />
      <CardBody className="flex flex-col gap-2">{body}</CardBody>
    </Card>
  );
}
