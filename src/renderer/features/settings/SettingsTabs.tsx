/**
 * SettingsTabs — R10-Task6 orchestrator for the 10-tab settings UI.
 *
 * Replaces R9's single-section `SettingsView` (which mounted only
 * `NotificationPrefsView`). The orchestrator owns the active tab key,
 * synchronises it to the URL hash (`#settings/<tab>`) so reloads /
 * deep-links land on the same tab, and renders the matching tab body.
 *
 * Tab keys are intentionally a stable string union — the URL hash is
 * a public contract (can be linked from notification toasts, future
 * onboarding tours, …). Adding a tab is additive; renaming a key is a
 * breaking change.
 *
 * The orchestrator is purposely thin: every tab body lives in its own
 * file under `./tabs/` and owns its own IPC, error UX and i18n. This
 * keeps the orchestrator render path cheap (one big switch) and makes
 * each tab independently testable.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/primitives/tabs';
import { MembersTab } from './tabs/MembersTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { AutonomyDefaultsTab } from './tabs/AutonomyDefaultsTab';
import { ApiKeysTab } from './tabs/ApiKeysTab';
import { ThemeTab } from './tabs/ThemeTab';
import { LanguageTab } from './tabs/LanguageTab';
import { PathTab } from './tabs/PathTab';
import { CliTab } from './tabs/CliTab';
import { SecurityTab } from './tabs/SecurityTab';
import { AboutTab } from './tabs/AboutTab';

export const SETTINGS_TAB_KEYS = [
  'members',
  'notifications',
  'autonomyDefaults',
  'apiKeys',
  'theme',
  'language',
  'path',
  'cli',
  'security',
  'about',
] as const;

export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'notifications';

const HASH_PREFIX = '#settings/';

function isSettingsTabKey(value: string): value is SettingsTabKey {
  return (SETTINGS_TAB_KEYS as readonly string[]).includes(value);
}

/**
 * Read the current tab from `window.location.hash`. Falls back to the
 * default tab for hash that does not match `#settings/<known-key>`.
 */
function readHashTab(): SettingsTabKey {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS_TAB;
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return DEFAULT_SETTINGS_TAB;
  const key = hash.slice(HASH_PREFIX.length);
  return isSettingsTabKey(key) ? key : DEFAULT_SETTINGS_TAB;
}

function writeHashTab(key: SettingsTabKey): void {
  if (typeof window === 'undefined') return;
  const next = `${HASH_PREFIX}${key}`;
  if (window.location.hash === next) return;
  // history.replaceState avoids polluting the back stack with every
  // tab click — the user's "Back" button should leave Settings, not
  // walk through every tab they hovered.
  window.history.replaceState(null, '', next);
}

export interface SettingsTabsProps {
  /** Optional override of the initial tab — wins over the hash. */
  initialTab?: SettingsTabKey;
  className?: string;
}

export function SettingsTabs({
  initialTab,
  className,
}: SettingsTabsProps): ReactElement {
  const { t } = useTranslation();
  const [active, setActive] = useState<SettingsTabKey>(
    () => initialTab ?? readHashTab(),
  );

  // Keep the URL hash in sync with the active tab.
  useEffect(() => {
    writeHashTab(active);
  }, [active]);

  // React to external hash changes (back/forward, deep-link from a
  // notification, manual edit). We only react when the hash actually
  // points into Settings — a hash like `#approval/123` should not
  // bounce us back to Settings.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = (): void => {
      if (!window.location.hash.startsWith(HASH_PREFIX)) return;
      const next = readHashTab();
      setActive((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleValueChange = useCallback((value: string): void => {
    if (isSettingsTabKey(value)) setActive(value);
  }, []);

  return (
    <div
      data-testid="settings-tabs-root"
      className={className ?? 'flex-1 min-h-0 flex flex-col'}
    >
      <header className="px-6 pt-6 pb-3">
        <h1 className="text-lg font-display font-semibold">
          {t('settings.title')}
        </h1>
        <p className="text-sm text-fg-muted mt-0.5">
          {t('settings.description')}
        </p>
      </header>

      <Tabs
        value={active}
        onValueChange={handleValueChange}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList
          aria-label={t('settings.tabs.label')}
          data-testid="settings-tabs-list"
        >
          {SETTINGS_TAB_KEYS.map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              data-testid="settings-tabs-trigger"
              data-tab={key}
            >
              {t(`settings.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="members">
          <MembersTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="autonomyDefaults">
          <AutonomyDefaultsTab />
        </TabsContent>
        <TabsContent value="apiKeys">
          <ApiKeysTab />
        </TabsContent>
        <TabsContent value="theme">
          <ThemeTab />
        </TabsContent>
        <TabsContent value="language">
          <LanguageTab />
        </TabsContent>
        <TabsContent value="path">
          <PathTab />
        </TabsContent>
        <TabsContent value="cli">
          <CliTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
