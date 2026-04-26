/**
 * Playwright Electron E2E — "onboarding flow" (R11-Task6).
 *
 * Walks the first-boot 5-step wizard end-to-end:
 *   1. Launch Electron with a fresh temp ArenaRoot.
 *      The OnboardingService seeds the canonical default
 *      (`completed=false, currentStep=1`) on first read, so the
 *      App.tsx mount probe flips view='onboarding' without any
 *      manual setup.
 *   2. Confirm the wizard is mounted (no Shell/NavRail rendering).
 *   3. Step 1 → Next.
 *   4. Step 2: pick at least one staff card → Next.
 *   5. Step 3: type a one-line role for the selected provider → Next.
 *   6. Step 4: leave the default `hybrid` permission mode → Next.
 *   7. Step 5: enter a slug → click Finish.
 *   8. Wizard unmounts; dashboard surface (`dashboard-hero`) is back.
 *   9. Reload the renderer window — the wizard MUST NOT re-mount,
 *      because `onboarding:complete` flipped the persisted
 *      `completed=true` flag and the App.tsx probe now skips the
 *      auto-enter branch.
 *
 * Why no per-theme assertions?
 *   The theme cascade is unit-tested in `OnboardingPage.test.tsx`. The
 *   E2E focuses on the persistence + first-boot probe glue that vitest
 *   cannot exercise (renderer reload + main-process row write).
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const SLUG = 'arena-onboarding-e2e';
const SCREENSHOT_FILENAME = 'onboarding-flow.png';

test.describe('onboarding flow — first-boot → 5-step → complete → no reentry', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('walks the full wizard and completes without reentry on reload', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // ── 1. First-boot probe lands the user on the wizard ─────────
    await window.waitForSelector('[data-testid="onboarding-page"]', {
      timeout: 30_000,
    });
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '1');

    // ── 2. Step 1 → Next (no gate) ───────────────────────────────
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '2');

    // ── 3. Step 2: select at least one staff card ────────────────
    // The fixture seeds 4 selected by default (claude/gemini/codex/local).
    // We just confirm the gate already passes and advance.
    await window.waitForSelector(
      '[data-testid="onboarding-staff-grid"]',
    );
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '3');

    // ── 4. Step 3: type a role for every selected provider ───────
    const roleInputs = window.locator(
      '[data-testid="onboarding-step-3-input"]',
    );
    const inputCount = await roleInputs.count();
    expect(inputCount).toBeGreaterThan(0);
    for (let i = 0; i < inputCount; i += 1) {
      await roleInputs.nth(i).fill('시니어 엔지니어');
    }
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '4');

    // ── 5. Step 4: leave default hybrid mode → Next ──────────────
    const hybrid = window.locator(
      '[data-testid="onboarding-step-4-option"][data-mode="hybrid"]',
    );
    await expect(hybrid).toHaveAttribute('data-selected', 'true');
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '5');

    // ── 6. Step 5: enter slug → Finish ───────────────────────────
    await window.fill('[data-testid="onboarding-step-5-slug"]', SLUG);
    await window.click('[data-testid="onboarding-action-next"]');

    // Wizard should unmount. The dashboard hero is the canonical
    // post-wizard surface (DashboardPage).
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveCount(0);

    // ── 7. Reload — first-boot probe must NOT re-enter ───────────
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveCount(0);

    const screenshotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('post-onboarding-dashboard', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
});
