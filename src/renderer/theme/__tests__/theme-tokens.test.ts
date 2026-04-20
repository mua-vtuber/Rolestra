import { describe, expect, it } from 'vitest';

import {
  FONTS,
  THEMES,
  THEME_MATRIX,
  comboKey,
  type ThemeComboKey,
  type ThemeToken,
} from '../theme-tokens';

const EXPECTED_COMBO_KEYS: ReadonlyArray<ThemeComboKey> = [
  'warm-light',
  'warm-dark',
  'tactical-light',
  'tactical-dark',
  'retro-light',
  'retro-dark',
];

const REQUIRED_TOKEN_FIELDS: ReadonlyArray<keyof ThemeToken> = [
  'themeKey',
  'mode',
  'font',
  'displayFont',
  'monoFont',
  'bgCanvas',
  'bgElev',
  'bgSunk',
  'fg',
  'fgMuted',
  'fgSubtle',
  'border',
  'borderSoft',
  'brand',
  'brandDeep',
  'accent',
  'success',
  'warning',
  'danger',
  'avatarShape',
  'useLineIcons',
  'railBg',
  'railExtra',
  'logoBg',
  'logoFg',
  'logoShadow',
  'iconFg',
  'iconActiveBg',
  'iconActiveFg',
  'iconActiveShadow',
  'badgeBg',
  'badgeFg',
  'unreadBg',
  'unreadFg',
  'projectBg',
  'itemActiveBg',
  'itemActiveFg',
  'topBarBg',
  'topBarBorder',
  'heroBg',
  'heroBorder',
  'heroValue',
  'heroLabel',
  'panelBg',
  'panelHeaderBg',
  'panelBorder',
  'panelShadow',
  'panelRadius',
  'panelClip',
  'insightBg',
  'insightColor',
  'insightBorder',
  'actionPrimaryBg',
  'actionPrimaryFg',
  'actionSecondaryBg',
  'actionSecondaryFg',
  'actionSecondaryBorder',
  'cardTitleStyle',
  'approvalBodyStyle',
  'miniBtnStyle',
  'gaugeGlow',
];

describe('theme-tokens — 6 combo matrix', () => {
  it('exposes exactly six combo keys', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it('THEME_MATRIX lists all six combos once', () => {
    const keys = THEME_MATRIX.map((entry) => entry.key).sort();
    expect(keys).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it.each(EXPECTED_COMBO_KEYS)('%s token has all 60 required schema fields', (key) => {
    const token = THEMES[key];
    for (const field of REQUIRED_TOKEN_FIELDS) {
      expect(token, `missing ${String(field)} on ${key}`).toHaveProperty(field);
    }
    expect(comboKey(token.themeKey, token.mode)).toBe(key);
  });

  it('comboKey() joins theme and mode', () => {
    expect(comboKey('warm', 'light')).toBe('warm-light');
    expect(comboKey('tactical', 'dark')).toBe('tactical-dark');
    expect(comboKey('retro', 'light')).toBe('retro-light');
  });

  it('FONTS constants are non-empty fallback stacks', () => {
    expect(FONTS.body).toMatch(/sans-serif|system-ui|Inter/);
    expect(FONTS.display).toMatch(/sans-serif|Grotesk|IBM Plex/);
    expect(FONTS.mono).toMatch(/monospace|Mono/);
  });

  it('theme tokens contain no gamification words', () => {
    const blob = JSON.stringify(THEMES);
    expect(blob).not.toMatch(/\b(XP|CREDITS|LV|MISSION|REWARD|UNLOCK)\b/);
  });

  it('light and dark variants of a theme share the same themeKey', () => {
    expect(THEMES['warm-light'].themeKey).toBe('warm');
    expect(THEMES['warm-dark'].themeKey).toBe('warm');
    expect(THEMES['tactical-light'].themeKey).toBe('tactical');
    expect(THEMES['tactical-dark'].themeKey).toBe('tactical');
    expect(THEMES['retro-light'].themeKey).toBe('retro');
    expect(THEMES['retro-dark'].themeKey).toBe('retro');
  });
});
