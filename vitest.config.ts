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
      // R12-C2 T41 — 검사관 룰 회귀. 룰이 무엇을 잡고 무엇을 통과시키는지를
      // 시험으로 고정해 둬야, 다음에 룰을 손댈 때 통과 조건이 조용히
      // 넓어지지 않는다.
      'tools/inspectors/__tests__/**/*.test.ts',
      // F4 (spec 2026-09-29-ai-setup-and-character.md) — dev:fresh's pure
      // path/env helpers (tools/dev-fresh/paths.ts).
      'tools/dev-fresh/__tests__/**/*.test.ts',
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
