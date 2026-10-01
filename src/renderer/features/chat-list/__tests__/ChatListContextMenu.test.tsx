// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatListColumn } from '../ChatListColumn';
import { RoomMenu } from '../../messenger/RoomMenu';
import { i18next } from '../../../i18n';
import { useActiveChannelStore } from '../../../stores/active-channel-store';
import { useChannelSummaryStore } from '../../../stores/channel-summary-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { Channel } from '../../../../shared/channel-types';
import type { ChannelSummary } from '../../../../shared/channel-summary-types';

const CHANNELS: Channel[] = [
  chatChannelForTest({ id: 'room-1', projectId: null, name: 'Room one', kind: 'user',
    isChatRoom: true, readOnly: false, createdAt: 1 }),
  chatChannelForTest({ id: 'room-2', projectId: null, name: 'Room two', kind: 'user',
    isChatRoom: true, readOnly: false, createdAt: 2 }),
  chatChannelForTest({ id: 'room-old', projectId: null, name: 'Archived', kind: 'user',
    isChatRoom: true, readOnly: true, archivedAt: 3, createdAt: 3 }),
  chatChannelForTest({ id: 'general-1', projectId: null, name: 'general', kind: 'system_general',
    readOnly: false, createdAt: 5 }),
];

const SUMMARIES: ChannelSummary[] = CHANNELS.map((channel) => ({
  channelId: channel.id, name: channel.name,
  kind: channel.isChatRoom ? 'room' : channel.kind === 'dm' ? 'dm' : 'general',
  archivedAt: channel.archivedAt ?? null, participants: [], lastMessage: null,
  lastActivityAt: channel.createdAt, unreadCount: 2,
}));

function renderColumn(channels = CHANNELS) {
  const onSelectChannel = vi.fn();
  const content = (currentChannels: Channel[]) => <ThemeProvider>
    <ChatListColumn channels={currentChannels} activeChannelId="room-1"
      onSelectChannel={onSelectChannel} onSearchMessages={vi.fn()} />
  </ThemeProvider>;
  const view = render(content(channels));
  return { onSelectChannel, updateChannels: (next: Channel[]) => view.rerender(content(next)) };
}

function row(id: string): HTMLElement {
  const found = screen.getAllByTestId('chat-list-row').find((item) => item.dataset.channelId === id);
  if (!found) throw new Error(`Missing row ${id}`);
  return found;
}

function rightClick(id: string): void {
  fireEvent.contextMenu(row(id), { clientX: 125, clientY: 180, button: 2 });
}

function showArchive(): void {
  fireEvent.click(screen.getByRole('tab', { name: i18next.t('chatList.filter.archive') }));
}

let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  void i18next.changeLanguage('ko');
  useThemeStore.setState({ themeKey: 'tactical', mode: 'dark' });
  useActiveChannelStore.getState().setGlobalChannelId('room-1');
  useChannelSummaryStore.setState({ summaries: SUMMARIES, loading: false, error: null });
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'member:list') return { members: [] };
    if (channel === 'opinion:postFromGeneral') return { result: { inserted: [] } };
    return { success: true };
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  useActiveChannelStore.getState().setGlobalChannelId(null);
  useChannelSummaryStore.setState({ summaries: null, loading: false, error: null });
});

describe('ChatListColumn context menu', () => {
  it.each(CHANNELS)('offers the same actions as the header for $id', async (channel) => {
    const header = render(<RoomMenu channel={channel} actions={{
      onPostOpinion: vi.fn(), onArchiveRoom: vi.fn(), onDeleteRoom: vi.fn(), onDeleteDm: vi.fn(),
    }} />);
    fireEvent.click(screen.getByTestId('room-menu-open'));
    const headerLabels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    header.unmount();

    const { onSelectChannel } = renderColumn();
    if (channel.readOnly) showArchive();
    rightClick(channel.id);
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(headerLabels);
    expect(onSelectChannel).not.toHaveBeenCalled();
    expect(useActiveChannelStore.getState().globalChannelId).toBe('room-1');
    expect(invoke).not.toHaveBeenCalledWith('channel:mark-read', expect.anything());
  });

  it('posts an opinion to the right-clicked room without selecting it', async () => {
    const { onSelectChannel } = renderColumn();
    rightClick('room-2');
    fireEvent.click(await screen.findByTestId('chat-post-opinion'));
    expect(screen.getByTestId('post-opinion-modal').dataset.channelId).toBe('room-2');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('post-opinion-title')));
    fireEvent.change(screen.getByTestId('post-opinion-content'), { target: { value: 'An idea' } });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('opinion:postFromGeneral', {
      channelId: 'room-2', authorProviderId: null, parts: [{ title: null, content: 'An idea' }],
    }));
    expect(onSelectChannel).not.toHaveBeenCalled();
  });

  it.each([
    ['room-2', 'room-archive-open', 'room:archive'],
    ['room-old', 'room-delete-open', 'room:delete'],
  ])('confirms the existing action before modifying %s', async (id, item, command) => {
    renderColumn();
    if (id === 'room-old') showArchive();
    rightClick(id);
    fireEvent.click(await screen.findByTestId(item));
    expect(invoke).not.toHaveBeenCalledWith(command, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: i18next.t('rooms.cancel') }));
    expect(screen.queryByTestId('room-action-dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row(id)));
    expect(invoke).not.toHaveBeenCalledWith(command, expect.anything());

    rightClick(id);
    fireEvent.click(await screen.findByTestId(item));
    fireEvent.click(screen.getByTestId('room-action-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(command, { channelId: id }));
    expect(useActiveChannelStore.getState().globalChannelId).toBe('room-1');
  });

  it.each(['tactical', 'retro'] as const)('supports keyboard opening, menu navigation and Escape in %s', async (themeKey) => {
    useThemeStore.setState({ themeKey });
    const { onSelectChannel } = renderColumn();
    const target = row('room-2');
    target.focus();
    fireEvent.keyDown(target, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(target, { key: 'ContextMenu' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(onSelectChannel).not.toHaveBeenCalled();
  });

  it('dismisses on an outside pointer click', async () => {
    renderColumn();
    rightClick('room-2');
    await screen.findByRole('menu');
    // Radix installs its document pointer listener after the opening event.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes an opinion draft when the room becomes archived', async () => {
    const { updateChannels } = renderColumn();
    rightClick('room-2');
    fireEvent.click(await screen.findByTestId('chat-post-opinion'));
    fireEvent.change(screen.getByTestId('post-opinion-content'), { target: { value: 'Draft' } });
    updateChannels(CHANNELS.map((channel) => channel.id === 'room-2'
      ? { ...channel, readOnly: true, archivedAt: 10 } : channel));
    expect(screen.queryByTestId('post-opinion-modal')).toBeNull();
    updateChannels(CHANNELS);
    expect(screen.queryByTestId('post-opinion-modal')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('opinion:postFromGeneral', expect.anything());
  });

  it('closes an archive confirmation instead of changing it into deletion after metadata refresh', async () => {
    const { updateChannels } = renderColumn();
    rightClick('room-2');
    fireEvent.click(await screen.findByTestId('room-archive-open'));
    expect(screen.getByTestId('room-action-confirm').textContent).toBe(i18next.t('rooms.archive'));
    updateChannels(CHANNELS.map((channel) => channel.id === 'room-2'
      ? { ...channel, readOnly: true, archivedAt: 10 } : channel));
    expect(screen.queryByTestId('room-action-dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('room:delete', expect.anything());
    rightClick('room-2');
    fireEvent.click(await screen.findByTestId('room-delete-open'));
    expect(screen.getByTestId('room-action-confirm').textContent).toBe(i18next.t('rooms.delete'));
  });

  it('keeps focus on the search field clicked outside the menu', async () => {
    const user = userEvent.setup();
    renderColumn();
    rightClick('room-2');
    await screen.findByRole('menu');
    const search = screen.getByTestId('chat-list-search');
    await user.click(search);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(search);
  });

  it('keeps the newly targeted menu focused after the old menu finishes closing', async () => {
    renderColumn();
    rightClick('room-2');
    await screen.findByTestId('room-archive-open');
    rightClick('general-1');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const opinion = screen.getByTestId('chat-post-opinion');
    expect(screen.queryByTestId('room-archive-open')).toBeNull();
    expect(document.activeElement).toBe(opinion);
  });

  it('does not infer destructive actions from a summary without loaded channel metadata', () => {
    renderColumn([]);
    rightClick('room-2');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
