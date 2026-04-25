/**
 * SettingsView — single-line delegate to {@link SettingsTabs}.
 *
 * R9 introduced this view as a temporary single-section host for the
 * notification preferences UI. R10-Task6 promotes Settings to the
 * spec §7.10.6 ten-tab layout owned by `SettingsTabs`. Keeping the
 * `SettingsView` symbol stable lets `App.tsx` and any future router
 * keep their import path; the implementation is now a thin pass-through
 * so the tabs orchestrator owns header chrome, tab list and content.
 *
 * The outer `data-testid="settings-view"` is preserved for backwards
 * compatibility with existing E2E selectors that targeted the R9 host.
 */
import type { ReactElement } from 'react';

import { SettingsTabs } from './SettingsTabs';

export function SettingsView(): ReactElement {
  return (
    <div data-testid="settings-view" className="flex-1 min-h-0 flex flex-col">
      <SettingsTabs />
    </div>
  );
}
