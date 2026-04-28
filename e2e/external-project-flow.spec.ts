/**
 * Playwright Electron E2E — "external project → dashboard" (R4-Task12).
 *
 * Flow under test (spec §7.3 + §7.5):
 *   1. Launch Rolestra with a fresh temp ArenaRoot (via
 *      `ROLESTRA_ARENA_ROOT` env var).
 *   2. Click `+ 새 프로젝트` in ProjectRail → ProjectCreateModal opens.
 *   3. Choose `kind='external'`, pick the external folder through the
 *      stubbed `project:pick-folder` handler, set `permissionMode='hybrid'`
 *      (the `auto` option is already disabled by the UI) and type a name.
 *   4. Submit → Main-side ProjectService lays down the junction/symlink
 *      at `<ArenaRoot>/projects/<slug>/link` and inserts the row.
 *   5. Verify:
 *      - the junction exists on disk via `fs.lstat`,
 *      - the Dashboard Hero `projects` KPI reads `1`,
 *      - the ProjectRail entry renders with `data-active` truthy (the
 *        App wires `onCreated` → `setActive` so the new project becomes
 *        current).
 *
 * Testability surface:
 * - ArenaRoot injection: `ROLESTRA_ARENA_ROOT` env var, read once by
 *   `ArenaRootService` in `src/main/arena/arena-root-service.ts`. No CLI
 *   arg parser was added — the env-var path is simpler and piggybacks on
 *   the `ROLESTRA_` prefix convention the codebase already uses for
 *   CLI-spawn env plumbing.
 * - `project:pick-folder` OS dialog: stubbed via `electronApp.evaluate`
 *   + `ipcMain.removeHandler` / `ipcMain.handle`. The OS picker cannot
 *   be driven headlessly, but the renderer's contract with the handler
 *   is just `{ folderPath: string | null }`, so swapping implementations
 *   at test time is trivial.
 *
 * WSL note:
 * - WSLg (Windows 11's default X+Wayland stack) is sufficient for
 *   Electron to render a window under WSL2. What is NOT sufficient is
 *   the `node_modules/electron` that comes out of a Windows `npm
 *   install`: it ships only `electron.exe`, and the Windows Electron
 *   run under binfmt_misc interop can't load the Linux ELF
 *   `better_sqlite3.node`, which crashes the app during bootstrap. The
 *   supported local-dev flow for this suite is Windows PowerShell
 *   (`npm run e2e`). See `electron-launch.ts` for full remediation
 *   notes. R4 accepts "spec + config land" as done; cross-platform CI
 *   validation is scheduled for R10.
 */
import { expect, test } from '@playwright/test';
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  launchRolestra,
  walkOnboardingWizard,
  type LaunchedApp,
} from './electron-launch';

const SCREENSHOT_FILENAME = 'external-link-flow.png';
const PROJECT_NAME = 'Test External';
// Wizard-only slug — must differ from `generateSlug(PROJECT_NAME)`.
const PROJECT_SLUG = 'arena-external-e2e-bootstrap';
const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'external-sample');

test.describe('external project → dashboard KPI', () => {
  let launched: LaunchedApp | null = null;
  let externalRoot: string | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
    if (externalRoot) {
      rmSync(externalRoot, { recursive: true, force: true });
      externalRoot = null;
    }
  });

  test('create external project, verify junction + KPI + rail', async ({}, testInfo) => {
    // 1. Launch Electron against a fresh ArenaRoot.
    launched = await launchRolestra();
    const { app, arenaRoot } = launched;

    // 2. Copy the repo fixture to a writable temp path. The modal later
    //    feeds this path to `project:create`, which calls `fs.realpath`
    //    on it — so it must exist on disk with stable permissions.
    externalRoot = mkdtempSync(join(tmpdir(), 'rolestra-e2e-extern-'));
    cpSync(FIXTURE_DIR, externalRoot, { recursive: true });
    const externalPath = externalRoot;

    // 3. Wait for the renderer to land before stubbing the OS folder
    //    picker. Registering the stub before `firstWindow` resolves
    //    races against the production handler's own `ipcMain.handle`
    //    call inside main bootstrap — under WSL the main process boots
    //    slowly enough that the spec wins, then the production
    //    registration throws "Attempted to register a second handler"
    //    and tears the page down before `firstWindow()` can grab it.
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 4. Stub the OS folder picker. Re-registering `project:pick-folder`
    //    is safe because the handler is idempotent (one request in →
    //    one response out, no side effects beyond the dialog call it
    //    replaces).
    await app.evaluate(async ({ ipcMain }, path: string) => {
      if (typeof ipcMain.removeHandler === 'function') {
        ipcMain.removeHandler('project:pick-folder');
      }
      ipcMain.handle('project:pick-folder', async () => ({ folderPath: path }));
    }, externalPath);

    // F1 cleanup made the onboarding wizard the first-boot gate.
    await walkOnboardingWizard(window, PROJECT_SLUG);

    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 4. Open the create-project modal via ProjectRail.
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');

    // 5. Fill the form. Kind defaults to 'new' — flip to 'external'.
    //    (The `external` option id is `project-kind-external`, matching
    //    the `idPrefix` + value convention in ProjectKindTabs.)
    await window.click('#project-kind-external');
    await expect(
      window.locator('[data-testid="project-kind-option-external"]'),
    ).toHaveAttribute('data-selected', 'true');

    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);

    // 6. Pick the external folder via the stubbed handler.
    await window.click('[data-testid="project-create-external-path-button"]');
    await expect(
      window.locator('[data-testid="project-create-external-path-value"]'),
    ).toHaveText(externalPath, { timeout: 10_000 });

    // 7. Permission mode: the 'auto' option MUST be disabled for
    //    external kind (spec §7.3 CA-1). Select 'hybrid' explicitly
    //    (the reducer already flipped to 'hybrid' when kind became
    //    'external' but we click it anyway to exercise the radio).
    await expect(
      window.locator('[data-testid="project-permission-option-auto"]'),
    ).toHaveAttribute('aria-disabled', 'true');
    await window.click('#project-permission-hybrid');
    await expect(
      window.locator('[data-testid="project-permission-option-hybrid"]'),
    ).toHaveAttribute('data-selected', 'true');

    // 8. Submit.
    await window.click('[data-testid="project-create-submit"]');
    await window.waitForSelector('[data-testid="project-create-modal"]', {
      state: 'detached',
      timeout: 20_000,
    });

    // 9. Junction/symlink on disk. `projects/` now contains TWO slug
    //    dirs because the F1 wizard auto-created a bootstrap project
    //    (kind='new', no link) plus the external project we just
    //    created. The external slug is `generateSlug(PROJECT_NAME)`
    //    while the bootstrap dir uses `PROJECT_SLUG`. We locate the
    //    external slug dir explicitly so the symlink/junction check
    //    targets the right path.
    const projectsDir = join(arenaRoot, 'projects');
    const slugDirs = readdirSync(projectsDir);
    expect(slugDirs.length).toBe(2);
    const externalSlugDir = slugDirs.find((dir) => dir !== PROJECT_SLUG);
    expect(externalSlugDir).toBeDefined();
    const linkPath = join(projectsDir, externalSlugDir!, 'link');
    const stat = lstatSync(linkPath);
    expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true);

    // 10. KPI widget reports 2 active projects (bootstrap + external).
    const kpiValue = window.locator(
      '[data-testid="hero-kpi-tile"][data-variant="projects"] [data-testid="hero-kpi-value"]',
    );
    await expect(kpiValue).toHaveText('2', { timeout: 10_000 });

    // 11. ProjectRail shows the new project as active. App.tsx calls
    //     `setActive` on create, so the row should carry
    //     `aria-current="page"` (the accessible signal for the active
    //     rail entry — more stable than the React-rendered
    //     `data-active=""` attribute).
    await expect(
      window
        .locator('[data-testid="project-rail"]')
        .getByRole('button', { name: PROJECT_NAME }),
    ).toHaveAttribute('aria-current', 'page', { timeout: 10_000 });

    // 12. Evidence. Playwright stores it under the per-test output dir
    //     (`e2e/test-results/<test-slug>/`) and attaches it to the HTML
    //     report via `testInfo.attach`.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('external-link-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
