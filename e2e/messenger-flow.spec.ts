/**
 * Playwright Electron E2E — "messenger flow" (R5-Task13).
 *
 * Flow under test (spec §7.4):
 *   1. Launch Rolestra with a fresh temp ArenaRoot (via
 *      `ROLESTRA_ARENA_ROOT`, see `electron-launch.ts`).
 *   2. Create a new `kind='new'` project through ProjectCreateModal. This
 *      exercises the R5-Task11 wire-up in `ProjectService.create` →
 *      `ChannelService.createSystemChannels`, so the fresh project must
 *      come with 3 system channels already provisioned.
 *   3. Click the messenger entry in NavRail → `<App>` flips `view` to
 *      `'messenger'` and `<MessengerPage>` mounts.
 *   4. Verify the channel rail shows exactly 3 `system_*` rows
 *      (`일반` / `승인-대기` / `회의록`) plus the `+ 새 채널` button in
 *      the user section.
 *   5. Open ChannelCreateModal via `+ 새 채널`, create a user channel
 *      named `기획` (≥ 3 chars to satisfy `CreateUserChannelInput`).
 *      MessengerPage's `onCreated` callback flips active to the new row.
 *   6. Type `안녕하세요` into the Composer, press `Enter`. The hook
 *      `useChannelMessages.send` pipes through `message:append`; the
 *      Thread refetches via `channel-invalidation-bus` and re-renders
 *      with `data-message-count="1"`.
 *   7. Click the `일반` (system_general) row to switch channels — the
 *      Thread remounts for the new channelId and `data-message-count`
 *      drops back to `"0"` (no messages in the system channel yet).
 *
 * Testability surface (same contract as `external-project-flow.spec.ts`):
 * - `ROLESTRA_ARENA_ROOT` env var: fresh temp root per test, so
 *   settings/DB/link/projects never leak across runs.
 * - `project:pick-folder` OS dialog: NOT stubbed here — the `new` kind
 *   does not open a folder picker, so the stub from the external flow
 *   is unnecessary.
 * - Channel IPC (`channel:create`, `channel:list`, `message:append`,
 *   `message:list-by-channel`): real handlers, real SQLite. The
 *   invalidation bus is a renderer-local pub/sub so no IPC stubbing.
 *
 * WSL caveat:
 * - Same as R4-Task12 — Electron under WSL requires WSLg + a Linux
 *   Electron/better-sqlite3 build. When run from a Windows-native
 *   `npm install` tree, the Linux Electron binary is missing and the
 *   harness throws at launch. R5 accepts "spec + config land" as done
 *   and defers the cross-platform CI execution to R10.
 */
import { expect, test } from '@playwright/test';

import {
  launchRolestra,
  walkOnboardingWizard,
  type LaunchedApp,
} from './electron-launch';

const PROJECT_NAME = 'Arena Messenger E2E';
// Wizard-only slug — must differ from `generateSlug(PROJECT_NAME)`
// (lower-cased + kebabified) to avoid the UNIQUE projects.slug
// collision that hides as a silent project-create failure.
const PROJECT_SLUG = 'arena-messenger-e2e-bootstrap';
// Channel name must be ≥ 3 chars (NAME_MIN_LEN in ChannelCreateModal);
// '기획' alone is two code points and the modal's pre-IPC validation
// rejects it before the create-channel call ever fires.
const USER_CHANNEL_NAME = '기획방';
const MESSAGE_CONTENT = '안녕하세요';
const SCREENSHOT_FILENAME = 'messenger-flow.png';

test.describe('messenger flow — channel create + message send', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('create project → messenger → system channels → create channel → send message → switch', async ({}, testInfo) => {
    // 1. Launch Electron.
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // F1 cleanup made the onboarding wizard the first-boot gate.
    await walkOnboardingWizard(window, PROJECT_SLUG);

    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 2. Create a `kind='new'` project. Opens the modal, fills the name,
    //    leaves `kind` on the default 'new' (no folder picker needed), and
    //    submits. Permission mode stays on the default 'auto' because
    //    `kind='new'` does not disable it (only `kind='external'` does).
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');
    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);
    // Wait for the InitialMembersSelector's prefill to settle before
    // submitting so `project_members` is populated for the new project.
    // Without this gate the submit can win the race against the
    // `provider:list` IPC, leaving the project empty — and the very
    // next user-channel create call fails the composite FK check.
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

    // 3. Flip to the messenger view via NavRail. The `messenger` button's
    //    accessible name is the NAV_ITEMS label 'Messenger' (aria-label).
    await window.locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Messenger' })
      .click();
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 10_000 },
    );

    // 4. System channels section must contain exactly the 3 auto-provisioned
    //    rows. ChannelService blueprint names them 일반 / 승인-대기 / 회의록
    //    and renders them in kind order (`system_general` → `system_approval`
    //    → `system_minutes`).
    const systemSection = window.locator('[data-testid="channel-section-system"]');
    const systemRows = systemSection.locator('[data-testid="channel-row"]');
    await expect(systemRows).toHaveCount(3, { timeout: 10_000 });
    await expect(systemRows.nth(0)).toHaveAttribute('data-channel-kind', 'system_general');
    await expect(systemRows.nth(1)).toHaveAttribute('data-channel-kind', 'system_approval');
    await expect(systemRows.nth(2)).toHaveAttribute('data-channel-kind', 'system_minutes');

    // The user section must initially be empty except for the `+ 새 채널` button.
    const userSection = window.locator('[data-testid="channel-section-user"]');
    await expect(userSection.locator('[data-testid="channel-row"]')).toHaveCount(0);
    await expect(userSection.locator('[data-testid="channel-rail-user-empty"]')).toBeVisible();

    // 5. Create the 기획 user channel.
    await window.click('[data-testid="channel-rail-create"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]');
    await window.fill('[data-testid="channel-create-name"]', USER_CHANNEL_NAME);
    await window.click('[data-testid="channel-create-submit"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]', {
      state: 'detached',
      timeout: 15_000,
    });

    // The new channel row shows up in the user section AND is flipped to
    // active — MessengerPage's `handleCreated` calls `setActiveChannelId`.
    const newRow = userSection
      .locator('[data-testid="channel-row"]')
      .filter({ hasText: USER_CHANNEL_NAME });
    await expect(newRow).toHaveCount(1, { timeout: 10_000 });
    await expect(newRow).toHaveAttribute('data-active', 'true');
    await expect(newRow).toHaveAttribute('data-channel-kind', 'user');

    // 6. Send a message via Composer. The composer always mounts once the
    //    active channel is a writable one — the 기획 channel is `user` kind
    //    so `readOnly=false`.
    const composer = window.locator('[data-testid="composer"][data-readonly="false"]');
    await expect(composer).toBeVisible();
    const textarea = composer.locator('[data-testid="composer-textarea"]');
    await textarea.fill(MESSAGE_CONTENT);
    await textarea.press('Enter');

    // After invalidation, the thread's message-list data attribute flips to
    // "1". We assert on Thread scoped to the active thread pane to avoid
    // matching a stale mount that's still tearing down.
    const threadList = window.locator(
      '[data-testid="messenger-thread"] [data-testid="thread-message-list"]',
    );
    await expect(threadList).toHaveAttribute('data-message-count', '1', {
      timeout: 15_000,
    });

    // Composer resets `value` on success — the input should be empty.
    await expect(textarea).toHaveValue('');

    // 7. Switch to the `일반` (system_general) row and confirm the Thread
    //    refetches for the new channelId with zero messages.
    const generalRow = systemRows.nth(0);
    await generalRow.click();
    await expect(generalRow).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
    await expect(threadList).toHaveAttribute('data-message-count', '0', {
      timeout: 10_000,
    });

    // 8. Evidence. Screenshot at the end captures the system channel (empty
    //    thread) so the reviewer can see the switch landed.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('messenger-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
