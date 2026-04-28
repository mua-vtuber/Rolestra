/**
 * Playwright Electron E2E — "approval detail flow" (R11-Task7).
 *
 * Scope:
 *   1. Launch Rolestra with a fresh ArenaRoot.
 *   2. Onboard through the wizard so the Dashboard is reachable.
 *   3. Create a `kind='new'` project so #승인-대기 is auto-provisioned.
 *   4. Navigate to messenger → #승인-대기. Verify the ApprovalInboxView
 *      now renders the R11-Task7 split layout (`approval-inbox-list-pane`
 *      + `approval-inbox-detail-pane`).
 *   5. Verify the detail pane starts in the empty state.
 *   6. Click each filter tab in turn and confirm the data attribute on
 *      the inbox container reflects the active filter (the underlying
 *      hook re-fetches with `status=...`).
 *
 * The "click row → 5-card panel" path requires a seeded approval; without
 * a real CLI permission round-trip there are no rows to click. R11-Task7
 * accepts "split layout + filter wiring lands" as DONE; the row-click
 * path is exercised by `ApprovalInboxView.test.tsx` and the
 * `ApprovalDetailPanel.test.tsx` jsdom suites.
 *
 * WSL caveat: same as the other Electron E2E specs — the Linux binary +
 * better-sqlite3 native build must be in place. CI matrix executes; WSL
 * is best-effort.
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const PROJECT_SLUG = 'arena-approval-detail-e2e';
const SCREENSHOT_FILENAME = 'approval-detail-flow.png';

test.describe('approval detail flow — split layout + filter wiring', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('inbox renders split layout with detail pane and reacts to filter changes', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // The first-boot probe lands on the wizard. Walk through it so the
    // Dashboard is reachable and we can create a project. Pattern mirrors
    // `onboarding-flow.spec.ts` exactly (step transition assertions before
    // each Next click) so detection / role-input async updates settle
    // before the gate is evaluated.
    await window.waitForSelector('[data-testid="onboarding-page"]', {
      timeout: 30_000,
    });
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '1');

    // Step 1 → Next (no gate)
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '2');

    // Step 2 — wait for staff-grid (detection populated) and advance
    await window.waitForSelector('[data-testid="onboarding-staff-grid"]');
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '3');

    // Step 3 — every selected provider must have a non-empty trimmed role
    const roleInputs = window.locator(
      '[data-testid="onboarding-step-3-input"]',
    );
    const inputCount = await roleInputs.count();
    expect(inputCount).toBeGreaterThan(0);
    for (let i = 0; i < inputCount; i += 1) {
      await roleInputs.nth(i).fill('역할');
    }
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '4');

    // Step 4 → Next (default 'hybrid')
    await window.click('[data-testid="onboarding-action-next"]');
    await expect(
      window.locator('[data-testid="onboarding-page"]'),
    ).toHaveAttribute('data-current-step', '5');

    // Step 5 — slug + Finish
    await window.fill(
      '[data-testid="onboarding-step-5-slug"]',
      PROJECT_SLUG,
    );
    await window.click('[data-testid="onboarding-action-next"]');

    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // Step 5 of the wizard already created the first project (kind='new'),
    // which auto-provisions the three system channels. Add a second one
    // via the Dashboard create CTA only if needed — the seeded one is
    // enough for the navigation we exercise below.

    // Flip to messenger.
    await window
      .locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Messenger' })
      .click();
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 30_000 },
    );

    // Click the `#승인-대기` system channel.
    const approvalRow = window
      .locator('[data-testid="channel-section-system"]')
      .locator('[data-channel-kind="system_approval"]')
      .first();
    await expect(approvalRow).toBeVisible({ timeout: 30_000 });
    await approvalRow.click();

    // R11-Task7 split layout: list pane + detail pane.
    const inbox = window.locator('[data-testid="approval-inbox-view"]');
    await expect(inbox).toBeVisible({ timeout: 30_000 });
    await expect(
      window.locator('[data-testid="approval-inbox-list-pane"]'),
    ).toBeVisible();
    await expect(
      window.locator('[data-testid="approval-inbox-detail-pane"]'),
    ).toBeVisible();

    // Detail pane starts empty (no row clicked yet).
    await expect(
      window.locator('[data-testid="apv-detail-empty"]'),
    ).toBeVisible();

    // R11-Task7 filter wiring — clicking each tab updates the data
    // attribute. There are no rows yet, so all four tabs show the empty
    // list state; the data-filter attribute is the canonical observable.
    const tabs = window.locator('[data-testid="approval-filter-tab"]');
    await expect(tabs).toHaveCount(4);

    for (const filter of ['approved', 'rejected', 'all', 'pending'] as const) {
      // `data-filter` lives on the <button> itself — chaining
      // `tabs.locator(...)` searches DESCENDANTS, returning 0 matches.
      // Compound the attribute on the same element instead.
      const tab = window.locator(
        `[data-testid="approval-filter-tab"][data-filter="${filter}"]`,
      );
      await tab.click();
      await expect(inbox).toHaveAttribute('data-filter', filter, {
        timeout: 10_000,
      });
    }

    const screenshot = await window.screenshot({ fullPage: false });
    await testInfo.attach(SCREENSHOT_FILENAME, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
