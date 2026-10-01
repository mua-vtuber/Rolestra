/**
 * Theme choice (settings "일반", spec 2026-10-01-messenger-redesign.md R5-2):
 * two preview cards. Tactical previews the bubble layout (other / my /
 * whisper bubble), retro previews the log layout (name line, `└` line,
 * whisper lines in the whisper color).
 *
 * A preview must show the *other* theme while the current one is active,
 * so it reads that theme's values from the token object (`THEMES`, same
 * source as `tokens.css`) for the brightness currently rendered — no
 * color is written here. The preview text describes the layout parts; it
 * is not a sample conversation.
 */
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ChoiceGroup, ChoiceItem } from '../../../../components/primitives/choice-group';
import { LOG_LINE_MARK } from '../../../../theme/log-layout';
import { THEMES, comboKey, type ThemeKey, type ThemeToken } from '../../../../theme/theme-tokens';
import { useTheme } from '../../../../theme/use-theme';
import { SettingsSection } from './SettingsSection';

const THEME_KEYS: readonly ThemeKey[] = ['tactical', 'retro'];

function isThemeKey(value: string): value is ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(value);
}

function themeName(t: TFunction, key: ThemeKey): string {
  switch (key) {
    case 'tactical': return t('settings.general.theme.tactical.name');
    case 'retro': return t('settings.general.theme.retro.name');
  }
}

function themeDescription(t: TFunction, key: ThemeKey): string {
  switch (key) {
    case 'tactical': return t('settings.general.theme.tactical.description');
    case 'retro': return t('settings.general.theme.retro.description');
  }
}

function BubblesPreview({ preview }: { preview: ThemeToken }): ReactElement {
  const { t } = useTranslation();
  const bubble: CSSProperties = { fontFamily: preview.font };
  return (
    <>
      <span className="max-w-40 self-start border px-2.5 py-1.5 text-xs" style={{
        ...bubble, background: preview.bubbleOtherBg, color: preview.fg,
        borderColor: preview.bubbleOtherBorder, clipPath: preview.bubbleOtherClip,
      }}>{t('settings.general.theme.preview.otherBubble')}</span>
      <span className="max-w-40 self-end border px-2.5 py-1.5 text-xs" style={{
        ...bubble, background: preview.bubbleMineBg, color: preview.bubbleMineFg,
        borderColor: preview.bubbleMineBorder, clipPath: preview.bubbleMineClip,
      }}>{t('settings.general.theme.preview.myBubble')}</span>
      <span className="max-w-40 self-start border border-dashed px-2.5 py-1.5 text-xs italic" style={{
        ...bubble, background: preview.whisperBg, color: preview.whisperFg, borderColor: preview.whisperBorder,
      }}>{t('settings.general.theme.preview.whisper')}</span>
    </>
  );
}

function LogPreview({ preview }: { preview: ThemeToken }): ReactElement {
  const { t } = useTranslation();
  const line: CSSProperties = { fontFamily: preview.font };
  return (
    <>
      <span className="block text-xs" style={{ ...line, color: preview.fg }}>
        <span className="font-bold" style={{ color: preview.namePalette[0] }}>
          {t('settings.general.theme.preview.name')}
        </span>
        {` ${t('settings.general.theme.preview.time')}`}
      </span>
      <span className="block text-xs" style={{ ...line, color: preview.fg }}>
        <span aria-hidden="true" style={{ color: preview.logMark }}>{`${LOG_LINE_MARK} `}</span>
        {t('settings.general.theme.preview.line')}
      </span>
      <span className="block text-xs" style={{ ...line, color: preview.whisperFg }}>
        {t('settings.general.theme.preview.whisperRoute')}
      </span>
      <span className="block text-xs" style={{ ...line, color: preview.whisperFg }}>
        <span aria-hidden="true">{`${LOG_LINE_MARK} `}</span>
        {t('settings.general.theme.preview.whisper')}
      </span>
    </>
  );
}

export function ThemeSection(): ReactElement {
  const { t } = useTranslation();
  const { themeKey, mode, setTheme } = useTheme();

  return (
    <SettingsSection title={t('settings.general.theme.title')} testId="settings-theme">
      <ChoiceGroup value={themeKey} aria-label={t('settings.general.theme.title')} className="gap-4"
        onValueChange={(next) => { if (isThemeKey(next)) setTheme(next); }}>
        {THEME_KEYS.map((key) => {
          const preview = THEMES[comboKey(key, mode)];
          return (
            <ChoiceItem key={key} value={key} data-testid="settings-theme-card" data-key={key}
              className="flex w-72 flex-col text-left data-[state=checked]:border-2">
              <span data-testid="settings-theme-preview" data-layout={preview.messageLayout}
                className="flex h-32 w-full flex-col justify-center gap-2 border-b p-3.5"
                style={{ background: preview.bgCanvas, borderColor: preview.borderSoft }}>
                {preview.messageLayout === 'bubbles'
                  ? <BubblesPreview preview={preview} />
                  : <LogPreview preview={preview} />}
              </span>
              <span className="flex flex-col gap-0.5 px-3.5 py-3">
                <span className="text-base font-bold">{themeName(t, key)}</span>
                <span className="text-xs font-normal text-fg-muted">{themeDescription(t, key)}</span>
              </span>
            </ChoiceItem>
          );
        })}
      </ChoiceGroup>
    </SettingsSection>
  );
}
