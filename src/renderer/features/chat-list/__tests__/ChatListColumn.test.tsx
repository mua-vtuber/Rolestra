// @vitest-environment jsdom

/**
 * ChatListColumn (spec 2026-10-01-messenger-redesign.md R2-2): one list of
 * rooms and general ordered by activity, the 전체 / 채팅방 / 보관함
 * filters, unread badges (99+), the log-layout rows, the hand-off to the
 * message search, and a failed read shown as an error.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as summariesSync from '../../../hooks/use-channel-summaries-sync';
import { ChatListColumn } from '../ChatListColumn';
import { i18next } from '../../../i18n';
import { useChannelSummaryStore } from '../../../stores/channel-summary-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type { ChannelSummary } from '../../../../shared/channel-summary-types';

const NOW = Date.now();
const LUNA = { providerId: 'ai-luna', displayName: '루나' };
const HAERANG = { providerId: 'ai-haerang', displayName: '해랑' };
const SORA = { providerId: 'ai-sora', displayName: '소라' };

function summary(fields: Partial<ChannelSummary> & Pick<ChannelSummary, 'channelId' | 'kind'>): ChannelSummary {
  return {
    name: fields.channelId, archivedAt: null, participants: [], lastMessage: null,
    lastActivityAt: NOW, unreadCount: 0, ...fields,
  };
}

const SUMMARIES: ChannelSummary[] = [
  summary({ channelId: 'general-1', kind: 'general', participants: [LUNA, HAERANG, SORA], lastActivityAt: NOW - 3000 }),
  summary({ channelId: 'room-1', kind: 'room', name: '새벽 감성 토크', participants: [LUNA, HAERANG, SORA],
    lastActivityAt: NOW - 1000, unreadCount: 150 }),
  summary({ channelId: 'dm-1', kind: 'dm', name: 'dm:ai-luna', participants: [LUNA],
    lastActivityAt: NOW - 2000, unreadCount: 2 }),
  summary({ channelId: 'room-old', kind: 'room', name: '마피아 연습방', participants: [LUNA],
    archivedAt: NOW - 10_000, lastActivityAt: NOW - 500 }),
];

function stubBridge(): void {
  vi.stubGlobal('arena', {
    platform: 'linux',
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'member:list') return { members: [] };
      throw new Error(`unexpected IPC: ${channel}`);
    }),
    onStream: () => () => {},
  });
}

function renderColumn(themeKey: ThemeKey, props: Partial<Parameters<typeof ChatListColumn>[0]> = {}) {
  useThemeStore.setState({ themeKey, mode: 'dark' });
  const onSelectChannel = vi.fn();
  const onSearchMessages = vi.fn();
  render(
    <ThemeProvider>
      <ChatListColumn activeChannelId="room-1" onSelectChannel={onSelectChannel}
        onSearchMessages={onSearchMessages} {...props} />
    </ThemeProvider>,
  );
  return { onSelectChannel, onSearchMessages };
}

function rowIds(): string[] {
  return screen.queryAllByTestId('chat-list-row').map((row) => row.getAttribute('data-channel-id') ?? '');
}

beforeEach(() => {
  stubBridge();
  void i18next.changeLanguage('ko');
  useChannelSummaryStore.setState({ summaries: SUMMARIES, loading: false, error: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  useChannelSummaryStore.setState({ summaries: null, loading: false, error: null });
});

describe('ChatListColumn — list and filters', () => {
  it('orders general and rooms by activity and keeps DMs and archived rooms out of 전체', () => {
    renderColumn('tactical');
    expect(rowIds()).toEqual(['room-1', 'general-1']);
  });

  it('switches between 채팅방 and 보관함 without offering a DM filter', () => {
    renderColumn('tactical');
    const filter = (id: string) => document.querySelector(`[data-testid="chat-list-filter"][data-filter="${id}"]`) as HTMLElement;
    fireEvent.click(filter('rooms'));
    expect(rowIds()).toEqual(['room-1', 'general-1']);
    expect(filter('rooms').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-filter="dms"]')).toBeNull();
    fireEvent.click(filter('archive'));
    expect(rowIds()).toEqual(['room-old']);
  });

  it('shows names, the unread badge capped at 99+, and opens a conversation on click', () => {
    const { onSelectChannel } = renderColumn('tactical');
    const rows = screen.getAllByTestId('chat-list-row');
    expect(rows[0]?.textContent).toContain('새벽 감성 토크');
    expect(rows[1]?.textContent).toContain('일반 채널');
    expect(rows[0]?.getAttribute('data-active')).toBe('true');
    const badges = screen.getAllByTestId('chat-list-unread').map((badge) => badge.textContent);
    expect(badges).toEqual(['99+']);
    fireEvent.click(rows[1] as HTMLElement);
    expect(onSelectChannel).toHaveBeenCalledWith('general-1');
  });

  it('draws rooms as clusters of up to three initials', () => {
    renderColumn('tactical');
    const avatars = screen.getAllByTestId('chat-list-avatar');
    expect(avatars.map((avatar) => avatar.getAttribute('data-avatar'))).toEqual(['cluster', 'cluster']);
    expect(avatars[0]?.textContent).toBe('루해소');
  });

  it('filters by the search text and hands the query to the message search', () => {
    const { onSearchMessages } = renderColumn('tactical');
    const input = screen.getByTestId('chat-list-search');
    fireEvent.change(input, { target: { value: '새벽' } });
    expect(rowIds()).toEqual(['room-1']);
    fireEvent.click(screen.getByTestId('chat-list-search-messages'));
    expect(onSearchMessages).toHaveBeenCalledWith('새벽');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearchMessages).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { value: 'nothing-matches' } });
    expect(screen.getByTestId('chat-list-empty').textContent).toBe('찾는 대화가 없습니다');
  });
});

describe('ChatListColumn — log layout', () => {
  it('tags rows [방], inverts the selected row and writes unread as (n)', () => {
    renderColumn('retro');
    const rows = screen.getAllByTestId('chat-list-row');
    expect(rows[0]?.textContent).toContain('[방] 새벽 감성 토크');
    expect(rows[1]?.textContent).toContain('[방] 일반 채널');
    expect(rows[0]?.className).toContain('bg-brand');
    expect(rows[1]?.className).not.toContain('bg-brand');
    expect(screen.queryByTestId('chat-list-avatar')).toBeNull();
    expect(screen.getAllByTestId('chat-list-unread').map((badge) => badge.textContent)).toEqual(['(99+)']);
  });
});

describe('ChatListColumn — read states', () => {
  it('shows a failed read as an error, not as an empty list', () => {
    useChannelSummaryStore.setState({ summaries: null, error: new Error('db locked') });
    renderColumn('tactical');
    expect(screen.getByTestId('chat-list-error').textContent).toContain('db locked');
    expect(screen.queryByTestId('chat-list-empty')).toBeNull();
    expect(screen.queryByTestId('chat-list-loading')).toBeNull();
  });

  it('offers to read again from the error state (QA Minor 7)', () => {
    const reload = vi.spyOn(summariesSync, 'reloadChannelSummaries').mockImplementation(() => undefined);
    try {
      useChannelSummaryStore.setState({ summaries: null, error: new Error('db locked') });
      renderColumn('tactical');
      fireEvent.click(screen.getByTestId('chat-list-retry'));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      reload.mockRestore();
    }
  });

  it('shows loading until the first read arrives', async () => {
    useChannelSummaryStore.setState({ summaries: null, error: null });
    renderColumn('tactical');
    expect(screen.getByTestId('chat-list-loading')).toBeTruthy();
    useChannelSummaryStore.setState({ summaries: SUMMARIES });
    await waitFor(() => expect(rowIds()).toEqual(['room-1', 'general-1']));
  });
});
