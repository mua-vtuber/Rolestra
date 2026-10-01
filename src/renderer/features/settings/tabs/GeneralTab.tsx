/**
 * GeneralTab — settings "일반" (spec 2026-10-01-messenger-redesign.md R5-2):
 * language, theme (preview cards), brightness (light / dark / system), the
 * conversation-log folder (read-only + "폴더 열기") and notifications. The
 * former theme, language, path and notifications tabs live here now; the
 * folder can no longer be changed (the app uses the folder it created).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { NotificationPrefsView } from '../NotificationPrefsView';
import { BrightnessSection } from './general/BrightnessSection';
import { DataFolderSection } from './general/DataFolderSection';
import { LanguageSection } from './general/LanguageSection';
import { ThemeSection } from './general/ThemeSection';

export function GeneralTab(): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="settings-tab-general" className="flex flex-col gap-7">
      <h2 className="font-display text-page-title font-bold">{t('settings.general.title')}</h2>
      <LanguageSection />
      <ThemeSection />
      <BrightnessSection />
      <DataFolderSection />
      <NotificationPrefsView className="max-w-3xl" />
    </section>
  );
}
