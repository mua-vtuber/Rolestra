/**
 * SettingsView — the settings screen host; {@link SettingsTabs} owns the
 * menu, the tabs and the AI add dialog (spec 2026-10-01-messenger-redesign.md
 * R5: AI add is reached only from the settings AI tab).
 *
 * The outer `data-testid="settings-view"` is kept for existing E2E selectors.
 */
import type { ReactElement } from 'react';

import { SettingsTabs } from './SettingsTabs';

export function SettingsView(): ReactElement {
  return (
    <div data-testid="settings-view" className="flex min-h-0 flex-1 flex-col">
      <SettingsTabs />
    </div>
  );
}
