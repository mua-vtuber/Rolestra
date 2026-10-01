/**
 * SettingsTabs — the settings screen (spec 2026-10-01-messenger-redesign.md
 * R5, SettingsGeneral / SettingsAI mockups).
 *
 * Three tabs in a left menu: 일반 / AI / 정보. The active tab is mirrored to
 * the URL hash (`#settings/<tab>`, see `settings-tab-route.ts`) so other
 * screens can deep-link a tab, and an external hash change (back / forward,
 * `requestSettingsTab`) switches it.
 *
 * The screen owns the AI add dialog (`ProviderConnect`): only the AI tab's
 * "AI 추가" opens it (R5-7; the about tab has no add button — 2026-10-01
 * user decision). After an AI is added, the dialog can hand over to the
 * existing edit dialog (`MemberProfileEditModal`) for its name and
 * character sheet (R6-4).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/primitives/tabs';
import { MemberProfileEditModal } from '../members/MemberProfileEditModal';
import { useTheme } from '../../theme/use-theme';
import { ProviderConnect } from './ProviderConnect';
import {
  SETTINGS_TAB_KEYS,
  isSettingsHash,
  isSettingsTabKey,
  readSettingsTabFromHash,
  settingsTabHash,
  type SettingsTabKey,
} from './settings-tab-route';
import { AboutTab } from './tabs/AboutTab';
import { AiTab } from './tabs/AiTab';
import { GeneralTab } from './tabs/GeneralTab';

export { SETTINGS_TAB_KEYS, DEFAULT_SETTINGS_TAB, type SettingsTabKey } from './settings-tab-route';

function tabLabel(t: TFunction, key: SettingsTabKey): string {
  switch (key) {
    case 'general': return t('settings.tabs.general');
    case 'ai': return t('settings.tabs.ai');
    case 'about': return t('settings.tabs.about');
  }
}

function writeHashTab(key: SettingsTabKey): void {
  const next = settingsTabHash(key);
  if (window.location.hash === next) return;
  // replaceState keeps tab clicks out of the back stack — "Back" should
  // leave settings, not walk through every tab the user looked at.
  window.history.replaceState(null, '', next);
}

export interface SettingsTabsProps {
  /** Optional override of the initial tab — wins over the hash. */
  initialTab?: SettingsTabKey;
  className?: string;
}

const CONTENT_CLASS = 'bg-canvas px-12 py-8';

export function SettingsTabs({ initialTab, className }: SettingsTabsProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const [active, setActive] = useState<SettingsTabKey>(
    () => initialTab ?? readSettingsTabFromHash(window.location.hash),
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<{ providerId: string; displayName: string } | null>(null);

  useEffect(() => {
    writeHashTab(active);
  }, [active]);

  useEffect(() => {
    const onHashChange = (): void => {
      // Only a hash that points into settings moves the tab.
      if (!isSettingsHash(window.location.hash)) return;
      const next = readSettingsTabFromHash(window.location.hash);
      setActive((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleValueChange = useCallback((value: string): void => {
    if (isSettingsTabKey(value)) setActive(value);
  }, []);

  const openAddAi = useCallback((): void => setConnectOpen(true), []);

  return (
    <div data-testid="settings-tabs-root" className={className ?? 'flex min-h-0 flex-1'}>
      <Tabs orientation="vertical" value={active} onValueChange={handleValueChange}
        className="min-h-0 flex-1">
        <aside data-testid="settings-menu"
          className="flex w-60 shrink-0 flex-col gap-1 border-r border-border-soft px-3 py-5 [background:var(--color-panel-bg)]">
          <h1 className="mx-2 mb-3.5 font-display text-list-title font-bold">
            {token.titlePrefix}{t('settings.title')}
          </h1>
          <TabsList aria-label={t('settings.tabs.label')} data-testid="settings-tabs-list">
            {SETTINGS_TAB_KEYS.map((key) => (
              <TabsTrigger key={key} value={key} data-testid="settings-tabs-trigger" data-tab={key}>
                {tabLabel(t, key)}
              </TabsTrigger>
            ))}
          </TabsList>
        </aside>
        <TabsContent value="general" applyPanelClip={false} className={CONTENT_CLASS}>
          <GeneralTab />
        </TabsContent>
        <TabsContent value="ai" applyPanelClip={false} className={CONTENT_CLASS}>
          <AiTab onAddAi={openAddAi} />
        </TabsContent>
        <TabsContent value="about" applyPanelClip={false} className={CONTENT_CLASS}>
          <AboutTab />
        </TabsContent>
      </Tabs>
      {connectOpen ? (
        // ProviderConnect refreshes every roster through the channel
        // invalidation bus on success; nothing else to update here.
        <ProviderConnect open onOpenChange={setConnectOpen} onConnected={() => undefined}
          onEditProfile={(providerId, displayName) => setProfileTarget({ providerId, displayName })} />
      ) : null}
      {profileTarget !== null ? (
        <MemberProfileEditModal open providerId={profileTarget.providerId} displayName={profileTarget.displayName}
          onOpenChange={(open) => { if (!open) setProfileTarget(null); }} />
      ) : null}
    </div>
  );
}
