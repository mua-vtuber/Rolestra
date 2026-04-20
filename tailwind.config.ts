import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: ['selector', '[data-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-bg-canvas)',
        elev: 'var(--color-bg-elev)',
        sunk: 'var(--color-bg-sunk)',
        fg: {
          DEFAULT: 'var(--color-fg)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          soft: 'var(--color-border-soft)',
        },
        brand: {
          DEFAULT: 'var(--color-brand)',
          deep: 'var(--color-brand-deep)',
        },
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        rail: {
          bg: 'var(--color-rail-bg)',
          extra: 'var(--color-rail-extra)',
        },
        project: {
          bg: 'var(--color-project-bg)',
          'item-active-bg': 'var(--color-item-active-bg)',
          'item-active-fg': 'var(--color-item-active-fg)',
        },
        topbar: {
          bg: 'var(--color-topbar-bg)',
          border: 'var(--color-topbar-border)',
        },
        hero: {
          bg: 'var(--color-hero-bg)',
          border: 'var(--color-hero-border)',
          value: 'var(--color-hero-value)',
        },
        icon: {
          fg: 'var(--color-icon-fg)',
          'active-bg': 'var(--color-icon-active-bg)',
          'active-fg': 'var(--color-icon-active-fg)',
        },
        logo: {
          bg: 'var(--color-logo-bg)',
          fg: 'var(--color-logo-fg)',
        },
        badge: {
          bg: 'var(--color-badge-bg)',
          fg: 'var(--color-badge-fg)',
        },
        unread: {
          bg: 'var(--color-unread-bg)',
          fg: 'var(--color-unread-fg)',
        },
      },
      fontFamily: {
        sans: 'var(--font-body)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
      },
      boxShadow: {
        logo: 'var(--shadow-logo)',
        icon: 'var(--shadow-icon-active)',
        panel: 'var(--shadow-panel)',
      },
    },
  },
  plugins: [],
};

export default config;
