/**
 * theme-tokens.ts — 6 테마 토큰 TS 정식본.
 *
 * 자동 생성 — 직접 편집 금지. docs/Rolestra_sample/theme-tokens.jsx 를
 * 수정한 뒤 `npm run theme:build` 를 다시 돌릴 것.
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
  body: "\"IBM Plex Sans\", \"Inter\", system-ui, sans-serif",
  display: "\"Space Grotesk\", \"IBM Plex Sans\", sans-serif",
  mono: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
} as const;

export const THEMES: Record<ThemeComboKey, ThemeToken> = {
  'warm-light': {
    themeKey: "warm",
    mode: "light",
    font: "\"IBM Plex Sans\", \"Inter\", system-ui, sans-serif",
    displayFont: "\"Space Grotesk\", \"IBM Plex Sans\", sans-serif",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#f7f1e6",
    bgElev: "#ffffff",
    bgSunk: "#fdf7ea",
    fg: "#2d1f11",
    fgMuted: "#7a6a55",
    fgSubtle: "#a79880",
    border: "#ecd9bd",
    borderSoft: "#f4ead8",
    brand: "#c96f3a",
    brandDeep: "#a44e1f",
    accent: "#d4913f",
    success: "#4f9d66",
    warning: "#e0a04c",
    danger: "#c85a5a",
    avatarShape: "circle",
    useLineIcons: false,
    railBg: "#efe2ca",
    railExtra: {
  "borderRight": "1px solid #e4d0ad"
  },
    logoBg: "#c96f3a",
    logoFg: "#fff",
    logoShadow: "0 1px 2px rgba(45,31,17,0.12)",
    iconFg: "#8f7a5a",
    iconActiveBg: "#ffffff",
    iconActiveFg: "#c96f3a",
    iconActiveShadow: "0 1px 4px rgba(45,31,17,0.08)",
    badgeBg: "#c85a5a",
    badgeFg: "#fff",
    unreadBg: "#c96f3a",
    unreadFg: "#fff",
    projectBg: "#fff8ec",
    itemActiveBg: "#fff1de",
    itemActiveFg: "#2d1f11",
    topBarBg: "#fffaf3",
    topBarBorder: "#ecd9bd",
    heroBg: "linear-gradient(135deg, #fff1de 0%, #fde8ce 100%)",
    heroBorder: "#f0d2a8",
    heroValue: "#cc7a34",
    heroLabel: "#7a6a55",
    panelBg: "#ffffff",
    panelHeaderBg: "#fff8ef",
    panelBorder: "#ecd9bd",
    panelShadow: "0 1px 3px rgba(45,31,17,0.04)",
    panelRadius: 12,
    panelClip: "none",
    insightBg: "#f8f3ea",
    insightColor: "#7e705d",
    insightBorder: "#eadbc0",
    actionPrimaryBg: "#c96f3a",
    actionPrimaryFg: "#fff",
    actionSecondaryBg: "#fff",
    actionSecondaryFg: "#c96f3a",
    actionSecondaryBorder: "#e6bf8f",
    cardTitleStyle: "divider",
    approvalBodyStyle: "plain",
    miniBtnStyle: "pill",
    gaugeGlow: 0,
  },
  'warm-dark': {
    themeKey: "warm",
    mode: "dark",
    font: "\"IBM Plex Sans\", \"Inter\", system-ui, sans-serif",
    displayFont: "\"Space Grotesk\", \"IBM Plex Sans\", sans-serif",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#1f1611",
    bgElev: "#2a1f14",
    bgSunk: "#18110c",
    fg: "#f4ead8",
    fgMuted: "#c2a985",
    fgSubtle: "#8a7458",
    border: "#3f2e1e",
    borderSoft: "#2a1f14",
    brand: "#d4913f",
    brandDeep: "#a86d28",
    accent: "#e8b568",
    success: "#7dbe92",
    warning: "#e8b568",
    danger: "#d97066",
    avatarShape: "circle",
    useLineIcons: false,
    railBg: "#18110c",
    railExtra: {
  "borderRight": "1px solid #2f2418"
  },
    logoBg: "#d4913f",
    logoFg: "#1f1611",
    logoShadow: "0 1px 2px rgba(0,0,0,0.5)",
    iconFg: "#8a7458",
    iconActiveBg: "#2a1f14",
    iconActiveFg: "#f4ead8",
    iconActiveShadow: "inset 0 0 0 1px #4a3724",
    badgeBg: "#d97066",
    badgeFg: "#1f1611",
    unreadBg: "#d4913f",
    unreadFg: "#1f1611",
    projectBg: "#15100b",
    itemActiveBg: "#3a2a1c",
    itemActiveFg: "#f4ead8",
    topBarBg: "#241911",
    topBarBorder: "#3f2e1e",
    heroBg: "linear-gradient(135deg, #3a2a1c 0%, #2a1f14 60%, #241911 100%)",
    heroBorder: "#4a3724",
    heroValue: "#f4ead8",
    heroLabel: "#c2a985",
    panelBg: "#2a1f14",
    panelHeaderBg: "#241911",
    panelBorder: "#3f2e1e",
    panelShadow: "0 1px 3px rgba(0,0,0,0.3)",
    panelRadius: 12,
    panelClip: "none",
    insightBg: "#241911",
    insightColor: "#c2a985",
    insightBorder: "#3f2e1e",
    actionPrimaryBg: "#d4913f",
    actionPrimaryFg: "#1f1611",
    actionSecondaryBg: "#241911",
    actionSecondaryFg: "#f4ead8",
    actionSecondaryBorder: "#4a3724",
    cardTitleStyle: "divider",
    approvalBodyStyle: "plain",
    miniBtnStyle: "pill",
    gaugeGlow: 0,
  },
  'tactical-light': {
    themeKey: "tactical",
    mode: "light",
    font: "\"IBM Plex Sans\", \"Inter\", system-ui, sans-serif",
    displayFont: "\"Space Grotesk\", \"IBM Plex Sans\", sans-serif",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#eef2f8",
    bgElev: "#ffffff",
    bgSunk: "#f3f6fa",
    fg: "#0e1e33",
    fgMuted: "#546c8a",
    fgSubtle: "#8ba0bd",
    border: "#c6d3e3",
    borderSoft: "#dde5ef",
    brand: "#0084c7",
    brandDeep: "#006596",
    accent: "#0ea5c4",
    success: "#2e9968",
    warning: "#c77b1a",
    danger: "#d4456e",
    avatarShape: "diamond",
    useLineIcons: true,
    railBg: "#e4ebf3",
    railExtra: {
  "borderRight": "1px solid #c6d3e3"
  },
    logoBg: "#ffffff",
    logoFg: "#0084c7",
    logoShadow: "inset 0 0 0 1px #0084c7, 0 1px 3px rgba(14,30,51,0.06)",
    iconFg: "#7d90ac",
    iconActiveBg: "#ffffff",
    iconActiveFg: "#0084c7",
    iconActiveShadow: "inset 0 0 0 1px rgba(0,132,199,0.4), 0 1px 3px rgba(14,30,51,0.06)",
    badgeBg: "#d4456e",
    badgeFg: "#fff",
    unreadBg: "#0084c7",
    unreadFg: "#fff",
    projectBg: "#f3f6fa",
    itemActiveBg: "#e1eef7",
    itemActiveFg: "#0e1e33",
    topBarBg: "#ffffff",
    topBarBorder: "#c6d3e3",
    heroBg: "linear-gradient(135deg, #ffffff 0%, #eaf2fa 100%)",
    heroBorder: "#bcd0e3",
    heroValue: "#0e1e33",
    heroLabel: "#546c8a",
    panelBg: "#ffffff",
    panelHeaderBg: "#f3f6fa",
    panelBorder: "#c6d3e3",
    panelShadow: "0 1px 3px rgba(14,30,51,0.04)",
    panelRadius: 0,
    panelClip: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
    insightBg: "#f3f6fa",
    insightColor: "#546c8a",
    insightBorder: "#c6d3e3",
    actionPrimaryBg: "#0084c7",
    actionPrimaryFg: "#fff",
    actionSecondaryBg: "#ffffff",
    actionSecondaryFg: "#0084c7",
    actionSecondaryBorder: "#bcd0e3",
    cardTitleStyle: "bar",
    approvalBodyStyle: "plain",
    miniBtnStyle: "notched",
    gaugeGlow: 0.4,
  },
  'tactical-dark': {
    themeKey: "tactical",
    mode: "dark",
    font: "\"IBM Plex Sans\", \"Inter\", system-ui, sans-serif",
    displayFont: "\"Space Grotesk\", \"IBM Plex Sans\", sans-serif",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#0e1622",
    bgElev: "linear-gradient(180deg, rgba(24,36,54,0.94) 0%, rgba(17,27,43,0.92) 100%)",
    bgSunk: "rgba(8,15,26,0.9)",
    fg: "#f3f9ff",
    fgMuted: "#9fb6d0",
    fgSubtle: "#6a87a9",
    border: "rgba(103,175,255,0.28)",
    borderSoft: "rgba(103,175,255,0.14)",
    brand: "#61c8ff",
    brandDeep: "#2896e6",
    accent: "#b5f0ff",
    success: "#7de5a8",
    warning: "#ffd166",
    danger: "#ff7da6",
    avatarShape: "diamond",
    useLineIcons: true,
    railBg: "linear-gradient(180deg, #091320 0%, #050b14 100%)",
    railExtra: {
  "borderRight": "1px solid rgba(103,175,255,0.16)"
  },
    logoBg: "rgba(97,200,255,0.08)",
    logoFg: "#8fe7ff",
    logoShadow: "inset 0 0 0 1px rgba(97,200,255,0.7), 0 0 14px rgba(97,200,255,0.25)",
    iconFg: "#6c88aa",
    iconActiveBg: "rgba(97,200,255,0.12)",
    iconActiveFg: "#8fe7ff",
    iconActiveShadow: "inset 0 0 0 1px rgba(97,200,255,0.55), 0 0 14px rgba(97,200,255,0.24)",
    badgeBg: "#ff7da6",
    badgeFg: "#07111d",
    unreadBg: "#61c8ff",
    unreadFg: "#07111d",
    projectBg: "linear-gradient(180deg, rgba(7,15,27,0.95) 0%, rgba(8,14,24,0.88) 100%)",
    itemActiveBg: "rgba(97,200,255,0.12)",
    itemActiveFg: "#e9f7ff",
    topBarBg: "linear-gradient(180deg, rgba(18,30,48,0.94), rgba(9,17,28,0.88))",
    topBarBorder: "rgba(103,175,255,0.22)",
    heroBg: "linear-gradient(135deg, rgba(38,60,91,0.92), rgba(18,30,48,0.94) 42%, rgba(12,20,33,0.92) 100%)",
    heroBorder: "rgba(103,175,255,0.24)",
    heroValue: "#f3f9ff",
    heroLabel: "#9fb6d0",
    panelBg: "linear-gradient(180deg, rgba(24,36,54,0.94), rgba(17,27,43,0.92))",
    panelHeaderBg: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(97,200,255,0.03))",
    panelBorder: "rgba(103,175,255,0.22)",
    panelShadow: "inset 0 0 0 1px rgba(103,175,255,0.08), 0 0 22px rgba(97,200,255,0.14)",
    panelRadius: 0,
    panelClip: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
    insightBg: "rgba(255,255,255,0.04)",
    insightColor: "#9fb6d0",
    insightBorder: "rgba(103,175,255,0.16)",
    actionPrimaryBg: "rgba(97,200,255,0.16)",
    actionPrimaryFg: "#8fe7ff",
    actionSecondaryBg: "rgba(255,255,255,0.04)",
    actionSecondaryFg: "#f3f9ff",
    actionSecondaryBorder: "rgba(103,175,255,0.22)",
    cardTitleStyle: "bar",
    approvalBodyStyle: "plain",
    miniBtnStyle: "notched",
    gaugeGlow: 1,
  },
  'retro-light': {
    themeKey: "retro",
    mode: "light",
    font: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    displayFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#f4ecd6",
    bgElev: "#fbf4df",
    bgSunk: "#ede2c6",
    fg: "#3c2a14",
    fgMuted: "#6b4a2a",
    fgSubtle: "#a48860",
    border: "#c7a87a",
    borderSoft: "#d8bf92",
    brand: "#8a4a00",
    brandDeep: "#5c3000",
    accent: "#b35c00",
    success: "#4c7a2c",
    warning: "#8a4a00",
    danger: "#9e3a1f",
    avatarShape: "status",
    useLineIcons: true,
    railBg: "#e8d9b2",
    railExtra: {
  "borderRight": "1px solid #c7a87a"
  },
    logoBg: "transparent",
    logoFg: "#8a4a00",
    logoShadow: "inset 0 0 0 1px #8a4a00",
    iconFg: "#8c6e44",
    iconActiveBg: "#fbf4df",
    iconActiveFg: "#8a4a00",
    iconActiveShadow: "inset 0 0 0 1px #8a4a00",
    badgeBg: "#8a4a00",
    badgeFg: "#fbf4df",
    unreadBg: "#8a4a00",
    unreadFg: "#fbf4df",
    projectBg: "#efe2bf",
    itemActiveBg: "#fbf4df",
    itemActiveFg: "#3c2a14",
    topBarBg: "#ede2c6",
    topBarBorder: "#c7a87a",
    heroBg: "#fbf4df",
    heroBorder: "#c7a87a",
    heroValue: "#3c2a14",
    heroLabel: "#6b4a2a",
    panelBg: "#fbf4df",
    panelHeaderBg: "#f2e7c8",
    panelBorder: "#c7a87a",
    panelShadow: "0 1px 2px rgba(60,42,20,0.05)",
    panelRadius: 0,
    panelClip: "none",
    insightBg: "#f2e7c8",
    insightColor: "#6b4a2a",
    insightBorder: "#c7a87a",
    actionPrimaryBg: "#8a4a00",
    actionPrimaryFg: "#fbf4df",
    actionSecondaryBg: "#fbf4df",
    actionSecondaryFg: "#3c2a14",
    actionSecondaryBorder: "#c7a87a",
    cardTitleStyle: "ascii",
    approvalBodyStyle: "quote",
    miniBtnStyle: "text",
    gaugeGlow: 0,
  },
  'retro-dark': {
    themeKey: "retro",
    mode: "dark",
    font: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    displayFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    monoFont: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
    bgCanvas: "#0a0d09",
    bgElev: "#10150f",
    bgSunk: "#070b07",
    fg: "#d8ead7",
    fgMuted: "#9bc29b",
    fgSubtle: "#577457",
    border: "#203425",
    borderSoft: "#132217",
    brand: "#89f09a",
    brandDeep: "#5fc271",
    accent: "#f5a24a",
    success: "#8cf59e",
    warning: "#f7b267",
    danger: "#d77952",
    avatarShape: "status",
    useLineIcons: true,
    railBg: "#080b08",
    railExtra: {
  "borderRight": "1px solid #203425"
  },
    logoBg: "transparent",
    logoFg: "#f5a24a",
    logoShadow: "inset 0 0 0 1px #2d4a31, 0 0 10px rgba(245,162,74,0.18)",
    iconFg: "#4f8f59",
    iconActiveBg: "#101712",
    iconActiveFg: "#f5a24a",
    iconActiveShadow: "inset 0 0 0 1px #335338, 0 0 8px rgba(245,162,74,0.16)",
    badgeBg: "#f5a24a",
    badgeFg: "#081008",
    unreadBg: "#89f09a",
    unreadFg: "#081008",
    projectBg: "#090d09",
    itemActiveBg: "#121912",
    itemActiveFg: "#c5ff9a",
    topBarBg: "#0c100c",
    topBarBorder: "#1e2c1f",
    heroBg: "#0f140f",
    heroBorder: "#213021",
    heroValue: "#e9f3e7",
    heroLabel: "#9bc29b",
    panelBg: "#101410",
    panelHeaderBg: "#0d110d",
    panelBorder: "#213021",
    panelShadow: "0 0 0 1px rgba(245,180,103,0.08), 0 0 16px rgba(245,180,103,0.06)",
    panelRadius: 0,
    panelClip: "none",
    insightBg: "#121712",
    insightColor: "#9bc29b",
    insightBorder: "#1f2b1f",
    actionPrimaryBg: "#162116",
    actionPrimaryFg: "#f5b467",
    actionSecondaryBg: "#121712",
    actionSecondaryFg: "#d8ead7",
    actionSecondaryBorder: "#294129",
    cardTitleStyle: "ascii",
    approvalBodyStyle: "quote",
    miniBtnStyle: "text",
    gaugeGlow: 0,
  },
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
  return `${themeKey}-${mode}` as ThemeComboKey;
}
