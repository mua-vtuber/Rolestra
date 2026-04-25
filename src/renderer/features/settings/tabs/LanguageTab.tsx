/**
 * LanguageTab — R10-Task6 user-facing locale switcher.
 *
 * Behaviour
 *   - Reads `i18n.language` to decide which radio is active.
 *   - On change calls `i18n.changeLanguage(locale)` so the React tree
 *     re-renders translated strings; also persists the choice via
 *     `config:update-settings { language }` so the Main-side picks it
 *     up on the next launch and so other surfaces (notification labels)
 *     stay in sync.
 *
 * The plan calls for a paired `notification:set-locale` IPC. That
 * channel is part of Task 14's i18n closeout; Main-side notification
 * label resolution today reads `SettingsConfig.language` at fire time,
 * so updating settings is sufficient until the dedicated channel
 * arrives.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '../../../ipc/invoke';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../../i18n';

export function LanguageTab(): ReactElement {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const current = (i18n.language as SupportedLocale) ?? 'ko';

  const handleChange = async (next: SupportedLocale): Promise<void> => {
    if (next === current) return;
    setPending(true);
    setError(null);
    try {
      await i18n.changeLanguage(next);
      await invoke('config:update-settings', {
        patch: { language: next },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      data-testid="settings-tab-language"
      className="space-y-4 max-w-xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.language.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.language.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-language-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error}
        </div>
      )}

      <fieldset
        data-testid="settings-language-options"
        className="border border-border-soft rounded-panel p-3 space-y-2"
      >
        <legend className="text-xs font-medium text-fg-muted px-1">
          {t('settings.language.label')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LOCALES.map((locale) => {
            const isActive = locale === current;
            return (
              <label
                key={locale}
                data-testid="settings-language-option"
                data-locale={locale}
                data-active={isActive || undefined}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 text-xs border rounded-panel cursor-pointer',
                  isActive
                    ? 'border-brand bg-elev text-fg'
                    : 'border-border-soft text-fg-muted hover:text-fg',
                  pending && 'opacity-60 pointer-events-none',
                )}
              >
                <input
                  type="radio"
                  name="ui-language"
                  value={locale}
                  checked={isActive}
                  onChange={() => {
                    void handleChange(locale);
                  }}
                  className="accent-brand"
                  disabled={pending}
                />
                <span>{t(`settings.language.locale.${locale}`)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
