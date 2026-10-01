import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import type { Plugin } from 'vite';

// WSL mounts (/mnt/) don't support inotify — fall back to polling
const isWslMount = __dirname.startsWith('/mnt/');
const watchOptions = isWslMount ? { usePolling: true, interval: 500 } : {};

/**
 * @fontsource CSS lists every font as woff2 with a woff fallback. The app
 * runs only in Electron's Chromium, which always takes the woff2, so the
 * woff copies would ship unused (about 6 MB for the bundled fonts). This
 * drops the woff fallback from @fontsource stylesheets before Vite resolves
 * their url()s, so only the woff2 files are emitted.
 */
const FONTSOURCE_CSS = /[\\/]@fontsource[\\/][^?]+\.css$/;
const WOFF_FALLBACK = /,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g;

function fontsourceWoff2Only(): Plugin {
  return {
    name: 'rolestra:fontsource-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      return FONTSOURCE_CSS.test(id) ? code.replace(WOFF_FALLBACK, '') : null;
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
    server: { watch: watchOptions },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
    server: { watch: watchOptions },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), fontsourceWoff2Only()],
    build: {
      // CSP permits local files only; inlined data: fonts would be blocked.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    server: { watch: watchOptions },
  },
});
