// Rolestra theme tokens — 3 variants × 2 modes + shared density
// Tweaks-driven. All UI reads from CSS variables on document root.

const THEMES = {
  // "Control Room" — dark-first, indigo brand (matches user's picked brand swatch)
  control: {
    label: 'Control Room',
    light: {
      '--bg': '#f7f8fb',
      '--bg-elev': '#ffffff',
      '--bg-sunk': '#edeef3',
      '--bg-hover': '#eef0f6',
      '--bg-active': '#e5e7ef',
      '--border': '#dfe1e8',
      '--border-strong': '#c7cad3',
      '--fg': '#12131a',
      '--fg-muted': '#5b6071',
      '--fg-subtle': '#8a8fa0',
      '--brand': '#6366f1',
      '--brand-fg': '#ffffff',
      '--brand-soft': '#eef0ff',
      '--brand-soft-fg': '#4338ca',
      '--success': '#16a34a',
      '--warning': '#d97706',
      '--danger': '#dc2626',
      '--shadow-sm': '0 1px 2px rgba(17,19,30,0.06)',
      '--shadow-md': '0 4px 16px rgba(17,19,30,0.08)',
      '--shadow-lg': '0 12px 40px rgba(17,19,30,0.12)',
      '--font': '"Inter", -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
      '--font-mono': '"JetBrains Mono", "SF Mono", Menlo, monospace',
    },
    dark: {
      '--bg': '#0b0c12',
      '--bg-elev': '#12131a',
      '--bg-sunk': '#07070b',
      '--bg-hover': '#1a1c26',
      '--bg-active': '#222533',
      '--border': '#22242e',
      '--border-strong': '#343644',
      '--fg': '#e7e9f0',
      '--fg-muted': '#9499a8',
      '--fg-subtle': '#60657a',
      '--brand': '#818cf8',
      '--brand-fg': '#0b0c12',
      '--brand-soft': '#1c1f36',
      '--brand-soft-fg': '#a5b4fc',
      '--success': '#22c55e',
      '--warning': '#fbbf24',
      '--danger': '#f87171',
      '--shadow-sm': '0 1px 2px rgba(0,0,0,0.3)',
      '--shadow-md': '0 4px 16px rgba(0,0,0,0.4)',
      '--shadow-lg': '0 12px 40px rgba(0,0,0,0.5)',
      '--font': '"Inter", -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
      '--font-mono': '"JetBrains Mono", "SF Mono", Menlo, monospace',
    },
  },
};

const DENSITY = {
  compact: {
    '--row-h': '28px',
    '--row-h-lg': '36px',
    '--pad-x': '10px',
    '--pad-y': '6px',
    '--gap': '6px',
    '--gap-lg': '10px',
    '--radius': '6px',
    '--radius-lg': '10px',
    '--text-xs': '11px',
    '--text-sm': '12px',
    '--text-base': '13px',
    '--text-lg': '15px',
    '--text-xl': '18px',
    '--text-2xl': '22px',
    '--text-3xl': '28px',
  },
  comfortable: {
    '--row-h': '36px',
    '--row-h-lg': '44px',
    '--pad-x': '14px',
    '--pad-y': '10px',
    '--gap': '10px',
    '--gap-lg': '16px',
    '--radius': '8px',
    '--radius-lg': '12px',
    '--text-xs': '12px',
    '--text-sm': '13px',
    '--text-base': '14px',
    '--text-lg': '16px',
    '--text-xl': '20px',
    '--text-2xl': '26px',
    '--text-3xl': '34px',
  },
};

function applyTheme(root, theme, mode, density) {
  const t = THEMES[theme][mode];
  const d = DENSITY[density];
  for (const [k, v] of Object.entries(t)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(d)) root.style.setProperty(k, v);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
  root.setAttribute('data-density', density);
}

Object.assign(window, { THEMES, DENSITY, applyTheme });
