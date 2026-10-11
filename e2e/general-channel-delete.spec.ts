/**
 * Spec 2026-10-08 F1 through the real Electron app: the general channel can
 * be deleted from its ⋯ menu, stays gone after a restart, and with no other
 * conversation left the thread offers "새 대화방 만들기", which opens the new
 * room. Kept apart from `chat-first-flow.spec.ts` so that file stays under
 * the 800-line limit.
 */
import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { FAKE_OLLAMA_MODEL, startFakeProvider } from './support/fake-provider';
import { invokeInApp, launchIsolatedApp, restartIsolatedApp, type IsolatedApp } from './support/isolated-app';
import { addLocalAi } from './support/local-ai';
import { clickRoomMenuItem, generalChatRow } from './support/messenger-ui';

test('the deleted general channel stays gone after restart and an empty app offers a new room', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    let page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const ai = await addLocalAi(page, fake, 'Solo Sky', FAKE_OLLAMA_MODEL);
    await page.reload();

    const general = generalChatRow(page);
    await expect(general).toBeVisible({ timeout: 15_000 });
    await general.click();
    const { channel } = await invokeInApp(page, 'channel:get-global-general', undefined);
    if (channel === null) throw new Error('A fresh install must start with the general channel');
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', channel.id);

    await clickRoomMenuItem(page, 'chat-delete-general');
    const confirm = page.getByTestId('channel-delete-confirm');
    await expect(confirm).toHaveAttribute('data-channel-kind', 'system_general');
    await page.screenshot({ path: testInfo.outputPath('general-delete-confirm.png'), fullPage: true });
    await page.getByTestId('channel-delete-submit').click();
    await expect(confirm).toBeHidden();
    await expect(general).toHaveCount(0);
    await expect(page.getByTestId('thread-no-conversations')).toBeVisible();

    page = await restartIsolatedApp(isolated);
    await expect(page.getByTestId('chat-list')).toBeVisible({ timeout: 15_000 });
    await expect(generalChatRow(page)).toHaveCount(0);
    expect((await invokeInApp(page, 'channel:get-global-general', undefined)).channel).toBeNull();
    const empty = page.getByTestId('thread-no-conversations');
    await expect(empty).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('no-conversations.png'), fullPage: true });

    await page.getByTestId('thread-create-room').click();
    await page.getByTestId('room-create-name').fill('After general');
    await page.getByTestId(`room-participant-${ai.id}`).check();
    await page.getByTestId('room-create-submit').click();
    await expect(page.getByTestId('room-create-dialog')).toBeHidden();
    const { rooms } = await invokeInApp(page, 'room:list', undefined);
    const room = rooms.find((entry) => entry.name === 'After general');
    if (!room) throw new Error('The room created from the empty state is missing');
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await expect(empty).toHaveCount(0);
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});
