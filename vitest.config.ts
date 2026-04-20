import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'tools/cli-smoke/__tests__/**/*.test.ts',
    ],
    // Defensive exclude: Playwright Electron specs live in `e2e/**` and
    // must never be picked up by Vitest (they assume a live Electron
    // process and bundle Playwright's test runner). The `include`
    // globs above already scope to `src/` + `tools/cli-smoke/`, but
    // listing the exclude explicitly makes the intent obvious if the
    // `include` is ever widened.
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'e2e/**',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/renderer/index.html',
        'e2e/**',
      ],
    },
  },
});
