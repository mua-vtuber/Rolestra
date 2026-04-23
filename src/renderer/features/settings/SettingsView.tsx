/**
 * SettingsView — R9-Task4 temporary settings surface.
 *
 * R10 will reorganize settings into a 10-tab layout (spec §11). For R9
 * we mount a single-column stack so the only user-facing entry today —
 * `NotificationPrefsView` — has a place to live and the `settings` nav
 * item is no longer a dead link.
 *
 * Any future R9/R10 settings surface (provider prefs, theme, memory, …)
 * should slot in as a sibling section below the notifications block.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { NotificationPrefsView } from './NotificationPrefsView';

export function SettingsView(): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      data-testid="settings-view"
      className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4"
    >
      <header>
        <h1 className="text-lg font-display font-semibold">
          {t('settings.title')}
        </h1>
        <p className="text-sm text-fg-muted mt-0.5">
          {t('settings.description')}
        </p>
      </header>

      <NotificationPrefsView />
    </div>
  );
}
