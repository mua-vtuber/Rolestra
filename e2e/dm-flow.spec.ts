/**
 * Playwright Electron E2E — "DM flow" (R11-Task4).
 *
 * Closes R10 Known Concern #3 — `R10-Task3` shipped `DmListView` +
 * `DmCreateModal` + `dm:list` / `dm:create` IPC + the
 * `idx_dm_unique_per_provider` UNIQUE migration but never landed an
 * E2E spec. This file walks the user-visible flow per spec §7.4 (DM =
 * 사용자↔AI 1:1 channel, no `회의 시작`).
 *
 * Flow:
 *   1. Launch Electron with a fresh temp ArenaRoot.
 *   2. Seed exactly one local-kind provider through `provider:add` IPC.
 *      Local providers do not require a running server at registration
 *      time (the factory just instantiates `LocalProvider` and the
 *      warmup is fire-and-forget), so this gives the DmCreateModal a
 *      provider row to render without taking a dependency on a real
 *      Ollama install.
 *   3. Wait for the DmListView's `+` button to appear in the rail.
 *   4. Click `+ 새 DM` → `DmCreateModal` opens with one provider entry.
 *   5. Click the provider → `dm:create` runs, the modal closes, the new
 *      DM channel becomes active, and the messenger view mounts.
 *   6. Verify the DM-specific surface contract:
 *        - the channel header advertises `data-channel-kind="dm"`,
 *        - the `회의 시작` action button is NOT rendered (DM constraint),
 *        - the composer is writable so the user can still chat 1:1.
 *
 * Why is `회의 시작` the canonical "DM disablement" assertion?
 *   `ChannelHeader.tsx` documents the matrix: `user` → renders the
 *   button; `dm` → omits it entirely. Asserting absence (not just
 *   `disabled`) catches a regression where DM accidentally inherits
 *   the `user` branch.
 *
 * No double-create assertion?
 *   `idx_dm_unique_per_provider` is exercised in
 *   `channel-service.test.ts` already; surfacing it through the modal
 *   would couple the spec to the modal's error path, which is unit-
 *   tested in `DmCreateModal.test.tsx`. The E2E sticks to the happy
 *   path so the cross-OS matrix runtime stays under 20s per cell.
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const PROVIDER_DISPLAY_NAME = 'Arena DM E2E Provider';
const PROVIDER_BASE_URL = 'http://localhost:1';
const PROVIDER_MODEL = 'noop';
const SCREENSHOT_FILENAME = 'dm-flow.png';

test.describe('DM flow — NavRail "+ 새 DM" → provider → 회의 시작 미렌더', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('register provider, create DM, verify start-meeting absent', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 1. Seed a `local` provider through the typed IPC bridge. Local
    //    providers register synchronously (warmup is fire-and-forget),
    //    so this returns once the registry has the row.
    const providerId = await window.evaluate<
      string,
      { displayName: string; baseUrl: string; model: string }
    >(
      async (input) => {
        const arena = (
          globalThis as typeof globalThis & {
            arena?: {
              invoke: (
                channel: string,
                data: unknown,
              ) => Promise<{ provider: { id: string } }>;
            };
          }
        ).arena;
        if (!arena) {
          throw new Error('window.arena is missing — preload did not run');
        }
        const result = await arena.invoke('provider:add', {
          displayName: input.displayName,
          config: {
            type: 'local',
            baseUrl: input.baseUrl,
            model: input.model,
          },
        });
        return result.provider.id;
      },
      {
        displayName: PROVIDER_DISPLAY_NAME,
        baseUrl: PROVIDER_BASE_URL,
        model: PROVIDER_MODEL,
      },
    );
    expect(providerId).toBeTruthy();

    // 2. The DmListView lives below the ProjectRail; the `+` button
    //    renders as soon as `useDmSummaries` resolves (no project
    //    needed — DM scope is global per spec §7.4). Wait for it
    //    rather than the empty/loading sub-states because the test
    //    fixture order can race with first-paint.
    const dmNew = window.locator('[data-testid="dm-list-new-button"]');
    await expect(dmNew).toBeVisible({ timeout: 10_000 });
    await dmNew.click();

    // 3. Modal opens; the freshly-seeded provider's row is present and
    //    enabled (no DM exists yet).
    const dialog = window.locator('[data-testid="dm-create-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const providerButton = window.locator(
      `[data-testid="dm-create-provider-${providerId}"]`,
    );
    await expect(providerButton).toBeVisible({ timeout: 5_000 });
    await expect(providerButton).toHaveAttribute('data-exists', 'false');
    await providerButton.click();

    // 4. The handler in DmListView's onCreated callback flips active
    //    to the new DM channel + the App router switches to messenger.
    //    Wait for the messenger page to become non-empty before reading
    //    channel-header attributes (it stays mounted on subsequent
    //    project switches).
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 10_000 },
    );

    // 5. ChannelHeader advertises kind=dm + the start-meeting button is
    //    unmounted (NOT just disabled). Asserting via toHaveCount(0)
    //    catches both the "rendered+disabled" regression and the
    //    "rendered+hidden" regression (`hidden` would leak through a
    //    `display:none` rule).
    const header = window.locator('[data-testid="channel-header"]');
    await expect(header).toHaveAttribute('data-channel-kind', 'dm', {
      timeout: 10_000,
    });
    await expect(
      header.locator('[data-testid="channel-header-start-meeting"]'),
    ).toHaveCount(0);

    // 6. Composer stays writable — DM is a 1:1 chat, not read-only.
    const composer = window.locator(
      '[data-testid="composer"][data-readonly="false"]',
    );
    await expect(composer).toBeVisible({ timeout: 5_000 });

    // Evidence — capture the messenger view with the active DM.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('dm-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
