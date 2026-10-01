// @vitest-environment jsdom

/**
 * Chat list freshness (spec 2026-10-01-messenger-redesign.md R4-3/R4-4):
 * one full read, then each streamed message patches only its own row; a
 * message for a channel the list does not know yet triggers one coalesced
 * re-read; marking read zeroes the row.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SUMMARY_REFETCH_COALESCE_MS,
  markChannelRead,
  reloadChannelSummaries,
  useChannelSummariesSync,
} from '../use-channel-summaries-sync';
import { useChannelSummaryStore } from '../../stores/channel-summary-store';
import { useActiveChannelStore } from '../../stores/active-channel-store';
import { useAppViewStore } from '../../stores/app-view-store';
import type { ChannelSummary } from '../../../shared/channel-summary-types';
import type { Message } from '../../../shared/message-types';

type Listener = (payload: unknown) => void;

function summary(channelId: string, unreadCount = 0): ChannelSummary {
  return {
    channelId, kind: 'room', name: channelId, archivedAt: null, participants: [],
    lastMessage: null, lastActivityAt: 10, unreadCount,
  };
}

function aiMessage(channelId: string, id: string, createdAt = 100): Message {
  return {
    id, channelId, meetingId: null, authorId: 'ai-a', authorKind: 'member', role: 'assistant',
    content: `text ${id}`, meta: null, createdAt, visibility: 'public',
  };
}

function stubBridge(responses: ChannelSummary[][]) {
  const listeners = new Map<string, Set<Listener>>();
  let call = 0;
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'channel:list-summaries') {
      const next = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return { summaries: next };
    }
    if (channel === 'channel:mark-read') return { success: true };
    throw new Error(`unexpected IPC: ${channel}`);
  });
  vi.stubGlobal('arena', {
    platform: 'linux', invoke,
    onStream: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    },
  });
  return {
    invoke,
    emit(message: Message): void {
      for (const listener of listeners.get('stream:channel-message') ?? []) listener({ message });
    },
    summaryCalls: () => invoke.mock.calls.filter(([c]) => c === 'channel:list-summaries').length,
  };
}

function Harness() {
  useChannelSummariesSync();
  return null;
}

function rowOf(channelId: string): ChannelSummary {
  const row = useChannelSummaryStore.getState().summaries?.find((item) => item.channelId === channelId);
  if (!row) throw new Error(`row missing: ${channelId}`);
  return row;
}

beforeEach(() => {
  useChannelSummaryStore.setState({ summaries: null, loading: false, error: null });
  useActiveChannelStore.setState({ channelIdByProject: {}, globalChannelId: null, selectedScope: 'global' });
  useAppViewStore.setState({ view: 'messenger' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useChannelSummariesSync', () => {
  it('reads the list once, then patches only the touched row per message', async () => {
    const bridge = stubBridge([[summary('room-1'), summary('room-2')]]);
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(2));

    act(() => bridge.emit(aiMessage('room-1', 'a1', 200)));
    act(() => bridge.emit(aiMessage('room-1', 'a2', 300)));

    expect(rowOf('room-1')).toMatchObject({ unreadCount: 2, lastActivityAt: 300, lastMessage: { id: 'a2', content: 'text a2' } });
    expect(rowOf('room-2')).toMatchObject({ unreadCount: 0, lastMessage: null });
    expect(bridge.summaryCalls()).toBe(1);
  });

  it('does not count a message in the channel the user is looking at', async () => {
    const bridge = stubBridge([[summary('room-1')]]);
    useActiveChannelStore.setState({ globalChannelId: 'room-1' });
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));

    act(() => bridge.emit(aiMessage('room-1', 'a1')));
    expect(rowOf('room-1')).toMatchObject({ unreadCount: 0, lastMessage: { id: 'a1' } });

    act(() => useAppViewStore.setState({ view: 'settings' }));
    act(() => bridge.emit(aiMessage('room-1', 'a2', 200)));
    expect(rowOf('room-1').unreadCount).toBe(1);
  });

  it('never counts the user\'s own message, a notice or a whisper text leak', async () => {
    const bridge = stubBridge([[summary('room-1')]]);
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));

    act(() => bridge.emit({ ...aiMessage('room-1', 'u1', 200), authorId: 'user', authorKind: 'user', role: 'user' }));
    act(() => bridge.emit({ ...aiMessage('room-1', 'n1', 300), role: 'system', meta: { chatError: 'timeout' } }));
    expect(rowOf('room-1')).toMatchObject({ unreadCount: 0, lastMessage: { id: 'n1', notice: { chatError: 'timeout' } } });

    act(() => bridge.emit({
      ...aiMessage('room-1', 'w1', 400), content: 'private words', visibility: 'whisper',
      whisper: { recipientId: 'ai-b', senderName: 'Alice', recipientName: 'Bob', sourceMessageId: 'u1', replyToMessageId: null, threadSeq: 1 },
    }));
    expect(rowOf('room-1')).toMatchObject({ unreadCount: 1, lastMessage: { content: null, whisper: { senderName: 'Alice', recipientName: 'Bob' } } });
    expect(JSON.stringify(rowOf('room-1'))).not.toContain('private words');
  });

  it('re-reads once (coalesced) when messages arrive for a channel the list does not know', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bridge = stubBridge([[summary('room-1')], [summary('room-1'), summary('room-new', 2)]]);
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));

    act(() => {
      bridge.emit(aiMessage('room-new', 'n1'));
      bridge.emit(aiMessage('room-new', 'n2', 101));
      bridge.emit(aiMessage('room-new', 'n3', 102));
    });
    expect(bridge.summaryCalls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(SUMMARY_REFETCH_COALESCE_MS + 5); });

    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(2));
    expect(bridge.summaryCalls()).toBe(2);
  });

  it('marking read stores the marker in main and zeroes the row', async () => {
    const bridge = stubBridge([[summary('room-1', 3)]]);
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));
    act(() => bridge.emit(aiMessage('room-1', 'a1')));

    await act(async () => { await markChannelRead('room-1', 'a1'); });

    expect(bridge.invoke).toHaveBeenCalledWith('channel:mark-read', { channelId: 'room-1', messageId: 'a1' });
    expect(rowOf('room-1').unreadCount).toBe(0);
  });

  it('keeps the count when a newer message arrived while the marker was being saved', async () => {
    const bridge = stubBridge([[summary('room-1')]]);
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));
    act(() => bridge.emit(aiMessage('room-1', 'a1', 100)));
    act(() => bridge.emit(aiMessage('room-1', 'a2', 200)));

    await act(async () => { await markChannelRead('room-1', 'a1'); });

    expect(rowOf('room-1').unreadCount).toBe(2);
  });

  it('shows a failed first read as an error, not an empty list', async () => {
    vi.stubGlobal('arena', {
      platform: 'linux',
      invoke: vi.fn(async () => { throw new Error('summaries offline'); }),
      onStream: () => () => undefined,
    });
    render(<Harness />);
    await waitFor(() => expect(useChannelSummaryStore.getState().error?.message).toBe('summaries offline'));
    expect(useChannelSummaryStore.getState().summaries).toBeNull();
  });

  // QA Minor 7: a failed first read recovers — on request and on the next event.
  describe('recovering from a failed first read', () => {
    function failingThenWorking() {
      const listeners = new Set<Listener>();
      let fail = true;
      const invoke = vi.fn(async (channel: string) => {
        if (channel !== 'channel:list-summaries') throw new Error(`unexpected IPC: ${channel}`);
        if (fail) throw new Error('summaries offline');
        return { summaries: [summary('room-1')] };
      });
      vi.stubGlobal('arena', {
        platform: 'linux', invoke,
        onStream: (_type: string, listener: Listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });
      return {
        recover: () => { fail = false; },
        emit: (message: Message) => { for (const listener of listeners) listener({ message }); },
      };
    }

    it('reads again when the user asks', async () => {
      const bridge = failingThenWorking();
      render(<Harness />);
      await waitFor(() => expect(useChannelSummaryStore.getState().error).not.toBeNull());
      bridge.recover();
      act(() => reloadChannelSummaries());
      await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1));
      expect(useChannelSummaryStore.getState().error).toBeNull();
    });

    it('reads again when the next message arrives', async () => {
      const bridge = failingThenWorking();
      render(<Harness />);
      await waitFor(() => expect(useChannelSummaryStore.getState().error).not.toBeNull());
      bridge.recover();
      act(() => bridge.emit(aiMessage('room-1', 'm-1')));
      await waitFor(() => expect(useChannelSummaryStore.getState().summaries).toHaveLength(1), { timeout: 2_000 });
    });

    it('says so when nothing is mounted to reload', () => {
      expect(() => reloadChannelSummaries()).toThrow(/not mounted/);
    });
  });
});
