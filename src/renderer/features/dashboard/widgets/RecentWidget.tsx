/**
 * RecentWidget — bottom-middle of the R4 dashboard 2×2 grid.
 *
 * Renders the last N messages across all channels: sender avatar +
 * excerpt + channel name + timestamp. Backed by {@link useRecentMessages}
 * which calls the new `message:list-recent` channel.
 *
 * Sender label rules (spec §7.5):
 *   - `senderKind='user'`   → localised "나" / "Me" via `dashboard.recent.you`
 *   - `senderKind='member'` → raw `senderLabel` from the repo (provider
 *                             display name)
 *   - `senderKind='system'` → localised "시스템" / "System"
 *
 * R4: row clicks do nothing. R5 will wire channel navigation through
 * the optional `onRowActivate` prop.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../../components/primitives';
import { ProfileAvatar } from '../../../components/shell/ProfileAvatar';
import { useRecentMessages } from '../../../hooks/use-recent-messages';
import type { RecentMessage } from '../../../../shared/message-types';

export interface RecentWidgetProps {
  /** Max rows to fetch. Defaults to 10. */
  limit?: number;
  /** Future (R5): invoked when a message row is activated. Defaults to no-op. */
  onRowActivate?: (message: RecentMessage) => void;
  className?: string;
}

function noop(): void {
  /* intentionally empty — R4 rows are not yet interactive */
}

/**
 * Short, locale-neutral "HH:MM" of the creation timestamp. The
 * dashboard is a glance view — we don't need full localised
 * date-formatting, and pulling in an Intl.DateTimeFormat branch here
 * would drag locale loading into the widget render path. If the user
 * hovers, the `<time>` element's `dateTime` carries the ISO string.
 */
function formatClock(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RecentWidget({
  limit,
  onRowActivate = noop,
  className,
}: RecentWidgetProps): ReactElement {
  const { t } = useTranslation();
  const { messages, loading, error } = useRecentMessages(limit);

  const resolveSenderLabel = (m: RecentMessage): string => {
    if (m.senderKind === 'user') return t('dashboard.recent.you');
    if (m.senderKind === 'system') return t('dashboard.recent.system');
    return m.senderLabel;
  };

  const body = (() => {
    if (messages === null && loading) {
      return (
        <div
          data-testid="recent-widget-loading"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.recent.loading')}
        </div>
      );
    }
    if (error !== null) {
      const message =
        error.message && error.message.length > 0
          ? error.message
          : t('dashboard.recent.error');
      return (
        <div
          role="alert"
          data-testid="recent-widget-error"
          className="text-sm text-danger py-2"
        >
          {message}
        </div>
      );
    }
    const list = messages ?? [];
    if (list.length === 0) {
      return (
        <div
          data-testid="recent-widget-empty"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.recent.empty')}
        </div>
      );
    }
    return (
      <ul
        data-testid="recent-widget-list"
        className="flex flex-col gap-2"
      >
        {list.map((msg) => {
          const senderLabel = resolveSenderLabel(msg);
          return (
            <li
              key={msg.id}
              data-testid="recent-widget-row"
              data-message-id={msg.id}
              className="flex items-start gap-2"
            >
              <ProfileAvatar
                member={{ id: msg.senderId, name: senderLabel }}
                size={24}
              />
              <button
                type="button"
                data-testid="recent-widget-row-activate"
                onClick={() => onRowActivate(msg)}
                className="flex-1 min-w-0 text-left flex flex-col"
              >
                <span className="text-xs text-fg-muted flex items-center gap-1">
                  <span className="truncate">{senderLabel}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{`#${msg.channelName}`}</span>
                  <span aria-hidden className="mx-1">·</span>
                  <time
                    className="font-mono"
                    dateTime={new Date(msg.createdAt).toISOString()}
                  >
                    {formatClock(msg.createdAt)}
                  </time>
                </span>
                <span className="text-sm text-fg truncate">
                  {msg.excerpt}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  })();

  return (
    <Card
      data-testid="recent-widget"
      className={clsx('flex flex-col', className)}
    >
      <CardHeader heading={t('dashboard.recent.title')} />
      <CardBody className="flex flex-col gap-2">{body}</CardBody>
    </Card>
  );
}
