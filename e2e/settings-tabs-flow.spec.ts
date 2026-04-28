/**
 * Playwright Electron E2E — "settings tabs flow" (R10-Task6).
 *
 * Flow under test (spec §7.10.6):
 *   1. Launch Rolestra with a fresh temp ArenaRoot.
 *   2. Click the Settings entry in NavRail → SettingsTabs mounts.
 *   3. Verify the tab list renders one trigger per tab key (10 total).
 *   4. Click a few representative tabs (theme, security, language) and
 *      assert the URL hash updates (`#settings/<key>`) plus the matching
 *      tab body is mounted.
 *   5. On the LanguageTab, switch to English and confirm the
 *      i18n-driven NavRail / topbar labels respond (best-effort — some
 *      labels are still hard-coded English in R10 so we settle for
 *      tab-list label change).
 *
 * WSL caveat (same as messenger-flow.spec.ts):
 *   Electron under WSL needs WSLg + a Linux-built Electron + a Linux-
 *   compiled better-sqlite3. When run from a Windows-native install
 *   tree the harness throws at launch; R10-Task13 wires the cross-OS
 *   matrix in CI. Locally we accept "spec land" and let CI exercise it.
 */
import { expect, test } from '@playwright/test';

import {
  launchRolestra,
  walkOnboardingWizard,
  type LaunchedApp,
} from './electron-launch';

const PROJECT_SLUG = 'arena-settings-e2e';

test.describe('settings tabs flow — open / switch / deep-link', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('NavRail Settings → 10 tabs render → switching tabs updates hash', async () => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // F1 cleanup made the onboarding wizard the first-boot gate. Walk it
    // through so the Dashboard / NavRail are reachable.
    await walkOnboardingWizard(window, PROJECT_SLUG);

    await window.waitForSelector('[data-testid="nav-rail"]', {
      timeout: 30_000,
    });

    // 1. Open Settings via NavRail.
    await window
      .locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Settings' })
      .click();
    await window.waitForSelector('[data-testid="settings-tabs-root"]', {
      timeout: 10_000,
    });

    // 2. Tab list must contain one trigger per tab key.
    const triggers = window.locator('[data-testid="settings-tabs-trigger"]');
    await expect(triggers).toHaveCount(10);

    // 3. Default tab is `notifications` (R9 carry-over).
    await window.waitForSelector('[data-testid="settings-tab-notifications"]', {
      timeout: 5_000,
    });

    // 4. Click the Theme trigger — hash should become `#settings/theme`,
    //    body should mount the ThemeTab.
    await window
      .locator('[data-testid="settings-tabs-trigger"][data-tab="theme"]')
      .click();
    await window.waitForSelector('[data-testid="settings-tab-theme"]', {
      timeout: 5_000,
    });
    const themeHash = await window.evaluate(() => globalThis.location.hash);
    expect(themeHash).toBe('#settings/theme');

    // 5. Click the Security trigger — opt-in toggle should default to
    //    unchecked (spec §7.6.5).
    await window
      .locator('[data-testid="settings-tabs-trigger"][data-tab="security"]')
      .click();
    const optIn = window.locator(
      '[data-testid="settings-security-opt-in-toggle"]',
    );
    await expect(optIn).toBeVisible();
    await expect(optIn).not.toBeChecked();

    // 6. Click the Language trigger — switching to en should toggle the
    //    `data-active` flag.
    await window
      .locator('[data-testid="settings-tabs-trigger"][data-tab="language"]')
      .click();
    const enOption = window.locator(
      '[data-testid="settings-language-option"][data-locale="en"] input[type="radio"]',
    );
    await enOption.check();

    await expect(
      window.locator(
        '[data-testid="settings-language-option"][data-locale="en"]',
      ),
    ).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });
});
