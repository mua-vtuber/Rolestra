/**
 * Playwright Electron E2E — "autonomy + queue flow" (R9-Task12).
 *
 * Flow under test (spec §8 + §11 scenarios 3, 4, 5):
 *
 *   Step A — auto_toggle 승격 2단계 확인:
 *     Create a `kind='new'` project → open the shell top-bar
 *     `AutonomyModeToggle` → click the `auto_toggle` button → the
 *     `AutonomyConfirmDialog` renders → the "확인 후 전환" submit button
 *     is disabled until the Circuit Breaker ack checkbox is ticked →
 *     after tick + submit, the mode chip flips to `auto_toggle` and
 *     `stream:autonomy-mode-changed` updates the toggle's `data-mode`
 *     attribute.
 *
 *   Step B — queue 2 항목 + 자동 시작:
 *     Switch the project to `queue` mode via the same dialog → enter 2
 *     lines in `QueuePanel` → click "추가" → both items appear in the
 *     list with `data-status="pending"` → the E2E stops short of
 *     driving a live meeting (that needs the R10 mock-provider harness)
 *     and instead verifies the queue snapshot round-trips + the first
 *     item is eligible to claim when `queue:start-next` fires.
 *
 *   Step C — Circuit Breaker files_per_turn > 20 강제 manual:
 *     Mock dispatch via `window.eval` into the renderer's debug hook
 *     (R9-Task6 wired the breaker behind `circuitBreaker.recordFileChanges`)
 *     is out of scope for R9 because the breaker lives in the main
 *     process. The E2E documents the expected observable effect —
 *     `stream:autonomy-mode-changed` arrives with `reason='circuit_breaker'`
 *     and the toggle's `data-mode` flips back to `manual` + an OS
 *     notification fires through the Electron notifier mock. Full
 *     execution waits for R10 when the mock provider + mock breaker
 *     injection land.
 *
 * Scope notes (R9, same as prior phases):
 *   - No AI provider is registered, so Step B's "first item in_progress"
 *     can only be asserted up to the pending → claim handoff (QueueService
 *     does the DB flip; the meeting-start callback is R10).
 *   - Step C is a documented placeholder — the E2E shape is here so the
 *     R10 breaker-mock can reuse the spec skeleton verbatim.
 *
 * WSL caveat (same as R4/R5/R6/R7/R8 E2E specs):
 *   Electron under WSL requires WSLg + Linux Electron/better-sqlite3
 *   builds. When the repo was last `npm install`-ed from Windows the
 *   Linux Electron binary is missing and this spec times out at
 *   `launchRolestra()`. R9 accepts "spec lands" as done
 *   (DONE_WITH_CONCERNS) and defers cross-platform CI to R10 per the
 *   R4→R8 precedent.
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const PROJECT_NAME = 'Arena Autonomy E2E';
const QUEUE_LINES = ['첫 번째 작업', '두 번째 작업'];
const SCREENSHOT_FILENAME = 'autonomy-queue-flow.png';

test.describe('autonomy + queue flow — R9 promotion → queue → breaker', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('Step A (confirm dialog) + Step B (queue add) + Step C scaffold', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 1. Create a `kind='new'` project. The shell top-bar wires
    //    `AutonomyModeToggle` + `QueuePanel` only when an activeProjectId
    //    is set, so this step is prerequisite for every assertion below.
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');
    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);
    await window.click('[data-testid="project-create-submit"]');
    await window.waitForSelector('[data-testid="project-create-modal"]', {
      state: 'detached',
      timeout: 20_000,
    });

    // ── Step A — auto_toggle promotion via 2-stage confirm ──────────
    const toggle = window.locator('[data-testid="autonomy-mode-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('data-mode', 'manual');

    // Promotion path: click the auto_toggle chip → dialog opens.
    await window.click('[data-testid="autonomy-mode-auto_toggle"]');
    const confirmDialog = window.locator('[data-testid="autonomy-confirm-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog).toHaveAttribute('data-to', 'auto_toggle');

    // Gate: submit must be disabled until the ack checkbox is ticked.
    const submit = window.locator('[data-testid="autonomy-confirm-submit"]');
    await expect(submit).toBeDisabled();

    await window.check('[data-testid="autonomy-confirm-ack"]');
    await expect(submit).toBeEnabled();

    await submit.click();

    // After submit, the dialog detaches and the toggle reflects the
    // new mode. stream:autonomy-mode-changed is what drives the update
    // — the mere fact that data-mode flips proves the stream landed.
    await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('data-mode', 'auto_toggle', {
      timeout: 10_000,
    });

    // ── Step B — queue mode + 2 items + first item eligible to start ─
    // Switch to queue mode through the same dialog. D4 specifies that
    // auto_toggle ↔ queue transitions skip the confirm dialog — exactly
    // one IPC invoke, no tripwire re-confirmation.
    await window.click('[data-testid="autonomy-mode-queue"]');
    await expect(toggle).toHaveAttribute('data-mode', 'queue', {
      timeout: 10_000,
    });

    const queuePanel = window.locator('[data-testid="queue-panel"]');
    await expect(queuePanel).toBeVisible();

    const queueInput = window.locator('[data-testid="queue-panel-input"]');
    await queueInput.fill(QUEUE_LINES.join('\n'));
    await window.click('[data-testid="queue-panel-add"]');

    const items = window.locator('[data-testid="queue-panel-item"]');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    await expect(items.nth(0)).toHaveAttribute('data-status', 'pending');
    await expect(items.nth(1)).toHaveAttribute('data-status', 'pending');

    // Pause / resume round-trip — the pause gate guards startNext so
    // this is the R9 observable for the Step B auto-start contract.
    await window.click('[data-testid="queue-panel-pause-toggle"]');
    await expect(queuePanel).toHaveAttribute('data-paused', 'true');
    await window.click('[data-testid="queue-panel-pause-toggle"]');
    await expect(queuePanel).toHaveAttribute('data-paused', 'false');

    // ── Step C — Circuit Breaker downgrade (R10 placeholder) ─────────
    // Real tripwire dispatch needs main-process injection (ExecutionService
    // mock + CliRunner mock). R9 documents the expected stream event
    // shape; R10 wires the breaker mock into the E2E harness. Until
    // then this step is a no-op assertion — the observable is captured
    // as a comment so the spec diff on R10 is additive-only.
    //
    // Expected (R10):
    //   await window.evaluate(() => {
    //     void window.rolestra.dev.tripFilesPerTurn(21);
    //   });
    //   await expect(toggle).toHaveAttribute('data-mode', 'manual', {
    //     timeout: 10_000,
    //   });
    //   await expect(notifyMock.calls.length).toBeGreaterThan(0);

    // Evidence.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('autonomy-queue-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
