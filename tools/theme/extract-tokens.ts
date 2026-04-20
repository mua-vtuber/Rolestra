/**
 * extract-tokens.ts — D2 B안 구현.
 *
 * docs/Rolestra_sample/theme-tokens.jsx 를 Node vm 컨텍스트에서 실행해
 * 6 테마 토큰 객체(window.themeWarmLight 등)를 읽고, 다음 두 파일을 생성한다:
 *
 *   - src/renderer/theme/theme-tokens.ts  (ThemeToken interface + THEMES map)
 *   - src/renderer/styles/tokens.css      (6 블록 + :root 폴백)
 *
 * 생성물은 deterministic — 시안 jsx 가 바뀌지 않는 한 재실행해도 diff 0.
 * theme:check 스크립트가 git diff --exit-code 로 이를 검증.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const samplePath = join(repoRoot, 'docs', 'Rolestra_sample', 'theme-tokens.jsx');
const outTs = join(repoRoot, 'src', 'renderer', 'theme', 'theme-tokens.ts');
const outCss = join(repoRoot, 'src', 'renderer', 'styles', 'tokens.css');

type ThemeKey = 'warm' | 'tactical' | 'retro';
type ThemeMode = 'light' | 'dark';

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
  accent: string;
  success: string;
  warning: string;
  danger: string;
  avatarShape: 'circle' | 'diamond' | 'status';
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
  cardTitleStyle: 'bar' | 'divider' | 'ascii';
  approvalBodyStyle: 'plain' | 'quote';
  miniBtnStyle: 'pill' | 'notched' | 'text';
  gaugeGlow: number;
}

interface SandboxWindow {
  themeWarmLight: RawTheme;
  themeWarmDark: RawTheme;
  themeTacticalLight: RawTheme;
  themeTacticalDark: RawTheme;
  themeRetroLight: RawTheme;
  themeRetroDark: RawTheme;
  THEME_MATRIX: ReadonlyArray<{ key: string; theme: RawTheme; label: string }>;
  BODY_FONT: string;
  DISPLAY_FONT: string;
  MONO_FONT: string;
}

function evaluateSample(): SandboxWindow {
  const source = readFileSync(samplePath, 'utf8');
  const sandbox = { window: {} as Partial<SandboxWindow> };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: samplePath });
  const win = sandbox.window as SandboxWindow;
  const required: Array<keyof SandboxWindow> = [
    'themeWarmLight', 'themeWarmDark',
    'themeTacticalLight', 'themeTacticalDark',
    'themeRetroLight', 'themeRetroDark',
    'THEME_MATRIX', 'BODY_FONT', 'DISPLAY_FONT', 'MONO_FONT',
  ];
  for (const key of required) {
    if (!(key in win)) {
      throw new Error(`theme-tokens.jsx did not populate window.${String(key)}`);
    }
  }
  return win;
}

// ─── CSS var 매핑 ─────────────────────────────────────────
// TS 전용 key(enum/boolean/nested object)는 여기에서 제외된다.
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
  ['accent', '--color-accent'],
  ['success', '--color-success'],
  ['warning', '--color-warning'],
  ['danger', '--color-danger'],
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
];

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
  for (const [key, cssVar] of CSS_VAR_MAP) {
    const value = theme[key];
    lines.push(`  ${cssVar}: ${serializeCssValue(key, value)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function generateCss(win: SandboxWindow): string {
  const header = `/**
 * tokens.css — 6 테마 CSS variable.
 *
 * 자동 생성 — 직접 편집 금지. docs/Rolestra_sample/theme-tokens.jsx 를
 * 수정한 뒤 \`npm run theme:build\` 를 다시 돌릴 것.
 *
 * Selector:   :root[data-theme='<theme>'][data-mode='<mode>']
 * Fallback:   :root (warm-light 복제 — ThemeProvider 로드 이전 깜빡임 방지)
 */
`;
  const blocks: string[] = [header];
  blocks.push(renderCssBlock(':root', win.themeWarmLight));
  blocks.push(renderCssBlock(":root[data-theme='warm'][data-mode='light']", win.themeWarmLight));
  blocks.push(renderCssBlock(":root[data-theme='warm'][data-mode='dark']", win.themeWarmDark));
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
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${tsLiteral(v)}`).join(',\n');
    return `{\n${body.replace(/^/gm, '  ').replace(/^ {2}/, '')}\n  }`;
  }
  throw new Error(`Cannot serialize value of type ${typeof value}`);
}

function renderThemeObject(theme: RawTheme): string {
  const keyOrder: Array<keyof RawTheme> = [
    'themeKey', 'mode',
    'font', 'displayFont', 'monoFont',
    'bgCanvas', 'bgElev', 'bgSunk',
    'fg', 'fgMuted', 'fgSubtle',
    'border', 'borderSoft',
    'brand', 'brandDeep', 'accent', 'success', 'warning', 'danger',
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
  ];
  const lines: string[] = ['{'];
  for (const key of keyOrder) {
    const value = theme[key];
    lines.push(`    ${key}: ${tsLiteral(value)},`);
  }
  lines.push('  }');
  return lines.join('\n');
}

function generateTs(win: SandboxWindow): string {
  return `/**
 * theme-tokens.ts — 6 테마 토큰 TS 정식본.
 *
 * 자동 생성 — 직접 편집 금지. docs/Rolestra_sample/theme-tokens.jsx 를
 * 수정한 뒤 \`npm run theme:build\` 를 다시 돌릴 것.
 */

export type ThemeKey = 'warm' | 'tactical' | 'retro';
export type ThemeMode = 'light' | 'dark';
export type ThemeComboKey =
  | 'warm-light' | 'warm-dark'
  | 'tactical-light' | 'tactical-dark'
  | 'retro-light' | 'retro-dark';

export type AvatarShape = 'circle' | 'diamond' | 'status';
export type CardTitleStyle = 'bar' | 'divider' | 'ascii';
export type ApprovalBodyStyle = 'plain' | 'quote';
export type MiniBtnStyle = 'pill' | 'notched' | 'text';

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
  accent: string;
  success: string;
  warning: string;
  danger: string;
  avatarShape: AvatarShape;
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
}

export const FONTS = {
  body: ${JSON.stringify(win.BODY_FONT)},
  display: ${JSON.stringify(win.DISPLAY_FONT)},
  mono: ${JSON.stringify(win.MONO_FONT)},
} as const;

export const THEMES: Record<ThemeComboKey, ThemeToken> = {
  'warm-light': ${renderThemeObject(win.themeWarmLight)},
  'warm-dark': ${renderThemeObject(win.themeWarmDark)},
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
  { key: 'warm-light',     themeKey: 'warm',     mode: 'light', label: 'Warm · Light' },
  { key: 'tactical-light', themeKey: 'tactical', mode: 'light', label: 'Tactical · Light' },
  { key: 'retro-light',    themeKey: 'retro',    mode: 'light', label: 'Retro · Light' },
  { key: 'warm-dark',      themeKey: 'warm',     mode: 'dark',  label: 'Warm · Dark' },
  { key: 'tactical-dark',  themeKey: 'tactical', mode: 'dark',  label: 'Tactical · Dark' },
  { key: 'retro-dark',     themeKey: 'retro',    mode: 'dark',  label: 'Retro · Dark' },
];

export function comboKey(themeKey: ThemeKey, mode: ThemeMode): ThemeComboKey {
  return \`\${themeKey}-\${mode}\` as ThemeComboKey;
}
`;
}

function main(): void {
  const win = evaluateSample();
  writeFileSync(outTs, generateTs(win));
  writeFileSync(outCss, generateCss(win));
  // eslint-disable-next-line no-console
  console.log(`theme:build — wrote ${outTs} + ${outCss}`);
}

main();
