/** Real layout coverage for following the newest chat row without losing a reader's place. */
import { expect, test, type Locator } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { FAKE_OLLAMA_MODEL, startFakeProvider } from './support/fake-provider';
import { launchIsolatedApp, sendMessage, type IsolatedApp } from './support/isolated-app';
import { addLocalAi } from './support/local-ai';
import { chatListRow, createRoom } from './support/messenger-ui';

async function expectAtBottom(list: Locator): Promise<void> {
  await expect.poll(() => list.evaluate((element) =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)))
    .toBeLessThanOrEqual(2);
}

for (const { themeKey, layout } of [
  { themeKey: 'tactical', layout: 'bubbles' },
  { themeKey: 'retro', layout: 'log' },
] as const) {
  test(`${layout} chat follows new replies, preserves reading position and resets for another room`, async ({}, testInfo) => {
    test.setTimeout(120_000);
    const fake = await startFakeProvider();
    let isolated: IsolatedApp | null = null;
    let releaseReply: (() => void) | undefined;
    try {
      isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
      const page = await isolated.app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.evaluate((key) => {
        localStorage.setItem('rolestra.theme.v1', JSON.stringify({
          version: 1, state: { themeKey: key, mode: 'light' },
        }));
      }, themeKey);
      const provider = await addLocalAi(page, fake, 'Scroll AI', FAKE_OLLAMA_MODEL);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', themeKey);
      const roomId = await createRoom(page, `Scroll ${layout}`, [provider.id]);
      const list = page.getByTestId('thread-message-list');
      const replies = list.locator('[data-testid="message"][data-author-kind="member"]');
      const indicator = page.getByTestId('chat-activity-indicator');
      const passButton = page.getByTestId('chat-pass-turn');
      await expect(list).toHaveAttribute('data-layout', layout);

      // A few tall messages overflow either layout without depending on font metrics.
      for (let index = 0; index < 6; index += 1) {
        await sendMessage(page, `History ${index}\n${'A line of chat history to read.\n'.repeat(10)}`);
        await expect(replies).toHaveCount(index + 1);
        await expect(indicator).toHaveText('');
      }

      // Opening persisted history starts at the latest row, including after fonts settle.
      await page.reload();
      await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', roomId);
      await expect(replies).toHaveCount(6);
      await page.evaluate(async () => { await document.fonts.ready; });
      expect(await list.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeGreaterThan(500);
      await expectAtBottom(list);
      await expect(replies.last()).toBeInViewport();

      // A pass starts a real delayed AI response without focusing or typing in the composer.
      releaseReply = fake.hold(FAKE_OLLAMA_MODEL);
      await passButton.click();
      await expect(indicator).not.toHaveText('');
      await expectAtBottom(list);
      releaseReply();
      releaseReply = undefined;
      await expect(replies).toHaveCount(7);
      await expect(indicator).toHaveText('');
      await expectAtBottom(list);

      // A reader scrolling away from the newest row keeps that position on arrival.
      releaseReply = fake.hold(FAKE_OLLAMA_MODEL);
      await passButton.click();
      await expect(indicator).not.toHaveText('');
      await list.hover();
      await page.mouse.wheel(0, -100_000);
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
      releaseReply();
      releaseReply = undefined;
      await expect(replies).toHaveCount(8);
      await expect(indicator).toHaveText('');
      expect(await list.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(2);

      // Reaching the bottom again resumes following an already pending response.
      releaseReply = fake.hold(FAKE_OLLAMA_MODEL);
      await passButton.click();
      await expect(indicator).not.toHaveText('');
      await list.hover();
      await page.mouse.wheel(0, 100_000);
      await expectAtBottom(list);
      releaseReply();
      releaseReply = undefined;
      await expect(replies).toHaveCount(9);
      await expect(indicator).toHaveText('');
      await expectAtBottom(list);

      const originalHeight = await list.evaluate((element) => element.clientHeight);
      await page.setViewportSize({ width: 1280, height: 600 });
      await expect.poll(() => list.evaluate((element) => element.clientHeight)).toBeLessThan(originalHeight);
      await expectAtBottom(list);
      await expect(replies.last()).toBeInViewport();
      const originalWidth = await list.evaluate((element) => element.clientWidth);
      await page.setViewportSize({ width: 1000, height: 600 });
      await expect.poll(() => list.evaluate((element) => element.clientWidth)).toBeLessThan(originalWidth);
      await expectAtBottom(list);
      await expect(replies.last()).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`${layout}-following-after-resize.png`) });

      // A prior reading position does not carry over when reopening a conversation.
      await list.hover();
      await page.mouse.wheel(0, -100_000);
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
      await createRoom(page, `Other ${layout}`, [provider.id]);
      await chatListRow(page, roomId).click();
      await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', roomId);
      await expect(replies).toHaveCount(9);
      await expectAtBottom(list);
      await expect(replies.last()).toBeInViewport();
    } finally {
      releaseReply?.();
      if (isolated) await isolated.app.close().catch(() => {});
      await fake.close();
      if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
    }
  });
}
