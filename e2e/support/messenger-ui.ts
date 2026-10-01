/**
 * Shared steps for the messenger layout (spec 2026-10-01-messenger-redesign.md
 * R2/R3): the left rail, the chat list rows, the room header's ⋯ menu and
 * the room-info drawer (closed by default).
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** A left-rail button by view id: `messenger`, `ai-list` or `settings`. */
export function navButton(page: Page, viewId: 'messenger' | 'ai-list' | 'settings'): Locator {
  return page.locator(`[data-testid="nav-rail"] [data-nav-id="${viewId}"]`);
}

export function chatListRow(page: Page, channelId: string): Locator {
  return page.locator(`[data-testid="chat-list-row"][data-channel-id="${channelId}"]`);
}

export function generalChatRow(page: Page): Locator {
  return page.locator('[data-testid="chat-list-row"][data-kind="general"]');
}

export function dmChatRow(page: Page, providerId: string): Locator {
  return page.locator(`[data-testid="chat-list-row"][data-kind="dm"][data-provider-id="${providerId}"]`);
}

export function chatListFilter(page: Page, filter: 'all' | 'rooms' | 'dms' | 'archive'): Locator {
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

/** Opens (or creates) the 1:1 chat with an AI from the AI list screen. */
export async function openDmFromAiList(page: Page, providerId: string): Promise<void> {
  await navButton(page, 'ai-list').click();
  const row = page.locator(`[data-testid="ai-list-row"][data-provider-id="${providerId}"]`);
  await expect(row).toBeEnabled({ timeout: 10_000 });
  await row.click();
  await expect(page.getByTestId('messenger-page')).toBeVisible({ timeout: 10_000 });
}
