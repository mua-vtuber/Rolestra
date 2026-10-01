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
  'tactical-light',
  'tactical-dark',
  'retro-light',
  'retro-dark',
];

const REQUIRED_TOKEN_FIELDS: ReadonlyArray<keyof ThemeToken> = [
  'themeKey', 'mode', 'font', 'displayFont', 'monoFont',
  'bgCanvas', 'bgElev', 'bgSunk', 'fg', 'fgMuted', 'fgSubtle',
  'border', 'borderSoft',
  'brand', 'brandDeep', 'brandFg', 'accent', 'success', 'warning', 'danger',
  'avatarShape', 'useLineIcons',
  'railBg', 'railExtra', 'logoBg', 'logoFg', 'logoShadow',
  'iconFg', 'iconActiveBg', 'iconActiveFg', 'iconActiveShadow',
  'badgeBg', 'badgeFg', 'unreadBg', 'unreadFg',
  'projectBg', 'itemActiveBg', 'itemActiveFg',
  'topBarBg', 'topBarBorder',
  'heroBg', 'heroBorder', 'heroValue', 'heroLabel',
  'panelBg', 'panelHeaderBg', 'panelBorder', 'panelShadow', 'panelRadius', 'panelClip',
  'insightBg', 'insightColor', 'insightBorder',
  'actionPrimaryBg', 'actionPrimaryFg',
  'actionSecondaryBg', 'actionSecondaryFg', 'actionSecondaryBorder',
  'cardTitleStyle', 'approvalBodyStyle', 'miniBtnStyle', 'gaugeGlow',
  'messengerHeaderPolicy', 'badgeRadius',
  // spec 2026-10-01-messenger-redesign.md R1-3
  'messageLayout', 'titlePrefix',
  'bubbleMineBg', 'bubbleMineFg', 'bubbleMineBorder',
  'bubbleOtherBg', 'bubbleOtherBorder',
  'bubbleMineClip', 'bubbleOtherClip', 'avatarClip', 'controlClip',
  'whisperFg', 'whisperBorder', 'whisperBg',
  'noticeBg', 'noticeFg',
  'namePalette', 'namePaletteFg',
  'logMark', 'screenOverlay',
  // QA Medium-2: small accent / danger text
  'brandText', 'dangerText',
];

// ── WCAG contrast helpers (relative luminance, alpha composited) ────────
type Rgba = readonly [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  if (value === 'transparent') return [0, 0, 0, 0];
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a] = rgba[1].split(',').map((part) => Number(part.trim()));
    return [r, g, b, a ?? 1];
  }
  throw new Error(`not a solid color: ${value}`);
}

function composite(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function luminance(c: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/** Contrast of `text` drawn on `surface`, both laid over the opaque canvas. */
function contrast(text: string, surface: string, canvas: string): number {
  const base = parseColor(canvas);
  const bg = composite(parseColor(surface), base);
  const fg = composite(parseColor(text), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BODY_TEXT_MIN_CONTRAST = 4.5;

/** A surface the contrast helpers can read (gradients are checked through their solid stops elsewhere). */
function isSolid(value: string): boolean {
  return !value.includes('gradient');
}

describe('theme-tokens — 4 combo matrix (warm removed)', () => {
  it('exposes exactly the tactical and retro combos', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it('THEME_MATRIX lists all four combos once', () => {
    const keys = THEME_MATRIX.map((entry) => entry.key).sort();
    expect(keys).toEqual([...EXPECTED_COMBO_KEYS].sort());
  });

  it.each(EXPECTED_COMBO_KEYS)('%s token has every schema field', (key) => {
    const token = THEMES[key];
    for (const field of REQUIRED_TOKEN_FIELDS) {
      expect(token, `missing ${String(field)} on ${key}`).toHaveProperty(field);
      expect(token[field], `${String(field)} on ${key}`).not.toBeUndefined();
    }
    expect(comboKey(token.themeKey, token.mode)).toBe(key);
  });

  it('comboKey() joins theme and mode', () => {
    expect(comboKey('tactical', 'dark')).toBe('tactical-dark');
    expect(comboKey('retro', 'light')).toBe('retro-light');
  });

  it('FONTS constants are non-empty fallback stacks', () => {
    expect(FONTS.body).toMatch(/sans-serif|system-ui|Inter/);
    expect(FONTS.display).toMatch(/sans-serif|Grotesk|IBM Plex/);
    expect(FONTS.mono).toMatch(/monospace|Mono/);
  });

  // 2026-10-01 user request: the mockup stacks, all fonts bundled (src/renderer/fonts.ts).
  it('uses the mockup font stacks — tactical Plex KR / Space Grotesk, retro all mono', () => {
    const body = "'IBM Plex Sans KR', 'IBM Plex Sans', sans-serif";
    const display = "'Space Grotesk', 'IBM Plex Sans KR', sans-serif";
    const mono = "'JetBrains Mono', 'Nanum Gothic Coding', monospace";
    for (const mode of ['light', 'dark'] as const) {
      const tactical = THEMES[comboKey('tactical', mode)];
      expect([tactical.font, tactical.displayFont, tactical.monoFont]).toEqual([body, display, mono]);
      const retro = THEMES[comboKey('retro', mode)];
      expect([retro.font, retro.displayFont, retro.monoFont]).toEqual([mono, mono, mono]);
    }
  });

  it('theme tokens contain no gamification words', () => {
    const blob = JSON.stringify(THEMES);
    expect(blob).not.toMatch(/\b(XP|CREDITS|LV|MISSION|REWARD|UNLOCK)\b/);
  });

  it('light and dark variants of a theme share the same themeKey', () => {
    expect(THEMES['tactical-light'].themeKey).toBe('tactical');
    expect(THEMES['tactical-dark'].themeKey).toBe('tactical');
    expect(THEMES['retro-light'].themeKey).toBe('retro');
    expect(THEMES['retro-dark'].themeKey).toBe('retro');
  });

  describe('R5 messenger discriminators', () => {
    it('messengerHeaderPolicy — retro uses mono-prefix, tactical stacks avatar + header', () => {
      expect(THEMES['tactical-light'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['tactical-dark'].messengerHeaderPolicy).toBe('stacked');
      expect(THEMES['retro-light'].messengerHeaderPolicy).toBe('mono-prefix');
      expect(THEMES['retro-dark'].messengerHeaderPolicy).toBe('mono-prefix');
    });

    it('badgeRadius — every remaining theme is square', () => {
      for (const key of EXPECTED_COMBO_KEYS) expect(THEMES[key].badgeRadius).toBe('square');
    });
  });

  describe('R1-3 message layout + shape tokens', () => {
    it('tactical is a bubble messenger with a hexagon avatar; retro is a log with no avatar', () => {
      for (const mode of ['light', 'dark'] as const) {
        const tactical = THEMES[comboKey('tactical', mode)];
        expect(tactical.messageLayout).toBe('bubbles');
        expect(tactical.avatarShape).toBe('hexagon');
        expect(tactical.avatarClip).toMatch(/^polygon\(/);
        expect(tactical.bubbleMineClip).toMatch(/^polygon\(/);
        expect(tactical.bubbleOtherClip).toMatch(/^polygon\(/);
        expect(tactical.controlClip).toMatch(/^polygon\(/);
        expect(tactical.titlePrefix).toBe('');

        const retro = THEMES[comboKey('retro', mode)];
        expect(retro.messageLayout).toBe('log');
        expect(retro.avatarShape).toBe('status');
        expect(retro.avatarClip).toBe('none');
        expect(retro.bubbleMineClip).toBe('none');
        expect(retro.bubbleOtherClip).toBe('none');
        expect(retro.controlClip).toBe('none');
        expect(retro.titlePrefix).toBe('> ');
      }
    });

    it('only retro dark draws the scanline overlay', () => {
      expect(THEMES['retro-dark'].screenOverlay).toMatch(/^repeating-linear-gradient\(/);
      expect(THEMES['retro-light'].screenOverlay).toBe('none');
      expect(THEMES['tactical-light'].screenOverlay).toBe('none');
      expect(THEMES['tactical-dark'].screenOverlay).toBe('none');
    });

    it('every theme lists exactly four AI name colors', () => {
      for (const key of EXPECTED_COMBO_KEYS) expect(THEMES[key].namePalette).toHaveLength(4);
    });

    it('retro dark names leave out the user green and the whisper amber', () => {
      const retroDark = THEMES['retro-dark'];
      expect([...retroDark.namePalette]).toEqual(['#7fd6e0', '#e8d27a', '#c9a8ff', '#e08a63']);
      expect(retroDark.namePalette).not.toContain(retroDark.brand);
      expect(retroDark.namePalette).not.toContain(retroDark.whisperFg);
    });

    it('retro light is grayscale; only the whisper tokens carry a color (#9a5000)', () => {
      const retroLight = THEMES['retro-light'] as unknown as Record<string, unknown>;
      expect(retroLight.whisperFg).toBe('#9a5000');
      expect(retroLight.whisperBorder).toBe('#9a5000');
      const colored: string[] = [];
      for (const [field, value] of Object.entries(retroLight)) {
        if (field.startsWith('whisper')) continue;
        const values: unknown[] = Array.isArray(value)
          ? value
          : value !== null && typeof value === 'object' ? Object.values(value) : [value];
        for (const item of values) {
          if (typeof item !== 'string') continue;
          for (const hex of item.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []) {
            const [r, g, b] = parseColor(hex);
            if (!(r === g && g === b)) colored.push(`${field}=${hex}`);
          }
        }
      }
      expect(colored).toEqual([]);
    });
  });

  describe('body text contrast >= 4.5:1', () => {
    it.each(EXPECTED_COMBO_KEYS)('%s', (key) => {
      const t = THEMES[key];
      const pairs: Array<[string, string, string]> = [
        ['fg on canvas', t.fg, t.bgCanvas],
        ['muted on canvas', t.fgMuted, t.bgCanvas],
        ['my bubble text', t.bubbleMineFg, t.bubbleMineBg],
        ['other bubble text', t.fg, t.bubbleOtherBg],
        ['whisper text', t.whisperFg, t.whisperBg],
        ['whisper text on canvas', t.whisperFg, t.bgCanvas],
        ['notice text', t.noticeFg, t.noticeBg],
        ...t.namePalette.map((color, i): [string, string, string] => [`name ${i + 1} on canvas`, color, t.bgCanvas]),
        ...t.namePalette.map((color, i): [string, string, string] => [`palette text on name ${i + 1}`, t.namePaletteFg, color]),
      ];
      for (const [label, text, surface] of pairs) {
        expect(contrast(text, surface, t.bgCanvas), `${key}: ${label}`)
          .toBeGreaterThanOrEqual(BODY_TEXT_MIN_CONTRAST);
      }
    });
  });

  // QA Medium-2: small accent and danger text, and text on the accent fill.
  describe('accent, danger and on-accent text contrast >= 4.5:1', () => {
    it.each(EXPECTED_COMBO_KEYS)('%s', (key) => {
      const t = THEMES[key];
      const surfaces: Array<[string, string]> = ([
        ['canvas', t.bgCanvas], ['raised', t.bgElev], ['sunk', t.bgSunk], ['panel', t.panelBg],
        ['selected item', t.itemActiveBg], ['notice', t.noticeBg],
      ] as Array<[string, string]>).filter(([, surface]) => isSolid(surface));
      const pairs: Array<[string, string, string]> = [
        ...surfaces.map(([name, surface]): [string, string, string] => [`brandText on ${name}`, t.brandText, surface]),
        ...surfaces.map(([name, surface]): [string, string, string] => [`dangerText on ${name}`, t.dangerText, surface]),
        ['brandFg on brand', t.brandFg, t.brand],
        ['unread count on its badge', t.unreadFg, t.unreadBg],
      ];
      for (const [label, text, surface] of pairs) {
        expect(contrast(text, surface, t.bgCanvas), `${key}: ${label}`)
          .toBeGreaterThanOrEqual(BODY_TEXT_MIN_CONTRAST);
      }
    });
  });
});
