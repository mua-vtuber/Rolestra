// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Thread } from '../Thread';
import { MemberPanel } from '../MemberPanel';
import { i18next } from '../../../i18n';
import { useActiveChannelStore } from '../../../stores/active-channel-store';
import { notifyChannelsChanged } from '../../../hooks/channel-invalidation-bus';
import type { Channel } from '../../../../shared/channel-types';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { Message as ChannelMessage } from '../../../../shared/message-types';

const general = chatChannelForTest({
  id: 'general-1', projectId: null, name: 'General',
  kind: 'system_general', readOnly: false, createdAt: 1,
});
const dm = chatChannelForTest({
  id: 'dm-1', projectId: null, name: 'dm:ai-1',
  kind: 'dm', readOnly: false, createdAt: 2,
});
const room: Channel = {
  ...general, id: 'room-1', name: 'Room', kind: 'user', isChatRoom: true,
  role: null, archivedAt: null,
};

function stubBridge(rooms: Channel[] = [], history?: ChannelMessage[]) {
  const opinions: unknown[] = [];
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      // IPC returns a fresh serialized value on every refresh.
      case 'room:list': return { rooms: rooms.map((entry) => ({ ...entry })) };
      case 'channel:get-global-general': return { channel: general };
      case 'channel:list': return { channels: [dm] };
      case 'channel:list-members': return { members: [] };
      case 'opinion:listGeneralCards': return { result: { channelId: (data as { channelId: string }).channelId, cards: [...opinions] } };
      case 'opinion:postFromGeneral': {
        const input = data as { channelId: string; parts: { title: string; content: string }[] };
        const opinion = {
          id: 'posted-1', parentId: null, meetingId: null, channelId: input.channelId,
          kind: 'user-raised', authorProviderId: null, authorLabel: 'User',
          title: input.parts[0]!.title, content: input.parts[0]!.content,
          rationale: null, status: 'pending', exclusionReason: null, round: 0,
          createdAt: 1, updatedAt: 1,
        };
        opinions.push({ opinion, agreeCount: 0, opposeCount: 0, userVote: null });
        return { result: { channelId: input.channelId, inserted: [opinion] } };
      }
      case 'opinion:getVote': return { result: null };
      case 'channel:mark-read': return { success: true };
      case 'message:list-by-channel': return { messages: history ?? [{
        id: 'm-1', channelId: (data as { channelId: string }).channelId,
        meetingId: null, authorId: 'user', authorKind: 'user', role: 'user',
        content: 'Hello from history', meta: null, createdAt: 1_700_000_000_000,
      }] };
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke, onStream: () => () => {} });
  return invoke;
}

beforeEach(() => {
  useActiveChannelStore.setState({
    channelIdByProject: {}, globalChannelId: general.id, selectedScope: 'global',
  });
  void i18next.changeLanguage('ko');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The header actions sit in the room menu (spec 2026-10-01-messenger-redesign.md R3-1). */
async function openRoomMenu(): Promise<void> {
  fireEvent.click(await screen.findByTestId('room-menu-open'));
  await screen.findByTestId('room-menu');
}

async function clickMenuItem(testId: string): Promise<void> {
  await openRoomMenu();
  fireEvent.click(screen.getByTestId(testId));
}

describe('chat thread', () => {
  it('renders general history and composer without work IPC', async () => {
    const invoke = stubBridge();
    render(<Thread />);
    await waitFor(() => expect(screen.getByText('Hello from history')).toBeTruthy());
    expect(screen.getByTestId('thread-whisper-observer-notice')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();
    await openRoomMenu();
    expect(screen.getByTestId('chat-post-opinion')).toBeTruthy();
    expect(invoke.mock.calls.map(([channel]) => channel).filter((channel) =>
      /^(project|queue|meeting|approval|execution|handoff):/.test(channel))).toEqual([]);
  });

  it('clears a remembered legacy DM without opening its conversation controls', async () => {
    stubBridge();
    useActiveChannelStore.setState({ globalChannelId: dm.id, selectedScope: 'global' });
    render(<Thread />);
    await waitFor(() => expect(useActiveChannelStore.getState().globalChannelId).toBeNull());
    expect(screen.getByTestId('thread-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('room-menu-open')).toBeNull();
    expect(screen.queryByTestId('composer')).toBeNull();
  });

  it('offers opinion posting in a writable chat room and hides it after archive', async () => {
    stubBridge([room]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    const view = render(<Thread />);
    await openRoomMenu();
    expect(screen.getByTestId('chat-post-opinion')).toBeTruthy();
    expect(screen.getByTestId('room-archive-open')).toBeTruthy();
    expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(room.id);

    view.unmount();
    stubBridge([{ ...room, readOnly: true, archivedAt: 10 }]);
    render(<Thread />);
    await screen.findByTestId('room-archived-notice');
    await openRoomMenu();
    expect(screen.queryByTestId('chat-post-opinion')).toBeNull();
    expect(screen.queryByTestId('room-archive-open')).toBeNull();
    expect(screen.getByTestId('room-delete-open')).toBeTruthy();
  });

  it('shows a manually posted room opinion in the card list without a message event', async () => {
    const invoke = stubBridge([room]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<><Thread /><MemberPanel /></>);
    await clickMenuItem('chat-post-opinion');
    fireEvent.change(screen.getByTestId('post-opinion-title'), { target: { value: 'Manual topic' } });
    fireEvent.change(screen.getByTestId('post-opinion-content'), { target: { value: 'Manual body' } });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('opinion:postFromGeneral', expect.anything()));
    await screen.findByText('Manual topic');
    expect(invoke.mock.calls.filter(([channel]) => channel === 'opinion:listGeneralCards').length).toBeGreaterThan(1);
  });

  it('closes an opinion draft when the room changes and opens a clean draft for the next room', async () => {
    const otherRoom = { ...room, id: 'room-2', name: 'Other room' };
    const invoke = stubBridge([room, otherRoom]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await clickMenuItem('chat-post-opinion');
    fireEvent.change(screen.getByTestId('post-opinion-content'), { target: { value: 'Old room draft' } });
    useActiveChannelStore.setState({ globalChannelId: otherRoom.id });
    await waitFor(() => expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(otherRoom.id));
    await waitFor(() => expect(screen.queryByTestId('post-opinion-modal')).toBeNull());
    await clickMenuItem('chat-post-opinion');
    expect((screen.getByTestId('post-opinion-content') as HTMLTextAreaElement).value).toBe('');
    expect(invoke.mock.calls.filter(([channel]) => channel === 'opinion:postFromGeneral')).toHaveLength(0);
  });

  it('closes an open opinion draft when its room is archived', async () => {
    const rooms = [{ ...room }];
    stubBridge(rooms);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await clickMenuItem('chat-post-opinion');
    expect(screen.getByTestId('post-opinion-modal')).toBeTruthy();
    rooms[0] = { ...room, readOnly: true, archivedAt: 10 };
    await act(async () => { await notifyChannelsChanged(); });
    await waitFor(() => expect(screen.queryByTestId('post-opinion-modal')).toBeNull());
    await openRoomMenu();
    expect(screen.queryByTestId('chat-post-opinion')).toBeNull();
  });

  it('keeps observer notice and private route visible in an archived room', async () => {
    const history: ChannelMessage[] = [{
      id: 'private-1', channelId: room.id, meetingId: null,
      authorId: 'ai-a', authorKind: 'member', role: 'assistant',
      content: 'Saved private text', meta: null, createdAt: 1_700_000_000_000,
      visibility: 'whisper', whisper: {
        recipientId: 'ai-b', senderName: 'Alice', recipientName: 'Bob',
        sourceMessageId: 'user-1', replyToMessageId: null, threadSeq: 1,
      },
    }, {
      id: 'private-2', channelId: room.id, meetingId: null,
      authorId: 'ai-b', authorKind: 'member', role: 'assistant',
      content: 'Saved private reply', meta: null, createdAt: 1_700_000_000_001,
      visibility: 'whisper', whisper: {
        recipientId: 'ai-a', senderName: 'Bob', recipientName: 'Alice',
        sourceMessageId: 'user-1', replyToMessageId: 'private-1', threadSeq: 2,
      },
    }];
    stubBridge([{ ...room, readOnly: true, archivedAt: 10 }], [...history].reverse());
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await screen.findByText('Saved private text');
    expect(screen.getByTestId('room-archived-notice')).toBeTruthy();
    const observing = screen.getByTestId('thread-whisper-observer-notice');
    expect(observing.textContent).toContain('귓속말까지 보는 중');
    expect(observing.getAttribute('title')).toContain('모두 볼 수');
    expect(screen.getAllByTestId('message-whisper-route').map((element) => element.textContent)).toEqual([
      'Alice → Bob', 'Bob → Alice',
    ]);
    expect(screen.getAllByTestId('message-whisper-kind').map((element) => element.textContent)).toEqual([
      '귓속말', '답장 2/4',
    ]);
  });

  it('shows a sanitized member error as a system notice', async () => {
    stubBridge([room], [{
      id: 'error-1', channelId: room.id, meetingId: null,
      authorId: 'ai-a', authorKind: 'member', role: 'system',
      content: 'invalid_response', meta: { chatError: 'invalid_response' },
      createdAt: 1_700_000_000_000,
    }]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await screen.findByTestId('system-message-body');
    expect(screen.getByTestId('system-message-body').textContent).toContain('응답 형식');
  });

  it('shows a member silence notice as a quiet system line, not as a chat bubble (W4)', async () => {
    stubBridge([room], [{
      id: 'silence-1', channelId: room.id, meetingId: null,
      authorId: 'ai-a', authorKind: 'member', role: 'system',
      content: 'turn_passed', meta: { chatSilence: { code: 'turn_passed', speakerName: 'Alice' } },
      createdAt: 1_700_000_000_000,
    }]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await screen.findByTestId('system-message-body');
    expect(screen.getByTestId('system-message').getAttribute('data-tone')).toBe('quiet');
    expect(screen.getByTestId('system-message-body').textContent).toContain('Alice은(는) 이번에 말하지 않았습니다');
    expect(screen.queryByTestId('message')).toBeNull();
  });

  it('starts a new visual group when the same AI speaks publicly after a whisper', async () => {
    const root: ChannelMessage = {
      id: 'root', channelId: room.id, meetingId: null,
      authorId: 'ai-a', authorKind: 'member', role: 'assistant',
      content: 'Private line', meta: null, createdAt: 1_700_000_000_000,
      visibility: 'whisper', whisper: {
        recipientId: 'ai-b', senderName: 'Alice', recipientName: 'Bob',
        sourceMessageId: 'user-1', replyToMessageId: null, threadSeq: 1,
      },
    };
    const publicAfter: ChannelMessage = {
      ...root, id: 'public-after', content: 'Public line', createdAt: root.createdAt + 1,
      visibility: 'public', whisper: undefined,
    };
    stubBridge([room], [publicAfter, root]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    const publicRow = await screen.findByText('Public line');
    expect(publicRow.closest('[data-testid="message"]')?.getAttribute('data-compact')).toBe('false');
  });

  it('keeps the room-info drawer closed until the header toggle opens it', async () => {
    stubBridge([room]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    const toggle = await screen.findByTestId('room-info-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('messenger-member-panel')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('messenger-member-panel')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('messenger-member-panel')).toBeNull();
  });

  it('marks the open conversation read up to its newest stored message while visible', async () => {
    const invoke = stubBridge([room], [{
      id: 'newest', channelId: room.id, meetingId: null, authorId: 'ai-a', authorKind: 'member',
      role: 'assistant', content: 'Newest line', meta: null, createdAt: 1_700_000_000_002,
    }, {
      id: 'older', channelId: room.id, meetingId: null, authorId: 'ai-a', authorKind: 'member',
      role: 'assistant', content: 'Older line', meta: null, createdAt: 1_700_000_000_001,
    }]);
    useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
    render(<Thread />);
    await screen.findByText('Newest line');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('channel:mark-read', { channelId: room.id, messageId: 'newest' }));
    expect(invoke.mock.calls.filter(([channel]) => channel === 'channel:mark-read')).toHaveLength(1);
  });

  it('does not mark a conversation read while the window is hidden', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const invoke = stubBridge([room]);
      useActiveChannelStore.setState({ globalChannelId: room.id, selectedScope: 'global' });
      render(<Thread />);
      await screen.findByText('Hello from history');
      expect(invoke.mock.calls.filter(([channel]) => channel === 'channel:mark-read')).toHaveLength(0);
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('channel:mark-read', { channelId: room.id, messageId: 'm-1' }));
    } finally {
      visibility.mockRestore();
    }
  });
});
