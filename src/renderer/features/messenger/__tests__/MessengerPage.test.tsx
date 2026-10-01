// @vitest-environment jsdom

/**
 * MessengerPage — the chat list column next to the open conversation
 * (spec 2026-10-01-messenger-redesign.md R2/R3). The room-info drawer
 * (members and opinion cards) is closed until the header toggle opens it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── jsdom polyfills for Radix (Task 10 CRUD modals) ───────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

import { MessengerPage } from '../MessengerPage';
import { i18next } from '../../../i18n';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../../stores/active-channel-store';
import { useChannelSummaryStore } from '../../../stores/channel-summary-store';
import type { Channel } from '../../../../shared/channel-types';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { ChannelSummary } from '../../../../shared/channel-summary-types';

function resetStore(): void {
  useActiveChannelStore.setState({
    channelIdByProject: {},
    globalChannelId: null,
    selectedScope: 'project',
  });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
}

function stubEmptyChannelBridge(
  general: Channel | null | Promise<Channel | null> = null,
  rooms: Channel[] | Promise<Channel[]> = [],
) {
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      case 'room:list': return { rooms: await rooms };
      case 'channel:get-global-general':
        return { channel: await general };
      case 'channel:list-members':
        return { members: [] };
      case 'member:list':
        return { members: [] };
      case 'message:list-by-channel':
        return { messages: [] };
      case 'channel:mark-read':
        return { success: true };
      case 'message:append': {
        const payload = data as { channelId: string; content: string };
        return { message: {
          id: 'm-sent', channelId: payload.channelId, meetingId: null,
          authorId: 'user', authorKind: 'user', role: 'user',
          content: payload.content, meta: null, createdAt: 1_700_000_000_000,
        } };
      }
      default:
        throw new Error(`no mock for channel ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return invoke;
}

function renderPage() {
  return render(<MessengerPage onSearchMessages={vi.fn()} />);
}

async function openDrawer(): Promise<void> {
  fireEvent.click(await screen.findByTestId('room-info-toggle'));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetStore();
  useChannelSummaryStore.setState({ summaries: null, loading: false, error: null });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  resetStore();
  vi.unstubAllGlobals();
});

describe('MessengerPage — empty / active rendering (R5-Task3)', () => {
  it('renders selected global general with no active project', async () => {
    const general = chatChannelForTest({
      id: 'c-general',
      projectId: null,
      name: 'general',
      kind: 'system_general',
      readOnly: false,
      createdAt: 1_700_000_000_000,
    });
    const invoke = stubEmptyChannelBridge(general);
    useActiveChannelStore.setState({
      globalChannelId: general.id,
      selectedScope: 'global',
    });
    renderPage();

    const page = screen.getByTestId('messenger-page');
    expect(page.getAttribute('data-empty')).toBe('false');
    expect(screen.getByTestId('messenger-thread')).toBeTruthy();
    expect(screen.getByTestId('chat-list')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(general.id);
    });
    expect(screen.queryByTestId('messenger-member-panel')).toBeNull();
    fireEvent.change(screen.getByTestId('composer-textarea'), {
      target: { value: 'Hello' },
    });
    fireEvent.keyDown(screen.getByTestId('composer-textarea'), { key: 'Enter' });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('message:append', {
        channelId: general.id,
        content: 'Hello',
      });
    });
  });

  it('keeps known general usable while room listing is pending and after it fails', async () => {
    const general = chatChannelForTest({
      id: 'c-general', projectId: null, name: 'general',
      kind: 'system_general', readOnly: false, createdAt: 1_700_000_000_000,
    });
    let rejectRooms: (reason: Error) => void = () => {};
    const rooms = new Promise<Channel[]>((_resolve, reject) => { rejectRooms = reject; });
    stubEmptyChannelBridge(general, rooms);
    useActiveChannelStore.setState({ globalChannelId: general.id, selectedScope: 'global' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(general.id);
    });
    await openDrawer();
    await waitFor(() => {
      expect(screen.getByTestId('member-panel').getAttribute('data-channel-id')).toBe(general.id);
    });
    await act(async () => { rejectRooms(new Error('room list unavailable')); });
    expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(general.id);
    expect(useActiveChannelStore.getState().globalChannelId).toBe(general.id);
  });

  it('keeps a known room usable while general metadata is pending and after it fails', async () => {
    const room = chatChannelForTest({
      id: 'c-room', projectId: null, name: 'Campfire',
      kind: 'user', isChatRoom: true, readOnly: false, createdAt: 1_700_000_000_000,
    });
    let rejectGeneral: (reason: Error) => void = () => {};
    const general = new Promise<Channel | null>((_resolve, reject) => { rejectGeneral = reject; });
    stubEmptyChannelBridge(general, [room]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(room.id);
    });
    await openDrawer();
    await waitFor(() => {
      expect(screen.getByTestId('member-panel').getAttribute('data-channel-id')).toBe(room.id);
    });
    await act(async () => { rejectGeneral(new Error('general unavailable')); });
    expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(room.id);
    expect(useActiveChannelStore.getState().globalChannelId).toBe(room.id);
  });

  it('defers clearing an unknown global ID until both lists have loaded', async () => {
    let resolveRooms: (channels: Channel[]) => void = () => {};
    const rooms = new Promise<Channel[]>((resolve) => { resolveRooms = resolve; });
    stubEmptyChannelBridge(null, rooms);
    useActiveChannelStore.setState({ globalChannelId: 'c-deleted', selectedScope: 'global' });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('messenger-thread')).toBeTruthy());
    expect(useActiveChannelStore.getState().globalChannelId).toBe('c-deleted');
    await act(async () => { resolveRooms([]); });
    await waitFor(() => expect(useActiveChannelStore.getState().globalChannelId).toBeNull());
  });

  it('renders the chat list and the conversation pane even without a selected channel', () => {
    stubEmptyChannelBridge();

    renderPage();

    const page = screen.getByTestId('messenger-page');
    expect(page.getAttribute('data-empty')).toBe('false');

    expect(screen.getByTestId('chat-list')).toBeTruthy();
    expect(screen.getByTestId('messenger-thread')).toBeTruthy();
    expect(screen.getByTestId('thread-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('messenger-member-panel')).toBeNull();

    // The old sidebar and channel rail are gone.
    expect(screen.queryByTestId('sidebar-general-entry')).toBeNull();
    expect(screen.queryByTestId('channel-rail')).toBeNull();
  });

  it('opens the conversation picked in the chat list', async () => {
    const room = chatChannelForTest({
      id: 'c-room', projectId: null, name: 'Campfire',
      kind: 'user', isChatRoom: true, readOnly: false, createdAt: 1_700_000_000_000,
    });
    stubEmptyChannelBridge(null, [room]);
    const summary: ChannelSummary = {
      channelId: room.id, kind: 'room', name: room.name, archivedAt: null,
      participants: [{ providerId: 'ai-1', displayName: 'Luna' }],
      lastMessage: null, lastActivityAt: room.createdAt, unreadCount: 0,
    };
    useChannelSummaryStore.setState({ summaries: [summary] });
    renderPage();

    const row = await screen.findByTestId('chat-list-row');
    expect(row.textContent).toContain(room.name);
    fireEvent.click(row);
    expect(useActiveChannelStore.getState().globalChannelId).toBe(room.id);
    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(room.id);
    });
    expect(screen.getByTestId('room-title').textContent).toContain(room.name);
  });
});

describe('MessengerPage — source-level hardcoded color guard', () => {
  it('MessengerPage.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'MessengerPage.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
