/**
 * Playwright Electron E2E — "meeting flow" (R6-Task12).
 *
 * Flow under test (spec §7.5 + R6 Decision Log D1/D2/D3):
 *   1. Launch Rolestra with a fresh temp ArenaRoot.
 *   2. Create a `kind='new'` project so the 3 system channels
 *      (`#일반`, `#승인-대기`, `#회의록`) exist.
 *   3. Navigate to the messenger, create a user channel `회의방`,
 *      open `StartMeetingModal`, submit with topic "릴리스 계획".
 *   4. Assert `MeetingBanner` mounts with the topic and active SSM
 *      meta row.
 *   5. Switch to the `#회의록` system channel and verify it is
 *      reachable (even if empty — the MinutesComposer post only lands
 *      when the SSM reaches DONE / FAILED, which needs a live AI
 *      provider).
 *
 * Scope notes (R6):
 *   - R6 does NOT wire a mock `providerRegistry` for the Electron
 *     build, so the SSM will stay in CONVERSATION and the composer
 *     round will produce zero turns (no provider registered). The E2E
 *     therefore focuses on the IPC + UI surface (modal → MeetingService.start
 *     → MeetingBanner) rather than the full DONE → minutes loop. R10
 *     rewires the E2E with a mock provider so the DONE path can
 *     execute.
 *   - The `#회의록` assertion is a smoke check that the system channel
 *     is clickable + the thread renders empty. The
 *     MinutesComposer-posted minutes would require the orchestrator
 *     to cycle through the SSM, which needs the mock provider.
 *
 * WSL caveat (same as R4/R5 tests): Electron under WSL requires WSLg
 * + a Linux Electron/better-sqlite3 build. When `npm install` ran on
 * Windows the binaries do not work inside the Linux kernel; the test
 * fails at `launchRolestra()`. Windows-native execution is the
 * documented "done" path; R10 adds a CI matrix.
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const PROJECT_NAME = 'Arena Meeting E2E';
const USER_CHANNEL_NAME = '회의방';
const MEETING_TOPIC = '릴리스 계획 2026 Q2';
const SCREENSHOT_FILENAME = 'meeting-flow.png';

test.describe('meeting flow — start meeting + #회의록 navigation', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('create project → messenger → user channel → start meeting → banner → #회의록', async ({}, testInfo) => {
    // 1. Launch Electron.
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 2. Create a `kind='new'` project.
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');
    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);
    await window.click('[data-testid="project-create-submit"]');
    await window.waitForSelector('[data-testid="project-create-modal"]', {
      state: 'detached',
      timeout: 20_000,
    });

    // 3. Flip to the messenger view.
    await window.locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Messenger' })
      .click();
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 10_000 },
    );

    // 4. Create a user channel so meetings have a writable home. The
    //    StartMeetingModal exercises `channel:start-meeting`, which
    //    requires a non-DM, non-system channel.
    await window.click('[data-testid="channel-rail-create"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]');
    await window.fill('[data-testid="channel-create-name"]', USER_CHANNEL_NAME);
    await window.click('[data-testid="channel-create-submit"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]', {
      state: 'detached',
      timeout: 15_000,
    });

    // The new row should flip to active automatically.
    const userSection = window.locator('[data-testid="channel-section-user"]');
    const newRow = userSection
      .locator('[data-testid="channel-row"]')
      .filter({ hasText: USER_CHANNEL_NAME });
    await expect(newRow).toHaveAttribute('data-active', 'true', { timeout: 10_000 });

    // 5. Open the start-meeting modal from the channel header and
    //    submit a topic.
    await window.click('[data-testid="channel-header-start-meeting"]');
    await window.waitForSelector('[data-testid="start-meeting-modal"]');
    await window.fill(
      '[data-testid="start-meeting-topic"]',
      MEETING_TOPIC,
    );
    await window.click('[data-testid="start-meeting-submit"]');
    await window.waitForSelector('[data-testid="start-meeting-modal"]', {
      state: 'detached',
      timeout: 15_000,
    });

    // 6. MeetingBanner must mount with the topic text we just
    //    submitted. `data-testid="meeting-banner"` is theme-stable
    //    (the variants render via the same root attrs — see
    //    MeetingBanner.tsx).
    const banner = window.locator('[data-testid="meeting-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.locator('[data-testid="meeting-banner-topic"]'))
      .toContainText(MEETING_TOPIC, { timeout: 10_000 });

    // 7. Switch to the `#회의록` (`system_minutes`) channel. The post
    //    from the orchestrator is only produced when the SSM reaches
    //    DONE / FAILED, which requires a registered AI provider;
    //    without one (R6 E2E scope), the minutes channel stays empty
    //    but must still be reachable.
    const systemSection = window.locator('[data-testid="channel-section-system"]');
    const minutesRow = systemSection.locator(
      '[data-testid="channel-row"][data-channel-kind="system_minutes"]',
    );
    await expect(minutesRow).toHaveCount(1);
    await minutesRow.click();
    await expect(minutesRow).toHaveAttribute('data-active', 'true', {
      timeout: 5_000,
    });

    const threadList = window.locator(
      '[data-testid="messenger-thread"] [data-testid="thread-message-list"]',
    );
    await expect(threadList).toBeVisible({ timeout: 10_000 });

    // 8. Evidence. Screenshot at the end captures the #회의록 view
    //    so reviewers can confirm the switch landed.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('meeting-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
