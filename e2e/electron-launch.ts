/**
 * Launch helper for the Playwright Electron E2E harness (R4-Task12).
 *
 * Responsibilities:
 * - Allocate a fresh temp directory per test and inject it as the app's
 *   ArenaRoot via the `ROLESTRA_ARENA_ROOT` env var. The Main-side
 *   `ArenaRootService` (src/main/arena/arena-root-service.ts) consults
 *   this variable BEFORE it reads `settings.arenaRoot`, so the user's
 *   real settings file is never touched by the harness.
 * - Launch the packaged renderer (`electron-vite build` output at `out/`)
 *   via `_electron.launch`. The `.` arg resolves to the repo root and
 *   Electron uses `package.json.main = ./out/main/index.js`.
 * - Expose a `cleanup()` that closes the Electron app and then removes
 *   the temp directory tree (recursive, force — best-effort).
 *
 * Why env vars (not CLI args):
 * - `process.argv` in Electron's main process includes extra bootstrap
 *   flags (e.g. `--disable-dev-shm-usage`) that make a bespoke parser
 *   fragile. Env vars are the simplest reliable plumbing for a single
 *   string value. The `ROLESTRA_` prefix mirrors the CLI-spawn
 *   convention already used across the codebase (e.g.
 *   `ROLESTRA_PROJECT_SLUG`).
 *
 * ── WSL Linux troubleshooting ────────────────────────────────────────
 * The E2E pipeline expects the Linux Electron binary (`node_modules/
 * electron/dist/electron`). If the repo was last `npm install`-ed from
 * Windows (common — the package-lock comment in R4 commits confirms a
 * Windows-native install baseline), `node_modules/electron/dist/` will
 * contain only `electron.exe`, which cannot load the Linux ELF
 * `better_sqlite3.node`. In that case the app bootstraps with
 * `ERR_DLOPEN_FAILED` and Playwright times out waiting for
 * `firstWindow()`.
 *
 * Remediation (choose one):
 *   - Run from Windows PowerShell: `npm run e2e`. Windows is the
 *     canonical dev platform for R4; this is the supported path.
 *   - In WSL, reinstall Electron + better-sqlite3 for Linux:
 *       npm rebuild electron
 *       npm rebuild better-sqlite3
 *       npm run build
 *       npm run e2e
 *     Note: this will clobber the Windows-native bindings until you
 *     re-run `npm install` on Windows. Not recommended as a default.
 *   - Wait for R10's OS-matrix CI, which will run the e2e suite on
 *     Windows, macOS, and Linux runners with the correct per-platform
 *     node_modules for each job.
 *
 * Pre-requisite regardless of host: `npm run build` must have produced
 * `out/main/index.js`, `out/preload/index.js`, and `out/renderer/*`.
 */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface LaunchedApp {
  /** The Playwright-owned Electron application handle. */
  app: ElectronApplication;
  /** Absolute path to the temp ArenaRoot injected into the app. */
  arenaRoot: string;
  /** Closes Electron and removes the temp ArenaRoot. Always await. */
  cleanup: () => Promise<void>;
}

/**
 * Launch Rolestra with a fresh temp ArenaRoot. Caller owns the returned
 * `cleanup()`; use it inside `try/finally` or the `afterEach` hook to
 * guarantee Electron shuts down even when the spec fails mid-way.
 */
export async function launchRolestra(): Promise<LaunchedApp> {
  const arenaRoot = mkdtempSync(join(tmpdir(), 'rolestra-e2e-'));
  // `electron-vite build` must have run at least once; `out/main/index.js`
  // is referenced by `package.json.main` and is what Electron boots.
  const repoRoot = resolve(__dirname, '..');

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      ROLESTRA_ARENA_ROOT: arenaRoot,
      // Match production startup — dev-server HMR is unrelated to E2E
      // and would point the renderer at localhost:5173 if left set.
      ELECTRON_RENDERER_URL: '',
      NODE_ENV: 'test',
      // R11-Task4: every Playwright Electron run gets the dev hooks
      // surface (preload `__rolestraDevHooks` + main `dev:trip-circuit-
      // breaker` channel). Production builds never set this variable, so
      // the gates in `src/preload/index.ts` and `src/main/ipc/router.ts`
      // keep the trip path locked away from end-user installs. Setting it
      // unconditionally here means specs that don't need the hooks pay
      // zero observable cost (the registration just registers an extra
      // channel and exposes one more `window.*` binding) while specs
      // that DO need them — autonomy-queue Step C — get a deterministic
      // hook regardless of host OS.
      ROLESTRA_E2E: '1',
    },
  });

  const cleanup = async (): Promise<void> => {
    try {
      await app.close();
    } catch {
      // Electron may already be down — don't block cleanup on close errors.
    }
    rmSync(arenaRoot, { recursive: true, force: true });
  };

  return { app, arenaRoot, cleanup };
}

/**
 * Walk through the F1 onboarding wizard so the Dashboard is reachable.
 * F1 cleanup made first-boot land on the wizard and gates the Dashboard
 * behind wizard completion. Specs that exercise post-onboarding surfaces
 * (Dashboard, NavRail, Messenger, Approvals, Settings) MUST call this
 * helper after `launchRolestra()` — otherwise `waitForSelector` for
 * `dashboard-hero` / `nav-rail` times out at 30 s.
 *
 * The walk replays the canonical 5-step path:
 *   1. Step 1 (intro) → Next.
 *   2. Step 2 (staff grid) → Next. Relies on the host's CLI detection
 *      finding ≥ MIN_STAFF binaries on PATH (claude / gemini / codex /
 *      ollama). On a clean WSL host without any CLI installed the gate
 *      fails — same caveat as the rest of the harness.
 *   3. Step 3 — fill every role row with a non-empty string.
 *   4. Step 4 (default `hybrid` permission mode) → Next.
 *   5. Step 5 — fill the project slug → Finish. The wizard then
 *      auto-creates the first kind=`new` project (which provisions the
 *      three system channels including #승인-대기), unmounts the wizard,
 *      and lands the user on the Dashboard.
 *
 * @param window      The first Electron window from `app.firstWindow()`.
 * @param projectSlug Slug for the auto-created first project. Spec
 *                    chooses a unique value so post-wizard navigation
 *                    is unambiguous.
 */
export async function walkOnboardingWizard(
  window: Page,
  projectSlug: string,
): Promise<void> {
  const page = window.locator('[data-testid="onboarding-page"]');
  await window.waitForSelector('[data-testid="onboarding-page"]', {
    timeout: 30_000,
  });
  await expect(page).toHaveAttribute('data-current-step', '1');

  // Step 1 → Next (no gate)
  await window.click('[data-testid="onboarding-action-next"]');
  await expect(page).toHaveAttribute('data-current-step', '2');

  // Step 2 — wait for staff-grid render then advance with default selection
  await window.waitForSelector('[data-testid="onboarding-staff-grid"]', {
    timeout: 30_000,
  });
  await window.click('[data-testid="onboarding-action-next"]');
  await expect(page).toHaveAttribute('data-current-step', '3');

  // Step 3 — fill every role row
  const roleInputs = window.locator('[data-testid="onboarding-step-3-input"]');
  const inputCount = await roleInputs.count();
  expect(inputCount).toBeGreaterThan(0);
  for (let i = 0; i < inputCount; i += 1) {
    await roleInputs.nth(i).fill('역할');
  }
  await window.click('[data-testid="onboarding-action-next"]');
  await expect(page).toHaveAttribute('data-current-step', '4');

  // Step 4 → Next (default hybrid)
  await window.click('[data-testid="onboarding-action-next"]');
  await expect(page).toHaveAttribute('data-current-step', '5');

  // Step 5 — slug + Finish
  await window.fill('[data-testid="onboarding-step-5-slug"]', projectSlug);
  await window.click('[data-testid="onboarding-action-next"]');

  // The wizard's `handleOnboardingComplete` runs as a fire-and-forget
  // async IIFE — clicking Finish flips the renderer to the Dashboard
  // immediately, but the bootstrap project create completes a few
  // turns later. Specs that exercise post-onboarding state (rail
  // entries, KPI counters, channel rolls) need the bootstrap row in
  // the project rail before they continue, otherwise their first
  // assertion races against the in-flight create.
  await expect(
    window
      .locator('[data-testid="project-rail"]')
      .getByRole('button', { name: projectSlug }),
  ).toBeVisible({ timeout: 30_000 });
}
