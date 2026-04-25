/**
 * Playwright Electron E2E — "search flow" (R11-Task4).
 *
 * Closes R10 Known Concern #3 — `R10-Task2` shipped the `MessageSearchView`
 * + `useMessageSearch` hook with vitest coverage but never landed an E2E
 * spec. This file fills that gap by walking the full user-visible path
 * documented in spec §7.4:
 *
 *   1. Launch Electron with a fresh temp ArenaRoot.
 *   2. Create a `kind='new'` project (which auto-provisions the 3 system
 *      channels) so the search has a real channel + project scope.
 *   3. Open the Messenger view, create a user channel `기획`, and post one
 *      message ("안녕하세요"). The MessageRepository writes both the
 *      `messages` row AND the FTS5 `messages_fts` shadow row inside a
 *      single transaction (R6-Task9), so the search index is hot the
 *      moment the composer's optimistic update reconciles.
 *   4. Click the `ShellTopBar` 🔍 button to open `MessageSearchView`.
 *   5. Type "안녕" into `message-search-input`. The hook debounces by
 *      200ms before firing `message:search`, so we wait for the
 *      results region to settle.
 *   6. Verify exactly one `search-result-row` lands and that its
 *      `data-channel-id` matches the user channel just created.
 *   7. Click the row. The `onNavigate(channelId, messageId)` callback in
 *      `App.tsx` flips active to messenger + the deep-linked channel,
 *      so `MessengerPage` should remount on the same channel — confirmed
 *      via the channel rail's `data-active="true"` flag on the same row.
 *
 * Why no `Cmd/Ctrl+K` keyboard path?
 *   The shortcut is functionally equivalent to the topbar click — both
 *   call `setSearchOpen(true)`. We exercise the click path because it
 *   has more surface area (two interactions: open + close) and matches
 *   the screen-reader-driven path more directly. The keyboard shortcut
 *   stays vitest-covered through `App.test.tsx`.
 *
 * Why FTS5 `snippet()` HTML is not asserted?
 *   The snippet rendering goes through `renderSafeSnippet` which is
 *   pinned by `SearchResultRow.test.tsx`. The E2E only verifies the
 *   row exists and clicks correctly — interrogating the inline `<mark>`
 *   structure here would couple the spec to FTS5's snippet algorithm,
 *   which can change between SQLite versions across OS runners.
 */
import { expect, test } from '@playwright/test';

import { launchRolestra, type LaunchedApp } from './electron-launch';

const PROJECT_NAME = 'Arena Search E2E';
const USER_CHANNEL_NAME = '기획';
const MESSAGE_CONTENT = '안녕하세요 검색';
const SEARCH_QUERY = '안녕';
const SCREENSHOT_FILENAME = 'search-flow.png';

test.describe('search flow — topbar 🔍 → query → row click → channel deep-link', () => {
  let launched: LaunchedApp | null = null;

  test.afterEach(async () => {
    if (launched) {
      await launched.cleanup();
      launched = null;
    }
  });

  test('open search modal, query, click result, verify channel deep-link', async ({}, testInfo) => {
    launched = await launchRolestra();
    const { app } = launched;

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('[data-testid="dashboard-hero"]', {
      timeout: 30_000,
    });

    // 1. Create a `kind='new'` project. Drops us into Dashboard with the
    //    new project active. ProjectService.create auto-provisions the
    //    3 system channels via the `onCreated` hook wired in main/index.ts.
    await window.click('[data-role="create-project"]');
    await window.waitForSelector('[data-testid="project-create-modal"]');
    await window.fill('[data-testid="project-create-name"]', PROJECT_NAME);
    await window.click('[data-testid="project-create-submit"]');
    await window.waitForSelector('[data-testid="project-create-modal"]', {
      state: 'detached',
      timeout: 20_000,
    });

    // 2. Switch to messenger so the user channel + composer surfaces are
    //    available. The NavRail's `Messenger` aria-label is the canonical
    //    accessor (matches messenger-flow.spec.ts).
    await window
      .locator('[data-testid="nav-rail"]')
      .getByRole('button', { name: 'Messenger' })
      .click();
    await window.waitForSelector(
      '[data-testid="messenger-page"][data-empty="false"]',
      { timeout: 10_000 },
    );

    // 3. Create the user channel `기획` so the search has at least one
    //    user-authored row to hit on (system channels are message-empty
    //    on a fresh project).
    await window.click('[data-testid="channel-rail-create"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]');
    await window.fill(
      '[data-testid="channel-create-name"]',
      USER_CHANNEL_NAME,
    );
    await window.click('[data-testid="channel-create-submit"]');
    await window.waitForSelector('[data-testid="channel-create-modal"]', {
      state: 'detached',
      timeout: 15_000,
    });

    // The new channel row flips active automatically. Composer mounts as
    // `data-readonly="false"` because the `user` kind has no read-only
    // gate.
    const composer = window.locator(
      '[data-testid="composer"][data-readonly="false"]',
    );
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // 4. Send a message containing the search needle. The thread updates
    //    via the channel-invalidation-bus once the optimistic insert
    //    reconciles. `data-message-count` is the canonical signal.
    const textarea = composer.locator('[data-testid="composer-textarea"]');
    await textarea.fill(MESSAGE_CONTENT);
    await textarea.press('Enter');

    const threadList = window.locator(
      '[data-testid="messenger-thread"] [data-testid="thread-message-list"]',
    );
    await expect(threadList).toHaveAttribute('data-message-count', '1', {
      timeout: 15_000,
    });

    // Capture the active channel's id so the post-click assertion has
    // a stable reference. ChannelRow exposes the kind + id via data
    // attributes — we read the user-section row that's currently active.
    const activeUserRow = window
      .locator('[data-testid="channel-section-user"]')
      .locator('[data-testid="channel-row"][data-active="true"]');
    await expect(activeUserRow).toHaveCount(1);
    const targetChannelId =
      await activeUserRow.getAttribute('data-channel-id');
    expect(targetChannelId).not.toBeNull();

    // 5. Open the search modal via the topbar button. Same affordance the
    //    user reaches with mouse + screen reader; the keyboard shortcut
    //    is covered at the unit-test layer.
    await window.click('[data-testid="shell-topbar-search"]');
    const dialog = window.locator('[data-testid="message-search-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const searchInput = window.locator('[data-testid="message-search-input"]');
    await expect(searchInput).toBeEnabled();
    await searchInput.fill(SEARCH_QUERY);

    // 6. Wait for the debounced search to land. The hook debounces by
    //    200ms; we wait for the result row to render (toHaveCount handles
    //    the timing implicitly).
    const rows = window.locator('[data-testid="search-result-row"]');
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute(
      'data-channel-id',
      targetChannelId!,
    );

    // 7. Click the row → modal closes + active channel deep-links + the
    //    messenger view stays mounted on the user channel.
    await rows.first().click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    await expect(activeUserRow).toHaveCount(1);
    await expect(activeUserRow).toHaveAttribute(
      'data-channel-id',
      targetChannelId!,
    );

    // Evidence — capture the post-deep-link state.
    const shotPath = testInfo.outputPath(SCREENSHOT_FILENAME);
    await window.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach('search-flow', {
      path: shotPath,
      contentType: 'image/png',
    });
  });
});
