/**
 * Playwright Electron E2E — "approval flow" (R7-Task12).
 *
 * Scope (R7):
 *   - Launch Rolestra with a fresh ArenaRoot, create a `kind='new'` project,
 *     and navigate into the `#승인-대기` (system_approval) channel via the
 *     channel rail.
 *   - Verify the Thread renders ApprovalInboxView (not the message list).
 *   - Verify the inbox shows its empty state (`messenger.approval.inbox.empty`)
 *     because no approvals have been created yet — the full CLI-permission /
 *     consensus-decision round-trip requires a live AI turn, which is R10
 *     + CI matrix territory.
 *
 * The integration-level "approval decide → #회의록 post → outcome='accepted'"
 * flow is covered by unit tests (MeetingOrchestrator + ApprovalBlock + dialog
 * specs in src/). This E2E's job is to confirm the channel → inbox → empty
 * navigation wiring holds end-to-end in a real Electron process.
 *
 * WSL caveat (same as R4/R5/R6 E2E):
 *   Electron under WSL requires WSLg + a Linux Electron/better-sqlite3 build.
 *   When run from a Windows-native `npm install` tree the Linux Electron
 *   binary is missing and the harness throws at launch. R7 accepts "spec
 *   lands" as done (DONE_WITH_CONCERNS) and defers cross-platform CI
 *   execution to R10 per the R4/R5/R6 precedent.
 */
import { expect, test } from '@playwright/test';

import {
  launchRolestra,
  walkOnboardingWizard,
  type LaunchedApp,
} from './electron-launch';

const PROJECT_NAME = 'Arena Approval E2E';
// Wizard-only slug — must differ from `generateSlug(PROJECT_NAME)` to
// avoid the UNIQUE projects.slug collision (silent create failure).
const PROJECT_SLUG = 'arena-approval-flow-e2e-bootstrap';
const SCREENSHOT_FILENAME = 'approval-flow.png';

test.describe('approval flow — inbox navigation from #승인-대기', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('create project → messenger → #승인-대기 → ApprovalInboxView empty state', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // F1 cleanup made the onboarding wizard the first-boot gate.
    await walkOnboardingWizard(window, PROJECT_SLUG);

    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 1. Create a `kind='new'` project so the three system channels are
    //    auto-provisioned by ChannelService.createSystemChannels.
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');
    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);
    // Wait for InitialMembersSelector prefill so the new project lands
    // with `project_members` populated. Without this the inbox
    // navigation still works but downstream channel creation fails.
    await window.waitForSelector(
      '[data-testid="initial-members-selector"][data-state="ready"]',
      { timeout: 10_000 },
    );
    await window.click('[data-testid="project-create-submit"]');
    await window.waitForSelector('[data-testid="project-create-modal"]', {
      state: 'detached',
      timeout: 20_000,
    });

    // F1 wizard left an auto-created bootstrap project active; clicking
    // the freshly-created `PROJECT_NAME` rail row swaps the active
    // project deterministically. (`handleProjectCreated` already calls
    // `setActive` async, but the click also serves as a settle point.)
    const newProjectButton = window
      .locator('[data-testid="project-rail"]')
      .getByRole('button', { name: PROJECT_NAME });
    await expect(newProjectButton).toBeVisible({ timeout: 10_000 });
    await newProjectButton.click();
    await expect(newProjectButton).toHaveAttribute('aria-current', 'page', {
      timeout: 10_000,
    });

    // 2. Flip to messenger.
    await window
      .locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Messenger' })
      .click();
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 10_000 },
    );

    // 3. Click the `#승인-대기` system channel row.
    const systemSection = window.locator(
      '[data-testid="channel-section-system"]',
    );
    const approvalRow = systemSection.locator(
      '[data-channel-kind="system_approval"]',
    );
    await expect(approvalRow).toHaveCount(1, { timeout: 10_000 });
    await approvalRow.click();

    // 4. Thread should render ApprovalInboxView, NOT the message list.
    const inbox = window.locator('[data-testid="approval-inbox-view"]');
    await expect(inbox).toBeVisible({ timeout: 10_000 });
    await expect(inbox).toHaveAttribute('data-item-count', '0');
    await expect(
      window.locator('[data-testid="approval-inbox-empty"]'),
    ).toBeVisible();
    await expect(
      window.locator('[data-testid="thread-message-list"]'),
    ).toHaveCount(0);

    const screenshot = await window.screenshot({
      fullPage: false,
    });
    await testInfo.attach(SCREENSHOT_FILENAME, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
