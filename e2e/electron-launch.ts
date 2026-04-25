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
import { _electron as electron, type ElectronApplication } from '@playwright/test';
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
