// @vitest-environment jsdom

/**
 * Thread surfaces of spec 2026-10-01: the pass button and pass row (F1), the
 * writing indicator (F5) and whisper threads shown in position order (F2-8).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Thread } from '../Thread';
import { i18next } from '../../../i18n';
import { useActiveChannelStore } from '../../../stores/active-channel-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { useChatActivityStore } from '../../../stores/chat-activity-store';
import type { Channel } from '../../../../shared/channel-types';
import { chatChannelForTest } from '../../../../test-utils/channel-fixture';
import type { Message as ChannelMessage } from '../../../../shared/message-types';
import type { MemberView } from '../../../../shared/member-profile-types';

const general = chatChannelForTest({
  id: 'general-1', projectId: null, name: 'General',
  kind: 'system_general', readOnly: false, createdAt: 1,
});
const room: Channel = {
  ...general, id: 'room-1', name: 'Room', kind: 'user', isChatRoom: true, role: null, archivedAt: null,
};
const member = (providerId: string, displayName: string): MemberView => ({
  providerId, displayName, characterSheet: '', avatarKind: 'default', avatarData: null,
  statusOverride: null, updatedAt: 1, workStatus: 'online',
} as MemberView);
const MEMBERS = [member('ai-a', 'Alice'), member('ai-b', 'Bob')];

type StreamListener = (payload: unknown) => void;

function stubBridge(options: {
  rooms?: Channel[]; history?: ChannelMessage[]; pass?: (channelId: string) => Promise<unknown>;
} = {}) {
  const listeners = new Map<string, Set<StreamListener>>();
  const invoke = vi.fn(async (channel: string, data?: unknown) => {
    switch (channel) {
      case 'room:list': return { rooms: options.rooms ?? [] };
      case 'channel:get-global-general': return { channel: general };
      case 'channel:list-members': return { members: MEMBERS };
      case 'opinion:listGeneralCards': return { result: { channelId: (data as { channelId: string }).channelId, cards: [] } };
      case 'message:list-by-channel': return { messages: options.history ?? [] };
      case 'channel:mark-read': return { success: true };
      case 'chat:pass-turn': {
        const channelId = (data as { channelId: string }).channelId;
        if (options.pass) return options.pass(channelId);
        return { message: passRow(channelId) };
      }
      default: throw new Error(`unexpected IPC: ${channel}`);
    }
  });
  vi.stubGlobal('arena', {
    platform: 'linux', invoke,
    onStream: (type: string, listener: StreamListener) => {
      const set = listeners.get(type) ?? new Set<StreamListener>();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    },
  });
  return { invoke, emit: (type: string, payload: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(payload);
  } };
}

function passRow(channelId: string): ChannelMessage {
  return {
    id: `pass-${channelId}`, channelId, meetingId: null, authorId: 'user', authorKind: 'user', role: 'user',
    content: 'user_pass', meta: { chatPass: 'user_pass' }, createdAt: 1_700_000_000_500, visibility: 'public',
  };
}

function open(channel: Channel): void {
  useActiveChannelStore.setState({ globalChannelId: channel.id, selectedScope: 'global' });
}

beforeEach(() => {
  useChatActivityStore.getState().reset();
  void i18next.changeLanguage('ko');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pass button (F1)', () => {
  it('sits next to the input in the general channel and rooms only', async () => {
    stubBridge({ rooms: [room] });
    open(general);
    const view = render(<Thread />);
    expect((await screen.findByTestId('chat-pass-turn')).textContent).toBe('넘기기');
    view.unmount();

    open(room);
    render(<Thread />);
    await screen.findByTestId('chat-pass-turn');
  });

  it('reads [넘기기] next to the log prompt in the log layout (R3-7)', async () => {
    stubBridge({ rooms: [room] });
    open(room);
    useThemeStore.setState({ themeKey: 'retro', mode: 'dark' });
    try {
      render(<ThemeProvider><Thread /></ThemeProvider>);
      const pass = await screen.findByTestId('chat-pass-turn');
      expect(pass.textContent).toBe('[넘기기]');
      expect(screen.getByTestId('composer-input-row').contains(pass)).toBe(true);
    } finally {
      useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
    }
  });

  it('is not offered in an archived room', async () => {
    stubBridge({ rooms: [{ ...room, readOnly: true, archivedAt: 10 }] });
    open(room);
    render(<Thread />);
    await screen.findByTestId('room-archived-notice');
    expect(screen.queryByTestId('chat-pass-turn')).toBeNull();
  });

  it('passes through typed IPC and shows the streamed pass row as a quiet translated line', async () => {
    const bridge = stubBridge({ rooms: [room] });
    open(room);
    render(<Thread />);
    fireEvent.click(await screen.findByTestId('chat-pass-turn'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('chat:pass-turn', { channelId: room.id }));
    act(() => bridge.emit('stream:channel-message', { message: passRow(room.id) }));
    const line = await screen.findByTestId('system-message');
    expect(line.getAttribute('data-tone')).toBe('quiet');
    expect(screen.getByTestId('system-message-body').textContent).toBe('넘김');
    expect(screen.queryByText('user_pass')).toBeNull();
    expect(screen.queryByTestId('message')).toBeNull();
  });

  it('shows the translated reason when main refuses the pass', async () => {
    stubBridge({ rooms: [room], pass: async () => {
      throw new Error("Error invoking remote method 'chat:pass-turn': Error: [INTERNAL_ERROR] chat_pass_rejected:round_running (channel room-1)");
    } });
    open(room);
    render(<Thread />);
    fireEvent.click(await screen.findByTestId('chat-pass-turn'));
    expect((await screen.findByTestId('chat-pass-turn-error')).textContent)
      .toBe('이미 대화가 진행 중입니다. 끝난 뒤 다시 눌러 주세요.');
  });

  it('stays disabled between one turn\'s idle and the next turn while the round runs (QA M1)', async () => {
    stubBridge({ rooms: [room] });
    open(room);
    render(<Thread />);
    const button = await screen.findByTestId('chat-pass-turn') as HTMLButtonElement;
    const { apply, applyRound } = useChatActivityStore.getState();
    act(() => {
      applyRound({ channelId: room.id, active: true });
      apply({ channelId: room.id, providerId: 'ai-a', phase: 'writing', kind: 'turn' });
    });
    expect(button.disabled).toBe(true);
    act(() => apply({ channelId: room.id, providerId: 'ai-a', phase: 'idle', kind: 'turn' }));
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('chat-activity-indicator').textContent).toBe('');
    act(() => apply({ channelId: room.id, providerId: 'ai-b', phase: 'queued', kind: 'turn' }));
    expect(button.disabled).toBe(true);
    act(() => applyRound({ channelId: room.id, active: false }));
    expect(button.disabled).toBe(false);
    expect(screen.getByTestId('chat-activity-indicator').textContent).toBe('');
  });

  it('explains a refusal for a channel without participants (QA m5)', async () => {
    stubBridge({ pass: async () => {
      throw new Error("Error invoking remote method 'chat:pass-turn': Error: [INTERNAL_ERROR] chat_pass_rejected:no_participants (channel general-1)");
    } });
    open(general);
    render(<Thread />);
    fireEvent.click(await screen.findByTestId('chat-pass-turn'));
    expect((await screen.findByTestId('chat-pass-turn-error')).textContent)
      .toBe('대화에 참가한 AI가 없어 넘길 수 없습니다.');
  });

  it('is disabled while its channel has a turn in progress, and only its own channel counts', async () => {
    stubBridge({ rooms: [room] });
    open(room);
    render(<Thread />);
    const button = await screen.findByTestId('chat-pass-turn') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => useChatActivityStore.getState().apply({ channelId: general.id, providerId: 'ai-a', phase: 'writing', kind: 'turn' }));
    expect(button.disabled).toBe(false);
    act(() => useChatActivityStore.getState().apply({ channelId: room.id, providerId: 'ai-b', phase: 'queued', kind: 'turn' }));
    expect(button.disabled).toBe(true);
    act(() => useChatActivityStore.getState().apply({ channelId: room.id, providerId: 'ai-b', phase: 'idle', kind: 'turn' }));
    expect(button.disabled).toBe(false);
  });
});

describe('writing indicator (F5)', () => {
  it('shows under the message list with participant names in rooms and general', async () => {
    stubBridge({ rooms: [room] });
    open(room);
    const view = render(<Thread />);
    await screen.findByTestId('chat-activity-indicator');
    await waitFor(() => expect(screen.getByTestId('thread').getAttribute('data-channel-id')).toBe(room.id));
    await screen.findByTestId('chat-pass-turn');
    act(() => useChatActivityStore.getState().apply({
      channelId: room.id, providerId: 'ai-b', phase: 'writing', kind: 'whisper', peerProviderId: 'ai-a',
    }));
    await waitFor(() => expect(screen.getByTestId('chat-activity-indicator').textContent)
      .toBe('Bob → Alice 귓속말 입력 중…'));
    view.unmount();

    open(general);
    render(<Thread />);
    await screen.findByTestId('chat-activity-indicator');
    act(() => useChatActivityStore.getState().apply({ channelId: general.id, providerId: 'ai-a', phase: 'writing', kind: 'turn' }));
    await waitFor(() => expect(screen.getByTestId('chat-activity-indicator').textContent).toBe('Alice 입력 중…'));
  });
});

describe('whisper threads in the observer view (F2-8)', () => {
  it('shows every row of a thread in position order, each reply with its position', async () => {
    const at = 1_700_000_000_000;
    const whisper = (id: string, authorId: string, recipientId: string, seq: number): ChannelMessage => ({
      id, channelId: room.id, meetingId: null, authorId, authorKind: 'member', role: 'assistant',
      content: `thread line ${seq}`, meta: null, createdAt: at, visibility: 'whisper',
      whisper: {
        recipientId, senderName: authorId === 'ai-a' ? 'Alice' : 'Bob',
        recipientName: recipientId === 'ai-a' ? 'Alice' : 'Bob',
        sourceMessageId: 'user-1', replyToMessageId: seq === 1 ? null : 'root', threadSeq: seq,
      },
    });
    // Newest first, as the list IPC returns it, with the same timestamp on every row.
    const history = [
      whisper('reply-3', 'ai-a', 'ai-b', 3), whisper('reply-4', 'ai-b', 'ai-a', 4),
      whisper('reply-2', 'ai-b', 'ai-a', 2), whisper('root', 'ai-a', 'ai-b', 1),
    ];
    stubBridge({ rooms: [room], history });
    open(room);
    render(<Thread />);
    await screen.findByText('thread line 1');
    expect(screen.getAllByTestId('message-content').map((element) => element.textContent)).toEqual([
      'thread line 1', 'thread line 2', 'thread line 3', 'thread line 4',
    ]);
    expect(screen.getAllByTestId('message-whisper-kind').map((element) => element.textContent)).toEqual([
      '귓속말', '답장 2/4', '답장 3/4', '답장 4/4',
    ]);
    expect(screen.getAllByTestId('message').map((element) => element.getAttribute('data-thread-seq')))
      .toEqual(['1', '2', '3', '4']);
  });
});
