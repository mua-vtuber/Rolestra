/**
 * Chat-first Electron E2E: rooms, whispers, votes and restart survival.
 * Spec 2026-10-01 rounds (pass button, all-silent notice, writing indicator)
 * live in `chat-rounds.spec.ts`; both share `support/`.
 */
import { expect, test } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { E2E_WHISPER_TEXT, FAKE_OLLAMA_MODEL, startFakeProvider } from './support/fake-provider';
import {
  invokeInApp, launchIsolatedApp, restartIsolatedApp, sendMessage, type IsolatedApp, type TestArenaBridge,
} from './support/isolated-app';
import { addLocalAi } from './support/local-ai';
import {
  chatListFilter, chatListRow, clickRoomMenuItem, createRoom, generalChatRow, navButton,
  openRoomInfo,
} from './support/messenger-ui';

test('rooms freeze personas and remain readable after archive and restart', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    let page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const first = await addLocalAi(page, fake, 'Room Alice', FAKE_OLLAMA_MODEL);
    const second = await addLocalAi(page, fake, 'Room Bob', FAKE_OLLAMA_MODEL);
    await invokeInApp(page, 'member:update-profile', { providerId: first.id, patch: { characterSheet: 'SNAPSHOT_CALM' } });
    // Reload so the member list sees both test-only connections.
    await page.reload();
    await page.getByTestId('room-create-open').click();
    await page.getByTestId('room-create-name').fill('Evening story');
    await page.getByTestId(`room-participant-${first.id}`).check();
    await page.getByTestId(`room-participant-${second.id}`).check();
    await page.getByTestId(`room-persona-source-${second.id}`).selectOption('custom');
    await page.getByTestId(`room-persona-text-${second.id}`).fill('SNAPSHOT_CUSTOM: a cheerful witness.');
    await expect(page.getByTestId('room-create-submit')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('room-create.png'), fullPage: true });
    await page.getByTestId('room-create-submit').click();
    await expect(page.getByTestId('room-create-dialog')).toBeHidden();
    const { rooms } = await invokeInApp(page, 'room:list', undefined);
    const room = rooms.find((entry) => entry.name === 'Evening story')!;
    expect(room).toBeDefined();
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await invokeInApp(page, 'member:update-profile', { providerId: first.id, patch: { characterSheet: 'CHANGED_GLOBAL' } });
    await sendMessage(page, 'ROOM_SNAPSHOT_MESSAGE');
    await expect(page.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER', { exact: true })).toHaveCount(2);
    expect(fake.requests.some((request) => request.messages.some((message) => message.role === 'system' && message.content.includes('SNAPSHOT_CALM')))).toBe(true);
    expect(fake.requests.some((request) => request.messages.some((message) => message.role === 'system' && message.content.includes('SNAPSHOT_CUSTOM')))).toBe(true);
    expect(fake.requests.some((request) => request.messages.some((message) => message.content.includes('CHANGED_GLOBAL')))).toBe(false);
    const { room: other } = await invokeInApp(page, 'room:create', {
      name: 'Other room', participants: [{ providerId: first.id, personaSource: 'default' }],
    });
    await clickRoomMenuItem(page, 'room-archive-open');
    await page.getByTestId('room-action-confirm').click();
    await expect(page.getByTestId('room-archived-notice')).toBeVisible();
    await expect(page.getByTestId('composer-textarea')).toBeDisabled();
    await expect(invokeInApp(page, 'message:append', { channelId: room.id, content: 'forbidden' })).rejects.toThrow();
    const search = await invokeInApp(page, 'message:search', { query: 'ROOM_SNAPSHOT_MESSAGE', scope: { kind: 'channel', channelId: room.id } });
    expect(JSON.stringify(search)).toContain('ROOM_SNAPSHOT_MESSAGE');
    page = await restartIsolatedApp(isolated);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await expect(page.getByTestId('composer-textarea')).toBeDisabled();
    await expect(page.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER', { exact: true })).toHaveCount(2);
    await openRoomInfo(page);
    await page.getByTestId('member-row-trigger').first().click();
    await expect(page.getByTestId('profile-popover-edit')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Archived rooms leave 전체 and show only under 보관함.
    await expect(chatListRow(page, room.id)).toHaveCount(0);
    await chatListFilter(page, 'archive').click();
    await expect(chatListRow(page, room.id)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('room-archive.png'), fullPage: true });
    await clickRoomMenuItem(page, 'room-delete-open');
    await page.getByTestId('room-action-confirm').click();
    await expect(chatListRow(page, room.id)).toHaveCount(0);
    const remaining = await invokeInApp(page, 'room:list', undefined);
    expect(remaining.rooms.map((entry) => entry.id)).toEqual([other.id]);
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

test('a background room context menu keeps the active room selected and targets its own actions', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const provider = await addLocalAi(page, fake, 'Context AI', FAKE_OLLAMA_MODEL);
    await page.reload();
    const activeRoomId = await createRoom(page, 'Keep this room open', [provider.id]);
    await sendMessage(page, 'E2E_CONTEXT_KEEP this conversation intact.');
    await expect(page.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER', { exact: true }))
      .toBeVisible({ timeout: 20_000 });
    const targetRoomId = await createRoom(page, 'Background action target', [provider.id]);
    const menu = page.getByTestId('room-menu');
    const menuItems = async () => menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => ({
      testId: item.getAttribute('data-testid'), label: item.textContent,
    })));

    await page.getByTestId('room-menu-open').click();
    await expect(menu).toBeVisible();
    const headerItems = await menuItems();
    expect(headerItems.map((item) => item.testId)).toEqual(['chat-post-opinion', 'room-archive-open']);
    await page.keyboard.press('Escape');
    await chatListRow(page, activeRoomId).click();
    await chatListRow(page, targetRoomId).click({ button: 'right' });
    await expect(menu).toBeVisible();
    expect(await menuItems()).toEqual(headerItems);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', activeRoomId);
    await expect(chatListRow(page, activeRoomId)).toHaveAttribute('data-active', 'true');
    await expect(chatListRow(page, targetRoomId)).toHaveAttribute('data-active', 'false');
    await page.screenshot({ path: testInfo.outputPath('background-room-context-menu.png'), fullPage: true });

    // Opinion posting uses the clicked room while the current thread stays open.
    await page.getByTestId('chat-post-opinion').click();
    await expect(page.getByTestId('post-opinion-modal')).toHaveAttribute('data-channel-id', targetRoomId);
    await page.getByTestId('post-opinion-title').fill('Background room proposal');
    await page.getByTestId('post-opinion-content').fill('Only the background room receives this proposal.');
    await page.getByTestId('post-opinion-submit').click();
    await expect(page.getByTestId('post-opinion-modal')).toBeHidden();
    const targetCards = await invokeInApp(page, 'opinion:listGeneralCards', { channelId: targetRoomId });
    const activeCards = await invokeInApp(page, 'opinion:listGeneralCards', { channelId: activeRoomId });
    expect(targetCards.result.cards.map((card) => card.opinion.title)).toEqual(['Background room proposal']);
    expect(activeCards.result.cards).toEqual([]);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', activeRoomId);

    // Dismissing the archive confirmation must leave the target writable.
    await chatListRow(page, targetRoomId).click({ button: 'right' });
    await page.getByTestId('room-archive-open').click();
    await expect(page.getByTestId('room-action-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('room-action-dialog')).toBeHidden();
    const beforeArchive = await invokeInApp(page, 'room:list', undefined);
    expect(beforeArchive.rooms.find((room) => room.id === targetRoomId)?.archivedAt).toBeNull();
    await chatListRow(page, targetRoomId).click({ button: 'right' });
    await page.getByTestId('room-archive-open').click();
    await page.getByTestId('room-action-confirm').click();
    await expect(page.getByTestId('room-action-dialog')).toBeHidden();
    await expect(chatListRow(page, targetRoomId)).toHaveCount(0);
    const afterArchive = await invokeInApp(page, 'room:list', undefined);
    expect(afterArchive.rooms.find((room) => room.id === targetRoomId)).toMatchObject({ readOnly: true });
    expect(afterArchive.rooms.find((room) => room.id === activeRoomId)).toMatchObject({
      readOnly: false, archivedAt: null,
    });
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', activeRoomId);
    await expect(page.getByTestId('composer-textarea')).toBeEnabled();

    await chatListFilter(page, 'archive').click();
    await chatListRow(page, targetRoomId).click({ button: 'right' });
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(page.getByTestId('room-delete-open')).toBeVisible();
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', activeRoomId);
    await page.getByTestId('room-delete-open').click();
    await expect(page.getByTestId('room-action-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('room-action-dialog')).toBeHidden();
    await expect(chatListRow(page, targetRoomId)).toBeVisible();
    await chatListRow(page, targetRoomId).click({ button: 'right' });
    await page.getByTestId('room-delete-open').click();
    await page.getByTestId('room-action-confirm').click();
    await expect(chatListRow(page, targetRoomId)).toHaveCount(0);
    const afterDelete = await invokeInApp(page, 'room:list', undefined);
    expect(afterDelete.rooms.map((room) => room.id)).toEqual([activeRoomId]);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', activeRoomId);
    await expect(page.getByTestId('composer-textarea')).toBeEnabled();
    await expect(page.getByTestId('thread-message-list').getByText('E2E_CONTEXT_KEEP this conversation intact.', { exact: true }))
      .toBeVisible();
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

test('AI whisper and private reply remain observer-visible without reaching a third AI', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    let page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const participants = await Promise.all([
      { name: 'Alice', model: 'e2e-whisper-a' },
      { name: 'Bob', model: 'e2e-whisper-b' },
      { name: 'Charlie', model: 'e2e-whisper-c' },
    ].map(({ name, model }) => addLocalAi(page, fake, name, model)));
    fake.setWhisperRecipientName(participants[1]!.displayName);
    await page.reload();
    await page.getByTestId('room-create-open').click();
    await page.getByTestId('room-create-name').fill('Whisper room');
    for (const participant of participants) {
      await page.getByTestId(`room-participant-${participant.id}`).check();
    }
    await page.getByTestId('room-create-submit').click();
    await expect(page.getByTestId('room-create-dialog')).toBeHidden();
    const { rooms } = await invokeInApp(page, 'room:list', undefined);
    const room = rooms.find((entry) => entry.name === 'Whisper room');
    expect(room).toBeDefined();
    if (!room) throw new Error('Whisper room was not created');

    await sendMessage(page, 'E2E_WHISPER_ROOT Alice, share one note privately with Bob.');
    // The fake answers the thread deterministically (support/fake-provider.ts):
    // A whispers, B answers, A answers once more, B returns null on the later
    // reply hint, so the thread is exactly three rows (spec 2026-10-01 F2).
    // Wait for the whole round: B's and C's public turns come after the thread.
    await expect.poll(async () => {
      const { messages } = await invokeInApp(page, 'message:list-by-channel', { channelId: room.id });
      return messages.filter((message) => message.content === 'E2E_PUBLIC_e2e-whisper-b' ||
        message.content === 'E2E_PUBLIC_e2e-whisper-c').length;
    }, { timeout: 30_000 }).toBe(2);
    const { messages: firstRound } = await invokeInApp(page, 'message:list-by-channel', { channelId: room.id });
    const privateMessages = firstRound.filter((message) => message.visibility === 'whisper')
      .sort((left, right) => (left.whisper?.threadSeq ?? 0) - (right.whisper?.threadSeq ?? 0));
    expect(privateMessages.map((message) => message.whisper?.threadSeq)).toEqual([1, 2, 3]);
    const [root, reply, secondReply] = privateMessages;
    expect(root?.content).toBe(E2E_WHISPER_TEXT.root);
    expect(root?.authorId).toBe(participants[0]!.id);
    expect(root?.whisper?.recipientId).toBe(participants[1]!.id);
    expect(root?.whisper?.replyToMessageId).toBeNull();
    expect(reply?.content).toBe(E2E_WHISPER_TEXT.firstReply);
    expect(reply?.authorId).toBe(participants[1]!.id);
    expect(reply?.whisper?.recipientId).toBe(participants[0]!.id);
    expect(reply?.whisper?.replyToMessageId).toBe(root?.id);
    expect(secondReply?.content).toBe(E2E_WHISPER_TEXT.secondReply);
    expect(secondReply?.authorId).toBe(participants[0]!.id);
    expect(secondReply?.whisper?.recipientId).toBe(participants[1]!.id);
    expect(secondReply?.whisper?.replyToMessageId).toBe(root?.id);
    // B was asked for the fourth row and declined; a later decline ends the thread quietly.
    expect(fake.requests.filter((request) => request.model === 'e2e-whisper-b' &&
      request.messages.some((message) => message.content.includes('they answered you.')))).toHaveLength(1);
    expect(firstRound.some((message) => message.meta?.chatSilence?.code === 'reply_passed')).toBe(false);
    await expect(page.getByTestId('thread-whisper-observer-notice')).toBeVisible();
    await expect(page.getByTestId('message-whisper-kind')).toHaveCount(3);
    const whisperRows = page.locator('[data-testid="message"][data-visibility="whisper"]');
    await expect(whisperRows).toHaveCount(3);
    expect(await whisperRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-thread-seq'))))
      .toEqual(['1', '2', '3']);
    await expect(page.getByTestId('message-whisper-route')).toHaveText([
      /Alice → Bob/, /Bob → Alice/, /Alice → Bob/,
    ]);
    const liveScreenshot = testInfo.outputPath('whisper-live.png');
    await page.screenshot({ path: liveScreenshot, fullPage: true });
    await testInfo.attach('whisper-live', { path: liveScreenshot, contentType: 'image/png' });

    await sendMessage(page, 'E2E_WHISPER_FOLLOWUP continue publicly.');
    await expect.poll(() => fake.requests.filter((request) =>
      request.messages.some((message) => message.content.includes('E2E_WHISPER_FOLLOWUP')),
    ).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    const followup = fake.requests.filter((request) =>
      request.messages.some((message) => message.content.includes('E2E_WHISPER_FOLLOWUP')));
    expect(followup.find((request) => request.model === 'e2e-whisper-a')?.messages.some((message) =>
      message.content.includes('E2E_SECRET_A_TO_B'))).toBe(true);
    expect(followup.find((request) => request.model === 'e2e-whisper-b')?.messages.some((message) =>
      message.content.includes('E2E_SECRET_A_TO_B'))).toBe(true);
    expect(fake.requests.filter((request) => request.model === 'e2e-whisper-c').every((request) =>
      request.messages.every((message) => !message.content.includes('E2E_SECRET_A_TO_B') &&
        !message.content.includes('E2E_PRIVATE_REPLY') &&
        !message.content.includes(E2E_WHISPER_TEXT.secondReply)))).toBe(true);
    // Models address and see participants by display name and opaque alias
    // only; no request body carries a participant's provider id (spec 2026-09-29 §C).
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const participant of participants) {
      expect(fake.requests.filter((request) => request.rawBody.includes(participant.id))).toHaveLength(0);
    }
    await expect.poll(async () => {
      const { messages } = await invokeInApp(page, 'message:list-by-channel', { channelId: room.id });
      return messages.filter((message) => message.content.startsWith('E2E_PUBLIC_FOLLOWUP_')).length;
    }, { timeout: 30_000 }).toBe(3);

    const observerSearch = await invokeInApp(page, 'message:search', {
      query: 'E2E_SECRET_A_TO_B', scope: { kind: 'channel', channelId: room.id },
    });
    expect(observerSearch.hits).toHaveLength(1);
    expect(observerSearch.hits[0]?.visibility).toBe('whisper');
    expect(observerSearch.hits[0]?.whisper?.recipientId).toBe(participants[1]!.id);
    await page.getByTestId('room-search-open').click();
    await page.getByTestId('message-search-input').fill('E2E_SECRET_A_TO_B');
    await expect(page.getByTestId('search-result-whisper-route')).toContainText('Alice → Bob');
    await page.getByTestId('message-search-close').click();

    await clickRoomMenuItem(page, 'room-archive-open');
    await page.getByTestId('room-action-confirm').click();
    await expect(page.getByTestId('room-archived-notice')).toBeVisible();
    const requestCount = fake.requests.length;
    page = await restartIsolatedApp(isolated);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await expect(page.getByTestId('composer-textarea')).toBeDisabled();
    await expect(page.getByTestId('thread-whisper-observer-notice')).toBeVisible();
    await expect(page.getByTestId('message-whisper-kind')).toHaveCount(3);
    expect(fake.requests).toHaveLength(requestCount);
    const archivedSearch = await invokeInApp(page, 'message:search', {
      query: 'E2E_SECRET_A_TO_B', scope: { kind: 'channel', channelId: room.id },
    });
    expect(archivedSearch.hits[0]?.visibility).toBe('whisper');
    const archiveScreenshot = testInfo.outputPath('whisper-archived.png');
    await page.screenshot({ path: archiveScreenshot, fullPage: true });
    await testInfo.attach('whisper-archived', { path: archiveScreenshot, contentType: 'image/png' });
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

test('room opinion voting starts explicitly and retains distinct results after restart', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  const voteRequestCount = (): number => fake.requests.filter(
    (request) => request.messages.some((message) => message.content.includes('Respond with only JSON {"opinion"')),
  ).length;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    let page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const participants = await Promise.all([
      { name: 'Vote Agree', model: 'e2e-vote-agree' },
      { name: 'Vote Oppose', model: 'e2e-vote-oppose' },
      { name: 'Vote Abstain', model: 'e2e-vote-abstain' },
      { name: 'Vote Invalid', model: 'e2e-vote-invalid' },
    ].map(({ name, model }) => addLocalAi(page, fake, name, model)));

    await page.reload();
    await page.getByTestId('room-create-open').click();
    await page.getByTestId('room-create-name').fill('Vote room');
    for (const participant of participants) {
      await page.getByTestId(`room-participant-${participant.id}`).check();
    }
    await page.getByTestId('room-create-submit').click();
    await expect(page.getByTestId('room-create-dialog')).toBeHidden();
    const { rooms } = await invokeInApp(page, 'room:list', undefined);
    const room = rooms.find((entry) => entry.name === 'Vote room');
    expect(room).toBeDefined();
    if (!room) throw new Error('Vote room was not created');
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);

    await clickRoomMenuItem(page, 'chat-post-opinion');
    await page.getByTestId('post-opinion-title').fill('Adopt the proposal');
    await page.getByTestId('post-opinion-content').fill('Should the room adopt this proposal?');
    await page.getByTestId('post-opinion-submit').click();
    await expect(page.getByTestId('post-opinion-modal')).toBeHidden();
    const { result: cardList } = await invokeInApp(page, 'opinion:listGeneralCards', { channelId: room.id });
    const opinion = cardList.cards.find((card) => card.opinion.title === 'Adopt the proposal')?.opinion;
    expect(opinion).toBeDefined();
    if (!opinion) throw new Error('Posted opinion was not found');
    await openRoomInfo(page);
    await expect(page.locator(`[data-testid="ssm-box-general-card"][data-card-id="${opinion.id}"]`)).toBeVisible();
    expect(cardList.cards.find((entry) => entry.opinion.id === opinion.id)?.userVote).toBeNull();
    await page.reload();
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await openRoomInfo(page);
    await expect(page.locator(`[data-testid="chat-vote-start"][data-card-id="${opinion.id}"]`)).toBeVisible();
    expect((await invokeInApp(page, 'opinion:getVote', { opinionId: opinion.id })).result).toBeNull();
    expect(voteRequestCount()).toBe(0);

    await page.locator(`[data-testid="chat-vote-start"][data-card-id="${opinion.id}"]`).click();
    await expect.poll(async () =>
      (await invokeInApp(page, 'opinion:getVote', { opinionId: opinion.id })).result?.status,
    ).toBe('completed');
    const { result: vote } = await invokeInApp(page, 'opinion:getVote', { opinionId: opinion.id });
    expect(vote).not.toBeNull();
    if (!vote) throw new Error('Completed vote disappeared');
    expect(vote.counts).toEqual({
      agree: 1, oppose: 1, abstain: 1, pending: 0, failed: 1, total: 4,
    });
    expect(vote.participants.map(({ providerId, status, vote: choice, error }) => ({
      providerId, status, choice, error,
    }))).toEqual([
      { providerId: participants[0]!.id, status: 'submitted', choice: 'agree', error: null },
      { providerId: participants[1]!.id, status: 'submitted', choice: 'oppose', error: null },
      { providerId: participants[2]!.id, status: 'submitted', choice: 'abstain', error: null },
      { providerId: participants[3]!.id, status: 'failed', choice: null, error: 'invalid_response' },
    ]);
    expect(vote.participants.slice(0, 3).map(({ opinion: text }) => text)).toEqual([
      'The plan is practical.', 'The cost is too high.', 'More evidence is needed.',
    ]);
    expect(voteRequestCount()).toBe(4);
    const resultPanel = page.locator(`[data-testid="chat-vote-results"][data-card-id="${opinion.id}"]`);
    await expect(resultPanel).toHaveAttribute('data-status', 'completed');
    const renderedCounts = resultPanel.getByTestId('chat-vote-counts').locator('span');
    await expect(renderedCounts).toHaveText([
      /^(찬성|Agree) 1$/, /^(반대|Oppose) 1$/, /^(보류|Abstain) 1$/,
      /^(대기|Pending) 0$/, /^(실패|Failed) 1$/,
    ]);
    const renderedParticipants = resultPanel.getByTestId('chat-vote-participant');
    await expect(renderedParticipants).toHaveCount(4);
    await expect(renderedParticipants.nth(0)).toContainText('The plan is practical.');
    await expect(renderedParticipants.nth(1)).toContainText('The cost is too high.');
    await expect(renderedParticipants.nth(2)).toContainText('More evidence is needed.');
    await expect(renderedParticipants.nth(3)).toContainText(/잘못된 응답|Invalid response/);
    await page.screenshot({ path: testInfo.outputPath('vote-result.png'), fullPage: true });

    const duplicate = await invokeInApp(page, 'opinion:startVote', { opinionId: opinion.id });
    expect(duplicate.result.id).toBe(vote.id);
    expect(voteRequestCount()).toBe(4);

    const sendResult = resultPanel.getByTestId('chat-vote-send-result');
    await expect(sendResult).toBeEnabled();
    await sendResult.click();
    await expect(sendResult).toBeDisabled();
    await expect(sendResult).toHaveText(/전송 완료|Sent/);
    await expect(page.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER', { exact: true })).toHaveCount(4);
    const { result: sentVote } = await invokeInApp(page, 'opinion:getVote', { opinionId: opinion.id });
    expect(sentVote?.resultMessageId).toBeTruthy();
    const history = await invokeInApp(page, 'message:list-by-channel', { channelId: room.id });
    const notice = history.messages.find((message) => message.id === sentVote?.resultMessageId);
    expect(notice?.meta?.chatVoteResult).toEqual({ voteId: vote.id, title: 'Adopt the proposal',
      counts: { agree: 1, oppose: 1, abstain: 1, failed: 1 } });
    const noticeLine = page.getByTestId('system-message-body').filter({ hasText: 'Adopt the proposal' });
    await expect(noticeLine).toContainText(/찬성 1|Agree 1/);
    await expect(noticeLine).toContainText(/미응답 1|Unanswered 1/);
    const reactions = fake.requests.filter((request) => request.messages.some((message) =>
      message.content.includes('The user shared the final vote result')));
    expect(reactions).toHaveLength(4);
    for (const request of reactions) {
      const context = JSON.stringify(request.messages);
      expect(context).toContain('agree: 1');
      expect(context).toContain('unanswered: 1');
      for (const reason of ['The plan is practical.', 'The cost is too high.', 'More evidence is needed.']) {
        expect(context).not.toContain(reason);
      }
    }
    const repeat = await invokeInApp(page, 'opinion:sendVoteResult', { opinionId: opinion.id });
    expect(repeat.result.resultMessageId).toBe(sentVote?.resultMessageId);
    expect((await invokeInApp(page, 'message:list-by-channel', { channelId: room.id })).messages
      .filter((message) => message.meta?.chatVoteResult)).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath('vote-result-sent.png'), fullPage: true });

    page = await restartIsolatedApp(isolated);
    await openRoomInfo(page);
    const persistedSend = page.getByTestId('chat-vote-send-result');
    await expect(persistedSend).toBeDisabled();
    await expect(persistedSend).toHaveText(/전송 완료|Sent/);
    await expect(page.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER', { exact: true })).toHaveCount(4);
    await clickRoomMenuItem(page, 'room-archive-open');
    await page.getByTestId('room-action-confirm').click();
    await expect(page.getByTestId('room-archived-notice')).toBeVisible();
    // The archived room's menu offers deletion, never opinion posting.
    await page.getByTestId('room-menu-open').click();
    await expect(page.getByTestId('room-delete-open')).toBeVisible();
    await expect(page.getByTestId('chat-post-opinion')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await openRoomInfo(page);
    await expect(page.locator(`[data-testid="chat-vote-results"][data-card-id="${opinion.id}"]`)).toBeVisible();
    await expect(page.getByTestId('chat-vote-start')).toHaveCount(0);
    await expect(page.getByTestId('ssm-box-general-vote-agree')).toHaveCount(0);
    await expect(page.getByTestId('ssm-box-general-vote-oppose')).toHaveCount(0);
    await expect(invokeInApp(page, 'opinion:startVote', { opinionId: opinion.id })).rejects.toThrow();
    await expect(invokeInApp(page, 'opinion:postFromGeneral', {
      channelId: room.id, authorProviderId: null,
      parts: [{ title: 'Forbidden', content: 'Archived room write' }],
    })).rejects.toThrow();
    await expect(invokeInApp(page, 'opinion:toggleLightVote', {
      opinionId: opinion.id, vote: 'agree',
    })).rejects.toThrow();

    page = await restartIsolatedApp(isolated);
    await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
    await openRoomInfo(page);
    await expect(page.locator(`[data-testid="chat-vote-results"][data-card-id="${opinion.id}"]`)).toBeVisible();
    const persisted = await invokeInApp(page, 'opinion:getVote', { opinionId: opinion.id });
    expect(persisted.result).toEqual(sentVote);
    expect(voteRequestCount()).toBe(4);
    await page.screenshot({ path: testInfo.outputPath('vote-archived.png'), fullPage: true });
  } finally {
    if (isolated) await isolated.app.close().catch(() => {});
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

test('chat setup, history, search, profile and settings survive a real restart', async (
  { },
  testInfo,
) => {
  test.setTimeout(120_000);
  let isolated: IsolatedApp | null = null;
  let fakeProvider: Awaited<ReturnType<typeof startFakeProvider>> | null = null;

  try {
    fakeProvider = await startFakeProvider();
    isolated = await launchIsolatedApp({ ollamaHost: fakeProvider.baseUrl });
    const { app, userData } = isolated;
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const actualUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData'),
    );
    expect(actualUserData).toBe(userData);

    const generalEntry = generalChatRow(window);
    await expect(generalEntry).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('shell-topbar')).toHaveCount(0);
    const messenger = window.getByTestId('messenger-page');
    await expect(messenger).toHaveAttribute('data-empty', 'false');
    await expect(window.getByTestId('thread')).toHaveAttribute('data-channel-id', /.+/);
    await expect(window.getByTestId('chat-empty-connect')).toBeVisible();
    await expect(window.getByTestId('sidebar-section-projects')).toHaveCount(0);
    await expect(window.getByTestId('onboarding-page')).toHaveCount(0);
    await expect(window.locator('[data-testid="nav-rail"] [data-nav-id]')).toHaveCount(2);
    await expect(window.locator('[data-testid="nav-rail"] [data-nav-id]').nth(1))
      .toHaveAttribute('data-nav-id', 'settings');
    await expect(window.locator('[data-nav-id="ai-list"]')).toHaveCount(0);
    await expect(window.locator('[data-testid="chat-list-filter"][data-filter="dms"]')).toHaveCount(0);
    await expect.soft(window.getByTestId('composer-textarea'),
      'Fresh chat composer must fit fully inside the viewport').toBeInViewport({ ratio: 1 });
    const emptyChatScreenshot = testInfo.outputPath('chat-empty.png');
    await window.screenshot({ path: emptyChatScreenshot, fullPage: true });
    await testInfo.attach('chat-empty', {
      path: emptyChatScreenshot,
      contentType: 'image/png',
    });

    const unexpectedLive = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { arena?: TestArenaBridge }).arena;
      if (!bridge) throw new Error('window.arena bridge is missing');
      const invoke = bridge.invoke as unknown as (channel: string, data: unknown) => Promise<unknown>;
      const unexpected: string[] = [];
      for (const channel of ['project:list', 'meeting:list-active', 'queue:list']) {
        try { await invoke(channel, {}); unexpected.push(channel); } catch { /* retired channel rejects */ }
      }
      return unexpected;
    });
    expect(unexpectedLive).toEqual([]);

    // spec 2026-10-01 R5-7: the empty chat no longer adds an AI itself — it
    // links to settings → AI, the only place with "AI 추가".
    await expect(window.getByTestId('chat-connect-provider')).toHaveCount(0);
    await window.getByTestId('chat-empty-connect').click();
    await expect(window.getByTestId('settings-tab-ai')).toBeVisible();
    await expect(window.getByTestId('provider-connect-dialog')).toHaveCount(0);
    await window.getByTestId('settings-ai-add').click();
    await expect(window.getByTestId('provider-connect-dialog')).toBeVisible();
    // spec 2026-10-01 R6-3: the dialog finds the local Ollama at the address
    // main resolved (OLLAMA_HOST = the fake server) — no address is typed.
    const localCard = window.getByTestId('add-ai-local');
    await expect(localCard).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    const localModels = window.getByTestId('add-ai-local-model');
    await expect(localModels).toHaveCount(1);
    await expect(localModels).toHaveValue(FAKE_OLLAMA_MODEL);
    await window.getByTestId('add-ai-local-add').click();
    await expect(window.getByTestId('provider-connect-added')).toBeVisible();
    // R6-4: added under its default name, then on to the existing edit dialog.
    await window.getByTestId('provider-connect-edit-profile').click();
    await expect(window.getByTestId('provider-connect-dialog')).toBeHidden();
    await expect(window.getByTestId('profile-editor-name')).toHaveValue(FAKE_OLLAMA_MODEL);
    await window.getByTestId('profile-editor-name').fill('Chat First AI');
    await window.getByTestId('profile-editor-save').click();
    await expect(window.getByTestId('profile-editor-dialog')).toBeHidden();
    const { providers: afterLocalAdd } = await invokeInApp(window, 'provider:list', undefined);
    const localProvider = afterLocalAdd.find((provider) => provider.displayName === 'Chat First AI');
    expect(localProvider?.type).toBe('local');
    expect(localProvider?.config).toEqual({
      type: 'local', baseUrl: fakeProvider.baseUrl, model: FAKE_OLLAMA_MODEL, confirmedServer: 'ollama',
    });
    const providerId = localProvider!.id;
    const localRow = window.locator(`[data-testid="settings-ai-row"][data-provider-id="${providerId}"]`);
    await expect(localRow).toBeVisible();
    // 2026-10-01 user decision: "로컬 (Ollama)" only for a server confirmed as Ollama.
    await expect(localRow.getByTestId('settings-ai-connection'))
      .toHaveText(new RegExp(`^${FAKE_OLLAMA_MODEL} · (로컬|Local) \\(Ollama\\)$`));

    // Back to the chat through the left rail.
    await navButton(window, 'messenger').click();
    await expect(window.getByTestId('messenger-page')).toBeVisible();

    await openRoomInfo(window);
    await window.getByTestId('member-row-trigger').first().click();
    await expect(window.getByTestId('profile-popover-start-dm')).toHaveCount(0);
    await window.getByTestId('profile-popover-edit').click();
    await window.getByTestId('profile-editor-character-sheet').fill(
      'Role: conversation partner\nPersonality: warm and curious\nExpertise: everyday conversation',
    );
    await window.getByTestId('profile-editor-save').click();
    await expect(window.getByTestId('profile-editor-dialog')).toBeHidden();

    await sendMessage(window, 'CF4_GENERAL_FIRST please greet me.');
    await expect(
      window.getByTestId('thread-message-list').getByText('CF4_REPLY_GENERAL_1'),
    ).toBeVisible({ timeout: 20_000 });
    await sendMessage(window, 'CF4_GENERAL_SECOND what did you say before?');
    await expect(
      window.getByTestId('thread-message-list').getByText('CF4_REPLY_GENERAL_2'),
    ).toBeVisible({ timeout: 20_000 });

    const secondGeneralRequest = fakeProvider.requests.find((request) =>
      request.messages.some((message) =>
        message.content.includes('CF4_GENERAL_SECOND'),
      ),
    );
    expect(secondGeneralRequest).toBeDefined();
    expect(
      secondGeneralRequest?.messages.find((message) => message.role === 'system')
        ?.content,
    ).toContain('Personality: warm and curious');
    expect(
      secondGeneralRequest?.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.content ===
            '[Speaker: "Chat First AI"]\nCF4_REPLY_GENERAL_1',
      ),
    ).toBe(true);

    // Message search now starts from the chat list's search field (R2-2).
    const listSearch = window.getByTestId('chat-list-search');
    await listSearch.fill('greet');
    await listSearch.press('Enter');
    const search = window.getByTestId('message-search-dialog');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('data-scope', 'chats');
    await expect(window.getByTestId('message-search-input')).toHaveValue('greet');
    await expect(window.getByTestId('search-result-row').first()).toBeVisible();
    await window.getByTestId('search-result-row').first().click();
    await expect(search).toBeHidden();
    await listSearch.fill('');
    expect(
      secondGeneralRequest?.messages.some(
        (message) =>
          message.role === 'user' &&
          message.content.includes('[Speaker: "User"]\nCF4_GENERAL_FIRST'),
      ),
    ).toBe(true);

    // A single-AI conversation uses the same room creation flow as any group.
    const singleAiRoomId = await createRoom(window, 'Conversation partner', [providerId]);
    await expect(chatListRow(window, singleAiRoomId)).toHaveAttribute('data-active', 'true');
    await sendMessage(window, 'CF4_SINGLE_AI_MESSAGE hello.');
    await expect(
      window.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER'),
    ).toBeVisible({ timeout: 20_000 });

    await navButton(window, 'settings').click();
    await expect(window.getByTestId('settings-tabs-root')).toBeVisible();
    // Settings now has exactly three tabs (spec 2026-10-01 R5-1).
    await expect(window.getByTestId('settings-tabs-trigger')).toHaveCount(3);
    await window.locator('[data-testid="settings-tabs-trigger"][data-tab="general"]').click();
    await window.locator('[data-testid="settings-theme-card"][data-key="retro"]').click();
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'retro');

    // Notifications moved into the general tab.
    const notificationRows = window.getByTestId('notification-prefs-row');
    await expect(notificationRows).toHaveCount(2);
    await expect(notificationRows.nth(0)).toHaveAttribute('data-kind', 'new_message');
    await expect(notificationRows.nth(1)).toHaveAttribute('data-kind', 'error');

    await window.locator('[data-testid="settings-tabs-trigger"][data-tab="ai"]').click();
    await window.getByTestId('settings-ai-add').click();
    // F1: "기타 (OpenAI 호환)" only — the official Claude/ChatGPT/Gemini
    // choices lock the endpoint to their real cloud URL, which would
    // reach out to the internet. "other" points at the offline localhost
    // fake server instead, keeping this test fully offline.
    await window.getByTestId('provider-connect-service-other').click();
    await window.getByTestId('provider-connect-name').fill('Test API AI');
    await window.getByTestId('provider-connect-endpoint').fill(`${fakeProvider.baseUrl}/v1`);
    await expect(window.getByTestId('provider-connect-secret')).toHaveValue('');
    const dialogBackground = await window.getByTestId('provider-connect-dialog').evaluate((dialog) => {
      const color = getComputedStyle(dialog).backgroundColor;
      const compact = color.replace(/\s+/g, '');
      const rgba = compact.match(/^rgba?\(([^)]+)\)$/i);
      const alpha = rgba?.[1]?.split(',')[3];
      return {
        color,
        opaque: compact !== 'transparent' &&
          (alpha === undefined || Number(alpha) > 0) &&
          !/\/0(?:\.0+)?\)$/i.test(compact),
      };
    });
    expect.soft(dialogBackground.opaque,
      `API dialog needs an opaque surface; computed background was ${dialogBackground.color}`).toBe(true);
    const apiConnectScreenshot = testInfo.outputPath('api-connect-before-secret.png');
    await window.screenshot({ path: apiConnectScreenshot, fullPage: true });
    await testInfo.attach('api-connect-before-secret', {
      path: apiConnectScreenshot,
      contentType: 'image/png',
    });
    await window.getByTestId('provider-connect-secret').fill('dummy-e2e-key-only');
    await window.getByTestId('provider-connect-load-models').click();
    // The fake server's GET /v1/models (startFakeProvider above) answers
    // this real provider:list-models round-trip with one model id — the
    // dropdown appears on success. If it did not (a real network hiccup),
    // "other" is the one service that still lets the user type a model
    // name by hand (F1-8) — fall back to that path so the test does not
    // depend on which branch actually fired.
    const modelSelect = window.getByTestId('provider-connect-model-select');
    const modelManualInput = window.getByTestId('provider-connect-model');
    await expect(modelSelect.or(modelManualInput)).toBeVisible({ timeout: 20_000 });
    if (await modelSelect.isVisible()) {
      await modelSelect.selectOption('chat-first-model');
    } else {
      await modelManualInput.fill('chat-first-model');
    }
    await window.getByTestId('provider-connect-submit').click();
    await expect(window.getByTestId('provider-connect-added')).toBeVisible();
    await window.getByTestId('provider-connect-done').click();
    await expect(window.getByTestId('provider-connect-dialog')).toBeHidden();
    const { providers: afterApiAdd } = await invokeInApp(window, 'provider:list', undefined);
    const apiProvider = afterApiAdd.find((provider) => provider.displayName === 'Test API AI');
    expect(apiProvider?.type).toBe('api');
    expect(apiProvider?.config.type === 'api' ? apiProvider.config.apiKeyRef : null)
      .toMatch(/^provider-[a-f0-9-]+$/i);
    expect(JSON.stringify(apiProvider)).not.toContain('dummy-e2e-key-only');
    const encryptedSecrets = await readFile(join(userData, 'config', 'secrets.enc.json'), 'utf8');
    expect(encryptedSecrets).not.toContain('dummy-e2e-key-only');

    // Regression guard for the stale-closure key-deletion bug (A1): register()
    // used to call close() with a closure that still saw the pre-registration
    // storedSecretRef, so it issued a stray config:delete-secret for the key
    // this provider just registered with. The next real call then failed with
    // "API key not found" (provider_error). Talk to THIS provider right after
    // registration — a single-AI room isolates this provider's exchange —
    // and confirm the fake server actually received the test key as a Bearer
    // token, and that the reply renders.
    const apiProviderId = apiProvider!.id;
    await navButton(window, 'messenger').click();
    const apiRoomId = await createRoom(window, 'API key check', [apiProviderId]);
    await expect(chatListRow(window, apiRoomId)).toHaveAttribute('data-active', 'true');
    await sendMessage(window, 'CF4_API_KEY_CHECK please respond.');
    await expect(
      window.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER'),
    ).toBeVisible({ timeout: 20_000 });
    const apiKeyCheckRequest = fakeProvider.requests.find((request) =>
      request.messages.some((message) => message.content.includes('CF4_API_KEY_CHECK')),
    );
    expect(apiKeyCheckRequest).toBeDefined();
    expect(apiKeyCheckRequest?.authorization).toBe('Bearer dummy-e2e-key-only');

    // The last active single-AI room is restored after restart.
    await chatListRow(window, singleAiRoomId).click();
    await expect(chatListRow(window, singleAiRoomId)).toHaveAttribute('data-active', 'true');

    const restartedWindow = await restartIsolatedApp(isolated);
    const restoredRoomEntry = chatListRow(restartedWindow, singleAiRoomId);
    await expect(restoredRoomEntry).toHaveAttribute('data-active', 'true');
    await expect(
      restartedWindow.getByTestId('thread-message-list').getByText('CF4_REPLY_OTHER'),
    ).toBeVisible();
    await expect(restartedWindow.locator('html')).toHaveAttribute('data-theme', 'retro');
    await generalChatRow(restartedWindow).click();
    await expect(
      restartedWindow.getByTestId('thread-message-list').getByText('CF4_REPLY_GENERAL_2'),
    ).toBeVisible();

    const screenshot = testInfo.outputPath('chat-first-flow.png');
    await restartedWindow.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('chat-first-flow', {
      path: screenshot,
      contentType: 'image/png',
    });
  } finally {
    if (isolated !== null) {
      try {
        await isolated.app.close();
      } catch {
        // Preserve the test failure if Electron already exited.
      }
    }
    if (fakeProvider !== null) {
      await fakeProvider.close();
    }
    if (isolated !== null) {
      await rm(isolated.tempRoot, { recursive: true, force: true });
    }
  }
});
