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
  'messengerHeaderPolicy',
  'badgeRadius',
];

describe('theme-tokens — 6 combo matrix', () => {
  it('exposes exactly six combo keys', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it('THEME_MATRIX lists all six combos once', () => {
    const keys = THEME_MATRIX.map((entry) => entry.key).sort();
    expect(keys).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it.each(EXPECTED_COMBO_KEYS)('%s token has all 62 required schema fields', (key) => {
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

  // R5 Task 1 — messenger discriminator tokens (D4 / D5 downstream decisions
  // rely on these values, so pin them explicitly rather than asserting "any
  // string"). 6 themes × 2 fields = 12 assertions.
  describe('R5 messenger discriminators', () => {
    it('messengerHeaderPolicy — retro uses mono-prefix, warm/tactical stack avatar + header', () => {
      expect(THEMES['warm-light'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['warm-dark'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['tactical-light'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['tactical-dark'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['retro-light'].messengerHeaderPolicy).toBe('mono-prefix');
      expect(THEMES['retro-dark'].messengerHeaderPolicy).toBe('mono-prefix');
    });

    it('badgeRadius — only warm is pill, tactical/retro are square', () => {
      expect(THEMES['warm-light'].badgeRadius).toBe('pill');
      expect(THEMES['warm-dark'].badgeRadius).toBe('pill');
      expect(THEMES['tactical-light'].badgeRadius).toBe('square');
      expect(THEMES['tactical-dark'].badgeRadius).toBe('square');
      expect(THEMES['retro-light'].badgeRadius).toBe('square');
      expect(THEMES['retro-dark'].badgeRadius).toBe('square');
    });
  });
});
