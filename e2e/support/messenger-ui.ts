/**
 * Shared steps for the messenger layout (spec 2026-10-01-messenger-redesign.md
 * R2/R3): the left rail, the chat list rows, the room header's ⋯ menu and
 * the room-info drawer (closed by default).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { invokeInApp } from './isolated-app';

/** A left-rail button by view id: `messenger` or `settings`. */
export function navButton(page: Page, viewId: 'messenger' | 'settings'): Locator {
  return page.locator(`[data-testid="nav-rail"] [data-nav-id="${viewId}"]`);
}

export function chatListRow(page: Page, channelId: string): Locator {
  return page.locator(`[data-testid="chat-list-row"][data-channel-id="${channelId}"]`);
}

export function generalChatRow(page: Page): Locator {
  return page.locator('[data-testid="chat-list-row"][data-kind="general"]');
}

export function chatListFilter(page: Page, filter: 'all' | 'rooms' | 'archive'): Locator {
  return page.locator(`[data-testid="chat-list-filter"][data-filter="${filter}"]`);
}

/** Opens the room header's ⋯ menu and picks one item by its test id. */
export async function clickRoomMenuItem(page: Page, itemTestId: string): Promise<void> {
  await page.getByTestId('room-menu-open').click();
  await expect(page.getByTestId('room-menu')).toBeVisible();
  await page.getByTestId(itemTestId).click();
}

/** Opens the room-info drawer (members and opinion cards) if it is closed. */
export async function openRoomInfo(page: Page): Promise<void> {
  const toggle = page.getByTestId('room-info-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('messenger-member-panel')).toBeVisible();
}

/** Creates a room through the dialog; the thread switches to it. */
export async function createRoom(page: Page, name: string, providerIds: string[]): Promise<string> {
  await page.getByTestId('room-create-open').click();
  await page.getByTestId('room-create-name').fill(name);
  for (const providerId of providerIds) await page.getByTestId(`room-participant-${providerId}`).check();
  await page.getByTestId('room-create-submit').click();
  await expect(page.getByTestId('room-create-dialog')).toBeHidden();
  const { rooms } = await invokeInApp(page, 'room:list', undefined);
  const room = rooms.find((entry) => entry.name === name);
  if (!room) throw new Error(`Room was not created: ${name}`);
  await expect(page.getByTestId('thread')).toHaveAttribute('data-channel-id', room.id);
  return room.id;
}
