/**
 * Language choice (settings "일반"). Switching calls
 * `i18n.changeLanguage` so the screen re-renders, persists the choice via
 * `config:update-settings { language }` for the next launch, and keeps
 * main-process notification labels in step via `notification:set-locale`.
 * A failure is shown under the choices; nothing is retried silently.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ChoiceGroup, ChoiceItem } from '../../../../components/primitives/choice-group';
import { invoke } from '../../../../ipc/invoke';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../../../i18n';
import { SettingsSection } from './SettingsSection';

function localeLabel(t: TFunction, locale: SupportedLocale): string {
  switch (locale) {
    case 'ko': return t('settings.general.language.ko');
    case 'en': return t('settings.general.language.en');
  }
}

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LanguageSection(): ReactElement {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const change = async (next: string): Promise<void> => {
    if (!isSupportedLocale(next) || next === i18n.language) return;
    setPending(true);
    setError(null);
    try {
      await i18n.changeLanguage(next);
      await invoke('config:update-settings', { patch: { language: next } });
      await invoke('notification:set-locale', { locale: next });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection title={t('settings.general.language.title')} testId="settings-language">
      <ChoiceGroup value={i18n.language} onValueChange={(next) => void change(next)}
        aria-label={t('settings.general.language.title')} disabled={pending}>
        {SUPPORTED_LOCALES.map((locale) => (
          <ChoiceItem key={locale} value={locale} data-testid="settings-language-option" data-locale={locale}>
            {localeLabel(t, locale)}
          </ChoiceItem>
        ))}
      </ChoiceGroup>
      {error !== null ? (
        <p data-testid="settings-language-error" role="alert" className="text-xs text-danger-text">
          {t('settings.general.language.failed', { message: error })}
        </p>
      ) : null}
    </SettingsSection>
  );
}
