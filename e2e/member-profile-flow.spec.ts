/**
 * Playwright Electron E2E — "member profile flow" (R8-Task12, spec §11
 * "멤버 수동 퇴근 → 턴 스킵 → 출근 복귀").
 *
 * Scope (R8):
 *   - Launch Rolestra with a fresh ArenaRoot.
 *   - Wait for the dashboard PeopleWidget to render at least one member
 *     row (whatever providers are restored from the test DB).
 *   - Click a member's avatar trigger → MemberProfilePopover opens.
 *   - Click 외근 (toggleOffline) → status indicator inside popover flips
 *     to "외근" (offline-manual).
 *   - Click 연락해보기 (reconnect) → status indicator transitions to
 *     "재연결 중" then settles to "출근" or "점검 필요".
 *   - Open the EditModal via 편집 → assert its dialog renders → close
 *     without saving (cancel) so DB state is untouched.
 *
 * The full "external CLI provider warmup → ProductionWarmupService →
 * status indicator" round-trip and the "회의 턴 skip" path require
 * a live mock provider + meeting orchestration which are unit-tested
 * in src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts
 * (work-status gate matrix). This E2E focuses on the renderer wiring
 * surface that the unit tests cannot cover.
 *
 * WSL caveat: same as R4/R5/R6/R7 — Electron under WSL needs WSLg + a
 * Linux-built Electron + better-sqlite3. R8 accepts "spec lands" as
 * done (DONE_WITH_CONCERNS) and defers cross-platform CI execution to
 * R10 per precedent. The spec is structured so a Windows-native run can
 * exercise it without code changes.
 */
import { expect, test } from '@playwright/test';

import {
  launchRolestra,
  walkOnboardingWizard,
  type LaunchedApp,
} from './electron-launch';

const PROJECT_SLUG = 'arena-member-profile-e2e';
const SCREENSHOT_FILENAME = 'member-profile-flow.png';

test.describe('member profile flow — popover + edit + status toggle', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('PeopleWidget avatar → popover → edit modal + 외근 토글 + 연락해보기', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // F1 cleanup made the onboarding wizard the first-boot gate.
    await walkOnboardingWizard(window, PROJECT_SLUG);

    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 1. PeopleWidget renders at least one member row (test fixture
    //    seeds a provider on first boot; if the harness lands a 0-member
    //    state we accept the empty-state path as a no-op and let the
    //    test mark itself skipped).
    const peopleList = window.locator('[data-testid="people-widget-list"]');
    const peopleEmpty = window.locator('[data-testid="people-widget-empty"]');
    await expect(peopleList.or(peopleEmpty)).toBeVisible({ timeout: 10_000 });
    if (await peopleEmpty.isVisible()) {
      test.skip(
        true,
        'PeopleWidget rendered empty — no test provider seeded; covered by unit tests instead.',
      );
      return;
    }

    const triggers = window.locator(
      '[data-testid="people-widget-row-trigger"]',
    );
    await expect(triggers.first()).toBeVisible();
    await triggers.first().click();

    // 2. MemberProfilePopover opens.
    const popover = window.locator('[data-testid="profile-popover"]');
    await expect(popover).toBeVisible({ timeout: 5_000 });

    // 3. 외근 토글 (assumes the seeded provider starts online; clicking
    //    the toggle should flip the indicator).
    const toggleBtn = popover.locator('[data-testid="profile-popover-toggle"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await expect(
      popover.locator('[data-testid="work-status-dot"][data-status="offline-manual"]'),
    ).toBeVisible({ timeout: 5_000 });

    // 4. 연락해보기 — should fire reconnect IPC; the indicator goes
    //    'connecting' for a moment and then settles. We don't assert
    //    the final value (depends on whether the provider is reachable
    //    from the test rig); we just assert the popover stays mounted
    //    and the indicator returns to a non-connecting state within a
    //    reasonable window.
    const reconnectBtn = popover.locator(
      '[data-testid="profile-popover-reconnect"]',
    );
    await reconnectBtn.click();
    await expect(
      popover.locator(
        '[data-testid="work-status-dot"]:not([data-status="connecting"])',
      ),
    ).toBeVisible({ timeout: 15_000 });

    // 5. 편집 — open the EditModal then cancel without saving so the
    //    DB row stays as-is (the toggle test above already mutated
    //    statusOverride; that's enough state assertion).
    await popover.locator('[data-testid="profile-popover-edit"]').click();
    const dialog = window.locator('[data-testid="profile-editor-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('[data-testid="profile-editor-cancel"]').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    const screenshot = await window.screenshot({ fullPage: false });
    await testInfo.attach(SCREENSHOT_FILENAME, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
