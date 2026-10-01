/**
 * Spec 2026-10-01 rounds through the real Electron app and an offline fake
 * model (`support/fake-provider.ts`):
 * - F1 the pass button starts a round without user text;
 * - F5 the writing indicator appears while a turn runs and clears after it;
 * - F3 a round in which every AI stays silent ends with one observer notice.
 * Whisper threads of several rows are covered in `chat-first-flow.spec.ts`.
 */
import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { passPublicLine, startFakeProvider, type FakeProvider } from './support/fake-provider';
import { invokeInApp, launchIsolatedApp, sendMessage, type IsolatedApp } from './support/isolated-app';
import { addLocalAi } from './support/local-ai';
import { createRoom } from './support/messenger-ui';

/** Model-facing pass line and stored code, as main defines them (chat-whisper-output.ts, message-types.ts). */
const PASS_MODEL_LINE = 'The user added nothing and let the conversation continue.';
const PASS_CODE = 'user_pass';

async function addProviders(page: Page, fake: FakeProvider,
  entries: Array<{ name: string; model: string }>): Promise<Array<{ id: string; displayName: string }>> {
  return Promise.all(entries.map(({ name, model }) => addLocalAi(page, fake, name, model)));
}

test('the pass button starts a round without user text while the writing indicator follows each turn', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const [alice, bob] = await addProviders(page, fake, [
      { name: 'Pass Alice', model: 'e2e-pass-a' }, { name: 'Pass Bob', model: 'e2e-pass-b' },
    ]);
    await page.reload();
    const roomId = await createRoom(page, 'Pass room', [alice!.id, bob!.id]);
    const before = await invokeInApp(page, 'message:list-by-channel', { channelId: roomId });
    expect(before.messages.filter((message) => message.authorKind === 'user')).toEqual([]);

    const passButton = page.getByTestId('chat-pass-turn');
    const indicator = page.getByTestId('chat-activity-indicator');
    await expect(indicator).toHaveAttribute('aria-live', 'polite');
    await expect(indicator).toHaveText('');
    const releaseAlice = fake.hold('e2e-pass-a');
    await passButton.click();
    await expect(indicator).toHaveText(/^Pass Alice (입력 중…|is typing…)$/);
    await expect(passButton).toBeDisabled();
    await expect(invokeInApp(page, 'chat:pass-turn', { channelId: roomId }))
      .rejects.toThrow(/chat_pass_rejected:round_running/);
    const writingScreenshot = testInfo.outputPath('pass-writing.png');
    await page.screenshot({ path: writingScreenshot, fullPage: true });
    await testInfo.attach('pass-writing', { path: writingScreenshot, contentType: 'image/png' });
    // A reloaded window reads the running round from main (QA M1), so the
    // button stays disabled although it missed the round's start event.
    await page.reload();
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', roomId);
    await expect(passButton).toBeDisabled();
    releaseAlice();

    const list = page.getByTestId('thread-message-list');
    await expect(list.getByText(passPublicLine('e2e-pass-b'), { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(indicator).toHaveText('');
    await expect(passButton).toBeEnabled();

    const { messages } = await invokeInApp(page, 'message:list-by-channel', { channelId: roomId });
    const chronological = [...messages].reverse();
    const userRows = chronological.filter((message) => message.authorKind === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0]).toMatchObject({ role: 'user', content: PASS_CODE, meta: { chatPass: PASS_CODE } });
    expect(chronological.filter((message) => message.role === 'assistant').map((message) => message.content))
      .toEqual([passPublicLine('e2e-pass-a'), passPublicLine('e2e-pass-b')]);
    await expect(page.getByTestId('system-message-body').filter({ hasText: /^(넘김|Passed)$/ })).toHaveCount(1);
    await expect(list.getByText(PASS_CODE, { exact: true })).toHaveCount(0);

    const passRequests = fake.requests.filter((request) => request.model?.startsWith('e2e-pass-'));
    expect(passRequests.map((request) => request.model)).toEqual(['e2e-pass-a', 'e2e-pass-b']);
    for (const request of passRequests) {
      expect(request.messages.some((message) => message.content.includes(PASS_MODEL_LINE))).toBe(true);
      expect(request.rawBody).not.toContain(PASS_CODE);
    }
    const search = await invokeInApp(page, 'message:search', { query: 'user', scope: { kind: 'channel', channelId: roomId } });
    expect(search.hits).toEqual([]);

    const { channel: dm } = await invokeInApp(page, 'dm:create', { providerId: alice!.id });
    await expect(invokeInApp(page, 'chat:pass-turn', { channelId: dm.id }))
      .rejects.toThrow(/chat_pass_rejected:dm_channel/);
    // Legacy DM services still handle existing conversations, but neither
    // the chat list nor its cross-chat search can open them from the UI.
    await invokeInApp(page, 'message:append', { channelId: dm.id, content: 'CF4_DM_MESSAGE hello privately.' });
    await expect.poll(async () => {
      const response = await invokeInApp(page, 'message:list-by-channel', { channelId: dm.id });
      return response.messages.some((message) => message.content === 'CF4_REPLY_DM_1');
    }, { timeout: 20_000 }).toBe(true);
    const legacySearch = await invokeInApp(page, 'message:search', {
      query: 'CF4_DM_MESSAGE', scope: { kind: 'channel', channelId: dm.id },
    });
    expect(legacySearch.hits).toHaveLength(1);
    const chatSearch = await invokeInApp(page, 'message:search', {
      query: 'CF4_DM_MESSAGE', scope: { kind: 'chats' },
    });
    expect(chatSearch.hits).toEqual([]);
    await page.reload();
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', roomId);
    await expect(page.locator('[data-testid="chat-list-row"][data-kind="dm"]')).toHaveCount(0);
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

test('a round in which every AI stays silent ends with one all-silent notice that no model reads', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const [alice, bob] = await addProviders(page, fake, [
      { name: 'Quiet Alice', model: 'e2e-silent-a' }, { name: 'Quiet Bob', model: 'e2e-silent-b' },
    ]);
    await page.reload();
    const roomId = await createRoom(page, 'Quiet room', [alice!.id, bob!.id]);
    const allSilentCount = async (): Promise<number> => {
      const { messages } = await invokeInApp(page, 'message:list-by-channel', { channelId: roomId });
      return messages.filter((message) => message.meta?.chatSilence?.code === 'round_all_silent').length;
    };

    await sendMessage(page, 'E2E_SILENCE_ONE');
    await expect.poll(allSilentCount, { timeout: 30_000 }).toBe(1);
    const allSilent = page.getByTestId('system-message')
      .filter({ hasText: /^(모두 조용해졌습니다|Everyone has gone quiet\.)$/ });
    await expect(allSilent).toHaveCount(1);
    await expect(allSilent).toHaveAttribute('data-tone', 'quiet');
    const { messages } = await invokeInApp(page, 'message:list-by-channel', { channelId: roomId });
    expect([...messages].reverse().filter((message) => message.role === 'system').map((message) =>
      message.meta?.chatSilence?.code)).toEqual(['turn_passed', 'turn_passed', 'round_all_silent']);
    const silentScreenshot = testInfo.outputPath('all-silent.png');
    await page.screenshot({ path: silentScreenshot, fullPage: true });
    await testInfo.attach('all-silent', { path: silentScreenshot, contentType: 'image/png' });

    await sendMessage(page, 'E2E_SILENCE_TWO');
    await expect.poll(allSilentCount, { timeout: 30_000 }).toBe(2);
    const secondRound = fake.requests.filter((request) =>
      request.messages.some((message) => message.content.includes('E2E_SILENCE_TWO')));
    expect(secondRound.map((request) => request.model)).toEqual(['e2e-silent-a', 'e2e-silent-b']);
    for (const request of secondRound) {
      expect(request.rawBody).not.toContain('round_all_silent');
      expect(request.rawBody).not.toContain('turn_passed');
    }
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});
