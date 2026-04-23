/**
 * NotificationPrefsView — R9-Task4 settings surface for per-kind
 * notification preferences.
 *
 * Renders 4 rows (new_message / approval_pending / work_done / error —
 * the 4 "core" user-facing kinds per spec §7.5). Each row offers:
 *   - display switch  → `setKind(kind, { enabled: !enabled })`
 *   - sound switch    → `setKind(kind, { soundEnabled: !soundEnabled })`
 *   - "테스트" button → `notification:test` one-shot diagnostic
 *
 * The `queue_progress` and `meeting_state` kinds exist in the DB schema
 * for R10+ surfaces but are deliberately NOT rendered here — R9's UX
 * goal is to expose the 4 kinds the user actually sees fire today.
 *
 * i18n keys are populated by Task 11 (`settings.notifications.*`); until
 * that lands the labels render as their key strings (harmless fallback).
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useNotificationPrefs } from '../../hooks/use-notification-prefs';
import type { NotificationKind } from '../../../shared/notification-types';

export interface NotificationPrefsViewProps {
  className?: string;
}

/**
 * The 4 kinds surfaced in R9 settings UI. `queue_progress` and
 * `meeting_state` (6-kind schema) are intentionally omitted — spec §7.5.
 */
const VISIBLE_KINDS: readonly NotificationKind[] = [
  'new_message',
  'approval_pending',
  'work_done',
  'error',
] as const;

/**
 * Resolves the localized row label using static `t(...)` calls so
 * i18next-parser picks up each key. Callers supply the `t` instance
 * captured once inside the component body.
 */
function kindLabel(
  t: (key: string) => string,
  kind: NotificationKind,
): string {
  if (kind === 'new_message') return t('settings.notifications.kind.newMessage');
  if (kind === 'approval_pending')
    return t('settings.notifications.kind.approvalPending');
  if (kind === 'work_done') return t('settings.notifications.kind.workDone');
  if (kind === 'error') return t('settings.notifications.kind.error');
  return t('settings.notifications.kind.unknown');
}

export function NotificationPrefsView({
  className,
}: NotificationPrefsViewProps): ReactElement {
  const { t } = useTranslation();
  const { prefs, isLoading, error, setKind, test } = useNotificationPrefs();

  return (
    <section
      data-testid="notification-prefs-view"
      className={clsx(
        'border border-panel-border rounded-panel bg-panel-bg',
        className,
      )}
    >
      <header className="px-3 py-2 border-b border-border-soft bg-panel-header-bg">
        <h2 className="text-sm font-display font-semibold">
          {t('settings.notifications.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.notifications.description')}
        </p>
      </header>

      <div className="p-3 space-y-2">
        {error !== null && (
          <div
            role="alert"
            data-testid="notification-prefs-error"
            className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
          >
            {error.message}
          </div>
        )}

        {isLoading && prefs === null ? (
          <p
            data-testid="notification-prefs-loading"
            className="text-sm text-fg-muted italic"
          >
            {t('settings.notifications.loading')}
          </p>
        ) : prefs === null ? null : (
          <ul
            data-testid="notification-prefs-list"
            className="space-y-1"
          >
            {VISIBLE_KINDS.map((kind) => {
              const entry = prefs[kind];
              return (
                <li
                  key={kind}
                  data-testid="notification-prefs-row"
                  data-kind={kind}
                  className="flex items-center gap-3 px-2 py-2 border border-border-soft rounded-panel bg-sunk"
                >
                  <span className="flex-1 text-sm font-medium">
                    {kindLabel(t, kind)}
                  </span>

                  <label
                    className="inline-flex items-center gap-1.5 text-xs text-fg"
                    data-testid="notification-prefs-display-label"
                  >
                    <input
                      type="checkbox"
                      data-testid="notification-prefs-display"
                      data-kind={kind}
                      checked={entry.enabled}
                      onChange={(e) => {
                        void setKind(kind, { enabled: e.target.checked });
                      }}
                      className="accent-brand"
                    />
                    <span>{t('settings.notifications.display')}</span>
                  </label>

                  <label
                    className="inline-flex items-center gap-1.5 text-xs text-fg"
                    data-testid="notification-prefs-sound-label"
                  >
                    <input
                      type="checkbox"
                      data-testid="notification-prefs-sound"
                      data-kind={kind}
                      checked={entry.soundEnabled}
                      onChange={(e) => {
                        void setKind(kind, { soundEnabled: e.target.checked });
                      }}
                      className="accent-brand"
                    />
                    <span>{t('settings.notifications.sound')}</span>
                  </label>

                  <Button
                    type="button"
                    tone="ghost"
                    size="sm"
                    data-testid="notification-prefs-test"
                    data-kind={kind}
                    onClick={() => {
                      void test(kind);
                    }}
                  >
                    {t('settings.notifications.test')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
