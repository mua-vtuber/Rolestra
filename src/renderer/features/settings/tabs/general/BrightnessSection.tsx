/**
 * Brightness choice (settings "일반", spec 2026-10-01-messenger-redesign.md
 * R1-2): light, dark, or follow the OS (`prefers-color-scheme`, applied
 * live by `use-system-color-scheme.ts`). The stored preference stays
 * `'system'`; only the rendered mode follows the OS.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ChoiceGroup, ChoiceItem } from '../../../../components/primitives/choice-group';
import type { ThemeModePreference } from '../../../../theme/theme-store';
import { useTheme } from '../../../../theme/use-theme';
import { SettingsSection } from './SettingsSection';

const MODE_PREFERENCES: readonly ThemeModePreference[] = ['light', 'dark', 'system'];

function modeLabel(t: TFunction, mode: ThemeModePreference): string {
  switch (mode) {
    case 'light': return t('settings.general.brightness.light');
    case 'dark': return t('settings.general.brightness.dark');
    case 'system': return t('settings.general.brightness.system');
  }
}

function isModePreference(value: string): value is ThemeModePreference {
  return (MODE_PREFERENCES as readonly string[]).includes(value);
}

export function BrightnessSection(): ReactElement {
  const { t } = useTranslation();
  const { modePreference, setMode } = useTheme();

  return (
    <SettingsSection title={t('settings.general.brightness.title')} testId="settings-brightness">
      <ChoiceGroup value={modePreference} aria-label={t('settings.general.brightness.title')}
        onValueChange={(next) => { if (isModePreference(next)) setMode(next); }}>
        {MODE_PREFERENCES.map((mode) => (
          <ChoiceItem key={mode} value={mode} data-testid="settings-brightness-option" data-mode={mode}>
            {modeLabel(t, mode)}
          </ChoiceItem>
        ))}
      </ChoiceGroup>
    </SettingsSection>
  );
}
