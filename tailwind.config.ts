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
          fg: 'var(--color-brand-fg)',
          // Small accent text (>= 4.5:1 on every surface, QA Medium-2).
          text: 'var(--color-brand-text)',
        },
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: {
          DEFAULT: 'var(--color-danger)',
          // Small danger text (>= 4.5:1 on every surface).
          text: 'var(--color-danger-text)',
        },
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
        // spec 2026-10-01-messenger-redesign.md R1-3 message tokens.
        bubble: {
          'mine-bg': 'var(--color-bubble-mine-bg)',
          'mine-fg': 'var(--color-bubble-mine-fg)',
          'mine-border': 'var(--color-bubble-mine-border)',
          'other-bg': 'var(--color-bubble-other-bg)',
          'other-border': 'var(--color-bubble-other-border)',
        },
        whisper: {
          fg: 'var(--color-whisper-fg)',
          border: 'var(--color-whisper-border)',
          bg: 'var(--color-whisper-bg)',
        },
        notice: {
          bg: 'var(--color-notice-bg)',
          fg: 'var(--color-notice-fg)',
        },
        name: {
          1: 'var(--color-name-1)',
          2: 'var(--color-name-2)',
          3: 'var(--color-name-3)',
          4: 'var(--color-name-4)',
          'palette-fg': 'var(--color-name-palette-fg)',
        },
        'log-mark': 'var(--color-log-mark)',
      },
      backgroundImage: {
        'screen-overlay': 'var(--overlay-screen)',
      },
      fontFamily: {
        sans: 'var(--font-body)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      // Named type scale from the 2026-10-01 mockups (Main / Settings / AddAI
      // .dc.html). Components use these names, never inline pixel sizes.
      fontSize: {
        // list time, time beside a bubble, avatar initials
        micro: ['11px', { lineHeight: '16px' }],
        // filter chips, subtitles, sender name, date line, notices,
        // typing line (bubbles), log [hh:mm], settings row details
        meta: ['12px', { lineHeight: '18px' }],
        // chat row preview, search field, settings descriptions and
        // section labels, typing line (log)
        preview: ['13px', { lineHeight: '19px' }],
        // message text, composer, chat row name, log lines, settings tabs
        body: ['14px', { lineHeight: '1.5' }],
        // AI name in a settings roster row
        'row-title': ['15px', { lineHeight: '1.5' }],
        'room-title': ['17px', { lineHeight: '24px' }],
        'dialog-title': ['20px', { lineHeight: '28px' }],
        // chat list title, settings menu title
        'list-title': ['22px', { lineHeight: '28px' }],
        // settings page title, AI list title
        'page-title': ['24px', { lineHeight: '32px' }],
      },
      spacing: {
        // settings menu row height
        'tab-row': '42px',
        // log-layout chat row preview indent: past `[방] ` / `[1:1] `
        'log-indent-room': '36px',
        'log-indent-dm': '46px',
      },
      width: {
        // Approved Add AI dialog width, with a viewport gutter on small windows.
        'add-ai-dialog': 'min(45rem, calc(100vw - 2rem))',
      },
      borderWidth: {
        // selected-row accent bar (chat list, settings menu)
        accent: '3px',
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
