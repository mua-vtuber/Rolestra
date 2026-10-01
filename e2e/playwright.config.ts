/**
 * Playwright config for Rolestra Electron E2E (R4-Task12).
 *
 * Scope:
 * - Drives the real Electron build through an isolated bootstrap
 *   (`support/isolated-app.ts`) in every `*.spec.ts` here:
 *   `chat-first-flow.spec.ts` and `chat-rounds.spec.ts` (spec 2026-10-01
 *   pass button, writing indicator, all-silent notice). ArenaRoot,
 *   userData, config and secrets live under one fresh temporary root for
 *   each test and its restart; the model is the offline fake in
 *   `support/fake-provider.ts`.
 * - Lives outside `src/` so neither `tsconfig.web.json` nor
 *   `tsconfig.node.json` type-checks it — the Playwright sub-project has
 *   its own `tsconfig.json` here in `e2e/`.
 * - Vitest excludes `e2e/**` (see `vitest.config.ts`) so `npm test` never
 *   tries to run these specs.
 *
 * WSL caveat (R4 is local-only; CI is deferred to R10):
 * - Electron needs WSLg (or another X server) to render a window under
 *   WSL. On a bare headless Linux container it will fail to launch; the
 *   launcher surfaces the underlying error rather than hanging.
 *
 * No `webServer` — Electron is self-hosted. No Chromium download is
 * required; `@playwright/test` ships the Electron transport standalone.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  reporter: [
    ['list'],
    // HTML output lives OUTSIDE `outputDir` — Playwright clears the HTML
    // folder before generating the report, and a nested folder would
    // wipe per-test artifacts (videos, traces, screenshots) as collateral.
    ['html', { outputFolder: 'report/html', open: 'never' }],
  ],
  outputDir: 'test-results',
});
