/**
 * ThemeTab — R10-Task6 user-facing theme picker (themeKey × mode).
 *
 * The previous user-facing entry was the DEV-only `DevThemeSwitcher` in
 * the top bar (gated by `import.meta.env.DEV`). R10 promotes the picker
 * to the Settings UI so production builds can switch themes too. The
 * dev switcher stays as a developer convenience.
 *
 * Implementation
 *   - Themes live in `theme-tokens.ts` as a 6-cell matrix
 *     (warm/tactical/retro × light/dark). We split that into two radio
 *     groups (key + mode) so users see the orthogonal axes, instead of
 *     the flat 6-entry select used by DevThemeSwitcher.
 *   - Mutation goes through the local zustand `useTheme` hook (which
 *     persists to localStorage). Settings persistence to the main-side
 *     `config:update-settings` is intentionally omitted here — theme
 *     persistence is renderer-local in v3 (R7-Task7 decision).
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ThemeKey,
  type ThemeMode,
} from '../../../theme/theme-tokens';
import { useTheme } from '../../../theme/use-theme';

const THEME_KEYS: readonly ThemeKey[] = ['warm', 'tactical', 'retro'] as const;
const THEME_MODES: readonly ThemeMode[] = ['light', 'dark'] as const;

export function ThemeTab(): ReactElement {
  const { t } = useTranslation();
  const { themeKey, mode, setTheme, setMode } = useTheme();

  return (
    <section
      data-testid="settings-tab-theme"
      className="space-y-4 max-w-xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.theme.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.theme.description')}
        </p>
      </header>

      <fieldset
        data-testid="settings-theme-key"
        className="border border-border-soft rounded-panel p-3 space-y-2"
      >
        <legend className="text-xs font-medium text-fg-muted px-1">
          {t('settings.theme.key.label')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {THEME_KEYS.map((key) => {
            const isActive = key === themeKey;
            return (
              <label
                key={key}
                data-testid="settings-theme-key-option"
                data-key={key}
                data-active={isActive || undefined}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 text-xs border rounded-panel cursor-pointer',
                  isActive
                    ? 'border-brand bg-elev text-fg'
                    : 'border-border-soft text-fg-muted hover:text-fg',
                )}
              >
                <input
                  type="radio"
                  name="theme-key"
                  value={key}
                  checked={isActive}
                  onChange={() => setTheme(key)}
                  className="accent-brand"
                />
                <span>{t(`settings.theme.key.${key}`)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset
        data-testid="settings-theme-mode"
        className="border border-border-soft rounded-panel p-3 space-y-2"
      >
        <legend className="text-xs font-medium text-fg-muted px-1">
          {t('settings.theme.mode.label')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {THEME_MODES.map((m) => {
            const isActive = m === mode;
            return (
              <label
                key={m}
                data-testid="settings-theme-mode-option"
                data-mode={m}
                data-active={isActive || undefined}
                className={clsx(
                  'inline-flex items-center gap-2 px-3 py-1.5 text-xs border rounded-panel cursor-pointer',
                  isActive
                    ? 'border-brand bg-elev text-fg'
                    : 'border-border-soft text-fg-muted hover:text-fg',
                )}
              >
                <input
                  type="radio"
                  name="theme-mode"
                  value={m}
                  checked={isActive}
                  onChange={() => setMode(m)}
                  className="accent-brand"
                />
                <span>{t(`settings.theme.mode.${m}`)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
