/**
 * NotificationPrefsView — R9-Task4 settings surface for per-kind
 * notification preferences.
 *
 * Live chat notification kinds each have one row:
 *   - display switch  → `setKind(kind, { enabled: !enabled })`
 *   - sound switch    → `setKind(kind, { soundEnabled: !soundEnabled })`
 *   - "테스트" button → `notification:test` one-shot diagnostic
 *
 * Archived work preference rows remain in the full response and database;
 * this mounted UI only exposes new-message and error controls.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useNotificationPrefs } from '../../hooks/use-notification-prefs';
import { usePanelClipStyle } from '../../theme/use-panel-clip-style';
import type { ChatNotificationKind } from '../../../shared/notification-types';

export interface NotificationPrefsViewProps {
  className?: string;
}

/** Only categories the current chat app can produce. */
export const VISIBLE_KINDS = ['new_message', 'error'] as const satisfies readonly ChatNotificationKind[];

/**
 * 종류 → i18n 키. `Record<VisibleKind, ...>` 라 새 종류를 더하면서 이 표를
 * 잊으면 타입 오류가 난다. 리터럴 문자열이라 i18next-parser 도 그대로
 * 집어 간다.
 */
const KIND_LABEL_KEY: Record<ChatNotificationKind, string> = {
  new_message: 'settings.notifications.kind.newMessage',
  error: 'settings.notifications.kind.error',
};

export function NotificationPrefsView({
  className,
}: NotificationPrefsViewProps): ReactElement {
  const { t } = useTranslation();
  const { prefs, isLoading, error, setKind, test } = useNotificationPrefs();
  const panelClip = usePanelClipStyle();

  return (
    <section
      data-testid="notification-prefs-view"
      data-panel-clip={panelClip.rawClip}
      style={panelClip.style}
      className={clsx(
        'border border-panel-border rounded-panel bg-panel-bg',
        className,
      )}
    >
      <header className="px-3 py-2 border-b border-border-soft bg-panel-header-bg">
        <h2 className="text-preview font-display font-semibold">
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
            className="text-xs text-danger-text border border-danger rounded-panel px-2 py-1 bg-sunk"
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
              // The full persisted map includes legacy work kinds, but only
              // these two live rows are editable in chat settings.
              const entry = prefs[kind];
              return (
                <li
                  key={kind}
                  data-testid="notification-prefs-row"
                  data-kind={kind}
                  className="flex items-center gap-3 px-2 py-2 border border-border-soft rounded-panel bg-sunk"
                >
                  <span className="flex-1 text-sm font-medium">
                    {t(KIND_LABEL_KEY[kind])}
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
