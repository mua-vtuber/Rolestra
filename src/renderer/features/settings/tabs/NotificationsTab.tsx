/**
 * NotificationsTab — R10-Task6 wrapper that delegates to the existing
 * R9 `NotificationPrefsView`. Kept as a thin shim so the tab list owns
 * the title row and the inner view stays focused on per-kind editing.
 */
import type { ReactElement } from 'react';

import { NotificationPrefsView } from '../NotificationPrefsView';

export function NotificationsTab(): ReactElement {
  return (
    <div data-testid="settings-tab-notifications">
      <NotificationPrefsView />
    </div>
  );
}
