/**
 * extract-tokens.ts — D2 B안 구현.
 *
 * tools/theme/theme-source.json 에서 4 테마 토큰 객체를 읽고,
 * 다음 두 파일을 생성한다:
 *
 *   - src/renderer/theme/theme-tokens.ts  (ThemeToken interface + THEMES map)
 *   - src/renderer/styles/tokens.css      (4 블록 + :root 폴백)
 *
 * 생성물은 deterministic — 원본 JSON 이 바뀌지 않는 한 재실행해도 diff 0.
 * theme:check 스크립트가 git diff --exit-code 로 이를 검증.
 *
 * 2026-10-01 (spec 2026-10-01-messenger-redesign.md R1): warm 테마 제거.
 * 테마는 tactical / retro 두 개, :root 폴백은 tactical-dark. 메시지 배치 ·
 * 말풍선 · 귓속말 · 알림 · 이름 색 · 로그 표시 · 화면 덮개 토큰 추가.
 * 원본에 키가 빠지면 조용히 undefined 를 쓰지 않고 이름을 대며 멈춘다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const sourcePath = join(here, 'theme-source.json');
const outTs = join(repoRoot, 'src', 'renderer', 'theme', 'theme-tokens.ts');
const outCss = join(repoRoot, 'src', 'renderer', 'styles', 'tokens.css');

type ThemeKey = 'tactical' | 'retro';
type ThemeMode = 'light' | 'dark';

/** Number of AI name colors every theme provides (`namePalette`). */
const NAME_PALETTE_SIZE = 4;

/**
 * Base type scale in px (2026-10-01 mockups, tactical). Each theme emits
 * `--text-<step>: <base + typeScaleOffset>px`; Tailwind's `text-<step>`
 * classes read those variables. Retro uses -1 because JetBrains Mono and
 * Nanum Gothic Coding draw about 8-14% larger glyphs than IBM Plex Sans KR
 * at the same size (measured 2026-10-01).
 */
const TYPE_SCALE: ReadonlyArray<readonly [step: string, basePx: number]> = [
  ['micro', 11], ['meta', 12], ['preview', 13], ['body', 14], ['row-title', 15],
  ['room-title', 17], ['dialog-title', 20], ['list-title', 22], ['page-title', 24],
];

/** Largest allowed |typeScaleOffset|, so a typo cannot blow up the scale. */
const MAX_TYPE_SCALE_OFFSET = 2;

interface RawTheme {
  themeKey: ThemeKey;
  mode: ThemeMode;
  font: string;
  displayFont: string;
  monoFont: string;
  bgCanvas: string;
  bgElev: string;
  bgSunk: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  border: string;
  borderSoft: string;
  brand: string;
  brandDeep: string;
  brandFg: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  brandText: string;
  dangerText: string;
  avatarShape: 'hexagon' | 'status';
  useLineIcons: boolean;
  railBg: string;
  railExtra: Record<string, string>;
  logoBg: string;
  logoFg: string;
  logoShadow: string;
  iconFg: string;
  iconActiveBg: string;
  iconActiveFg: string;
  iconActiveShadow: string;
  badgeBg: string;
  badgeFg: string;
  unreadBg: string;
  unreadFg: string;
  projectBg: string;
  itemActiveBg: string;
  itemActiveFg: string;
  topBarBg: string;
  topBarBorder: string;
  heroBg: string;
  heroBorder: string;
  heroValue: string;
  heroLabel: string;
  panelBg: string;
  panelHeaderBg: string;
  panelBorder: string;
  panelShadow: string;
  panelRadius: number;
  panelClip: string;
  insightBg: string;
  insightColor: string;
  insightBorder: string;
  actionPrimaryBg: string;
  actionPrimaryFg: string;
  actionSecondaryBg: string;
  actionSecondaryFg: string;
  actionSecondaryBorder: string;
  cardTitleStyle: 'bar' | 'ascii';
  approvalBodyStyle: 'plain' | 'quote';
  miniBtnStyle: 'notched' | 'text';
  gaugeGlow: number;
  messengerHeaderPolicy: 'stacked' | 'mono-prefix';
  badgeRadius: 'square';
  messageLayout: 'bubbles' | 'log';
  titlePrefix: string;
  typeScaleOffset: number;
  bubbleMineBg: string;
  bubbleMineFg: string;
  bubbleMineBorder: string;
  bubbleOtherBg: string;
  bubbleOtherBorder: string;
  bubbleMineClip: string;
  bubbleOtherClip: string;
  avatarClip: string;
  controlClip: string;
  whisperFg: string;
  whisperBorder: string;
  whisperBg: string;
  noticeBg: string;
  noticeFg: string;
  namePalette: string[];
  namePaletteFg: string;
  logMark: string;
  screenOverlay: string;
}

interface ThemeSource {
  themeTacticalLight: RawTheme;
  themeTacticalDark: RawTheme;
  themeRetroLight: RawTheme;
  themeRetroDark: RawTheme;
  BODY_FONT: string;
  DISPLAY_FONT: string;
  MONO_FONT: string;
}

/** Output key order for the generated TS objects — also the required-key list. */
const KEY_ORDER: ReadonlyArray<keyof RawTheme> = [
  'themeKey', 'mode',
  'font', 'displayFont', 'monoFont',
  'bgCanvas', 'bgElev', 'bgSunk',
  'fg', 'fgMuted', 'fgSubtle',
  'border', 'borderSoft',
  'brand', 'brandDeep', 'brandFg', 'accent', 'success', 'warning', 'danger',
  'brandText', 'dangerText',
  'avatarShape', 'useLineIcons',
  'railBg', 'railExtra',
  'logoBg', 'logoFg', 'logoShadow',
  'iconFg', 'iconActiveBg', 'iconActiveFg', 'iconActiveShadow',
  'badgeBg', 'badgeFg', 'unreadBg', 'unreadFg',
  'projectBg', 'itemActiveBg', 'itemActiveFg',
  'topBarBg', 'topBarBorder',
  'heroBg', 'heroBorder', 'heroValue', 'heroLabel',
  'panelBg', 'panelHeaderBg', 'panelBorder', 'panelShadow', 'panelRadius', 'panelClip',
  'insightBg', 'insightColor', 'insightBorder',
  'actionPrimaryBg', 'actionPrimaryFg',
  'actionSecondaryBg', 'actionSecondaryFg', 'actionSecondaryBorder',
  'cardTitleStyle', 'approvalBodyStyle', 'miniBtnStyle',
  'gaugeGlow',
  'messengerHeaderPolicy', 'badgeRadius',
  'messageLayout', 'titlePrefix', 'typeScaleOffset',
  'bubbleMineBg', 'bubbleMineFg', 'bubbleMineBorder',
  'bubbleOtherBg', 'bubbleOtherBorder',
  'bubbleMineClip', 'bubbleOtherClip', 'avatarClip', 'controlClip',
  'whisperFg', 'whisperBorder', 'whisperBg',
  'noticeBg', 'noticeFg',
  'namePalette', 'namePaletteFg',
  'logMark', 'screenOverlay',
];

const THEME_NAMES = [
  'themeTacticalLight', 'themeTacticalDark',
  'themeRetroLight', 'themeRetroDark',
] as const;

function assertThemeShape(name: string, theme: RawTheme): void {
  const record = theme as unknown as Record<string, unknown>;
  for (const key of KEY_ORDER) {
    if (record[key] === undefined) {
      throw new Error(`theme-source.json: ${name} is missing key "${String(key)}"`);
    }
  }
  const unknownKeys = Object.keys(record).filter(
    (key) => !(KEY_ORDER as ReadonlyArray<string>).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`theme-source.json: ${name} has keys the extractor does not know: ${unknownKeys.join(', ')}`);
  }
  if (!Array.isArray(theme.namePalette) || theme.namePalette.length !== NAME_PALETTE_SIZE) {
    throw new Error(`theme-source.json: ${name}.namePalette must list exactly ${NAME_PALETTE_SIZE} colors`);
  }
  if (!Number.isInteger(theme.typeScaleOffset) || Math.abs(theme.typeScaleOffset) > MAX_TYPE_SCALE_OFFSET) {
    throw new Error(`theme-source.json: ${name}.typeScaleOffset must be an integer between -${MAX_TYPE_SCALE_OFFSET} and ${MAX_TYPE_SCALE_OFFSET}`);
  }
}

function readThemeSource(): ThemeSource {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as ThemeSource;
  const required: Array<keyof ThemeSource> = [
    ...THEME_NAMES,
    'BODY_FONT', 'DISPLAY_FONT', 'MONO_FONT',
  ];
  for (const key of required) {
    if (!(key in source)) {
      throw new Error(`theme-source.json is missing ${String(key)}`);
    }
  }
  for (const name of THEME_NAMES) {
    assertThemeShape(name, source[name]);
  }
  return source;
}

// ─── CSS var 매핑 ─────────────────────────────────────────
// TS 전용 key(enum/boolean/nested object/array)는 여기에서 제외된다.
// namePalette 는 배열이라 renderCssBlock 이 --color-name-1..4 로 따로 쓴다.
const CSS_VAR_MAP: ReadonlyArray<readonly [keyof RawTheme, string]> = [
  ['bgCanvas', '--color-bg-canvas'],
  ['bgElev', '--color-bg-elev'],
  ['bgSunk', '--color-bg-sunk'],
  ['fg', '--color-fg'],
  ['fgMuted', '--color-fg-muted'],
  ['fgSubtle', '--color-fg-subtle'],
  ['border', '--color-border'],
  ['borderSoft', '--color-border-soft'],
  ['brand', '--color-brand'],
  ['brandDeep', '--color-brand-deep'],
  ['brandFg', '--color-brand-fg'],
  ['accent', '--color-accent'],
  ['success', '--color-success'],
  ['warning', '--color-warning'],
  ['danger', '--color-danger'],
  ['brandText', '--color-brand-text'],
  ['dangerText', '--color-danger-text'],
  ['railBg', '--color-rail-bg'],
  ['logoBg', '--color-logo-bg'],
  ['logoFg', '--color-logo-fg'],
  ['logoShadow', '--shadow-logo'],
  ['iconFg', '--color-icon-fg'],
  ['iconActiveBg', '--color-icon-active-bg'],
  ['iconActiveFg', '--color-icon-active-fg'],
  ['iconActiveShadow', '--shadow-icon-active'],
  ['badgeBg', '--color-badge-bg'],
  ['badgeFg', '--color-badge-fg'],
  ['unreadBg', '--color-unread-bg'],
  ['unreadFg', '--color-unread-fg'],
  ['projectBg', '--color-project-bg'],
  ['itemActiveBg', '--color-item-active-bg'],
  ['itemActiveFg', '--color-item-active-fg'],
  ['topBarBg', '--color-topbar-bg'],
  ['topBarBorder', '--color-topbar-border'],
  ['heroBg', '--color-hero-bg'],
  ['heroBorder', '--color-hero-border'],
  ['heroValue', '--color-hero-value'],
  ['heroLabel', '--color-hero-label'],
  ['panelBg', '--color-panel-bg'],
  ['panelHeaderBg', '--color-panel-header-bg'],
  ['panelBorder', '--color-panel-border'],
  ['panelShadow', '--shadow-panel'],
  ['panelClip', '--clip-panel'],
  ['insightBg', '--color-insight-bg'],
  ['insightColor', '--color-insight-fg'],
  ['insightBorder', '--color-insight-border'],
  ['actionPrimaryBg', '--color-action-primary-bg'],
  ['actionPrimaryFg', '--color-action-primary-fg'],
  ['actionSecondaryBg', '--color-action-secondary-bg'],
  ['actionSecondaryFg', '--color-action-secondary-fg'],
  ['actionSecondaryBorder', '--color-action-secondary-border'],
  ['bubbleMineBg', '--color-bubble-mine-bg'],
  ['bubbleMineFg', '--color-bubble-mine-fg'],
  ['bubbleMineBorder', '--color-bubble-mine-border'],
  ['bubbleOtherBg', '--color-bubble-other-bg'],
  ['bubbleOtherBorder', '--color-bubble-other-border'],
  ['bubbleMineClip', '--clip-bubble-mine'],
  ['bubbleOtherClip', '--clip-bubble-other'],
  ['avatarClip', '--clip-avatar'],
  ['controlClip', '--clip-control'],
  ['whisperFg', '--color-whisper-fg'],
  ['whisperBorder', '--color-whisper-border'],
  ['whisperBg', '--color-whisper-bg'],
  ['noticeBg', '--color-notice-bg'],
  ['noticeFg', '--color-notice-fg'],
  ['namePaletteFg', '--color-name-palette-fg'],
  ['logMark', '--color-log-mark'],
  ['screenOverlay', '--overlay-screen'],
];

/** `--color-name-1` … `--color-name-4` — one per `namePalette` entry. */
function namePaletteVar(index: number): string {
  return `--color-name-${index + 1}`;
}

// ─── 출력 ─────────────────────────────────────────────────

function serializeCssValue(key: keyof RawTheme, value: unknown): string {
  if (key === 'panelRadius') {
    return `${value as number}px`;
  }
  return String(value);
}

function renderCssBlock(selector: string, theme: RawTheme): string {
  const lines: string[] = [`${selector} {`];
  lines.push(`  --font-body: ${theme.font};`);
  lines.push(`  --font-display: ${theme.displayFont};`);
  lines.push(`  --font-mono: ${theme.monoFont};`);
  lines.push(`  --radius-panel: ${serializeCssValue('panelRadius', theme.panelRadius)};`);
  lines.push(`  --gauge-glow: ${theme.gaugeGlow};`);
  for (const [step, basePx] of TYPE_SCALE) {
    lines.push(`  --text-${step}: ${basePx + theme.typeScaleOffset}px;`);
  }
  for (const [key, cssVar] of CSS_VAR_MAP) {
    const value = theme[key];
    lines.push(`  ${cssVar}: ${serializeCssValue(key, value)};`);
  }
  theme.namePalette.forEach((color, index) => {
    lines.push(`  ${namePaletteVar(index)}: ${color};`);
  });
  lines.push('}');
  return lines.join('\n');
}

function generateCss(win: ThemeSource): string {
  const header = `/**
 * tokens.css — 4 테마 CSS variable.
 *
 * 자동 생성 — 직접 편집 금지. tools/theme/theme-source.json 를
 * 수정한 뒤 \`npm run theme:build\` 를 다시 돌릴 것.
 *
 * Selector:   :root[data-theme='<theme>'][data-mode='<mode>']
 * Fallback:   :root (tactical-dark 복제 — ThemeProvider 로드 이전 깜빡임 방지)
 */
`;
  const blocks: string[] = [header];
  blocks.push(renderCssBlock(':root', win.themeTacticalDark));
  blocks.push(renderCssBlock(":root[data-theme='tactical'][data-mode='light']", win.themeTacticalLight));
  blocks.push(renderCssBlock(":root[data-theme='tactical'][data-mode='dark']", win.themeTacticalDark));
  blocks.push(renderCssBlock(":root[data-theme='retro'][data-mode='light']", win.themeRetroLight));
  blocks.push(renderCssBlock(":root[data-theme='retro'][data-mode='dark']", win.themeRetroDark));
  return blocks.join('\n\n') + '\n';
}

function tsLiteral(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => tsLiteral(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${tsLiteral(v)}`).join(',\n');
    return `{\n${body.replace(/^/gm, '  ').replace(/^ {2}/, '')}\n  }`;
  }
  throw new Error(`Cannot serialize value of type ${typeof value}`);
}

function renderThemeObject(theme: RawTheme): string {
  const lines: string[] = ['{'];
  for (const key of KEY_ORDER) {
    const value = theme[key];
    lines.push(`    ${key}: ${tsLiteral(value)},`);
  }
  lines.push('  }');
  return lines.join('\n');
}

function generateTs(win: ThemeSource): string {
  return `/**
 * theme-tokens.ts — 4 테마 토큰 TS 정식본.
 *
 * 자동 생성 — 직접 편집 금지. tools/theme/theme-source.json 를
 * 수정한 뒤 \`npm run theme:build\` 를 다시 돌릴 것.
 */

export type ThemeKey = 'tactical' | 'retro';
export type ThemeMode = 'light' | 'dark';
export type ThemeComboKey =
  | 'tactical-light' | 'tactical-dark'
  | 'retro-light' | 'retro-dark';

export type AvatarShape = 'circle' | 'hexagon' | 'status';
export type CardTitleStyle = 'bar' | 'ascii';
export type ApprovalBodyStyle = 'plain' | 'quote';
export type MiniBtnStyle = 'notched' | 'text';
export type MessengerHeaderPolicy = 'stacked' | 'mono-prefix';
export type BadgeRadius = 'square';
/** Message layout: chat bubbles (tactical) or a PC-통신 style log (retro). */
export type MessageLayout = 'bubbles' | 'log';
/** Exactly ${NAME_PALETTE_SIZE} AI name colors, also exposed as \`--color-name-1..${NAME_PALETTE_SIZE}\`. */
export type NamePalette = readonly [string, string, string, string];

export interface ThemeToken {
  themeKey: ThemeKey;
  mode: ThemeMode;
  font: string;
  displayFont: string;
  monoFont: string;
  bgCanvas: string;
  bgElev: string;
  bgSunk: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  border: string;
  borderSoft: string;
  brand: string;
  brandDeep: string;
  brandFg: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  /** Accent color for small text: >= 4.5:1 on every surface (QA Medium-2). */
  brandText: string;
  /** Danger color for small text: >= 4.5:1 on every surface. */
  dangerText: string;
  /** Theme avatar shape. \`'circle'\` is never a theme value — only an explicit component override. */
  avatarShape: Exclude<AvatarShape, 'circle'>;
  useLineIcons: boolean;
  railBg: string;
  railExtra: Record<string, string>;
  logoBg: string;
  logoFg: string;
  logoShadow: string;
  iconFg: string;
  iconActiveBg: string;
  iconActiveFg: string;
  iconActiveShadow: string;
  badgeBg: string;
  badgeFg: string;
  unreadBg: string;
  unreadFg: string;
  projectBg: string;
  itemActiveBg: string;
  itemActiveFg: string;
  topBarBg: string;
  topBarBorder: string;
  heroBg: string;
  heroBorder: string;
  heroValue: string;
  heroLabel: string;
  panelBg: string;
  panelHeaderBg: string;
  panelBorder: string;
  panelShadow: string;
  panelRadius: number;
  panelClip: string;
  insightBg: string;
  insightColor: string;
  insightBorder: string;
  actionPrimaryBg: string;
  actionPrimaryFg: string;
  actionSecondaryBg: string;
  actionSecondaryFg: string;
  actionSecondaryBorder: string;
  cardTitleStyle: CardTitleStyle;
  approvalBodyStyle: ApprovalBodyStyle;
  miniBtnStyle: MiniBtnStyle;
  gaugeGlow: number;
  messengerHeaderPolicy: MessengerHeaderPolicy;
  badgeRadius: BadgeRadius;
  messageLayout: MessageLayout;
  /** Text shown before a screen title (retro \`'> '\`, tactical none). */
  titlePrefix: string;
  /** Pixels added to every step of the type scale (retro -1: its mono fonts draw larger at the same size). */
  typeScaleOffset: number;
  bubbleMineBg: string;
  bubbleMineFg: string;
  bubbleMineBorder: string;
  bubbleOtherBg: string;
  bubbleOtherBorder: string;
  bubbleMineClip: string;
  bubbleOtherClip: string;
  avatarClip: string;
  controlClip: string;
  whisperFg: string;
  whisperBorder: string;
  whisperBg: string;
  noticeBg: string;
  noticeFg: string;
  namePalette: NamePalette;
  namePaletteFg: string;
  logMark: string;
  screenOverlay: string;
}

export const FONTS = {
  body: ${JSON.stringify(win.BODY_FONT)},
  display: ${JSON.stringify(win.DISPLAY_FONT)},
  mono: ${JSON.stringify(win.MONO_FONT)},
} as const;

export const THEMES: Record<ThemeComboKey, ThemeToken> = {
  'tactical-light': ${renderThemeObject(win.themeTacticalLight)},
  'tactical-dark': ${renderThemeObject(win.themeTacticalDark)},
  'retro-light': ${renderThemeObject(win.themeRetroLight)},
  'retro-dark': ${renderThemeObject(win.themeRetroDark)},
};

export const THEME_MATRIX: ReadonlyArray<{
  key: ThemeComboKey;
  themeKey: ThemeKey;
  mode: ThemeMode;
  label: string;
}> = [
  { key: 'tactical-light', themeKey: 'tactical', mode: 'light', label: 'Tactical · Light' },
  { key: 'retro-light',    themeKey: 'retro',    mode: 'light', label: 'Retro · Light' },
  { key: 'tactical-dark',  themeKey: 'tactical', mode: 'dark',  label: 'Tactical · Dark' },
  { key: 'retro-dark',     themeKey: 'retro',    mode: 'dark',  label: 'Retro · Dark' },
];

export function comboKey(themeKey: ThemeKey, mode: ThemeMode): ThemeComboKey {
  return \`\${themeKey}-\${mode}\` as ThemeComboKey;
}
`;
}

function main(): void {
  const win = readThemeSource();
  writeFileSync(outTs, generateTs(win));
  writeFileSync(outCss, generateCss(win));
  console.log(`theme:build — wrote ${outTs} + ${outCss}`);
}

main();
