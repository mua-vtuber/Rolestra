// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChannelMessages } from '../use-channel-messages';
import type { Message } from '../../../shared/message-types';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    channelId: 'c-a',
    meetingId: null,
    authorId: 'user',
    authorKind: 'user',
    role: 'user',
    content: 'hello',
    meta: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('useChannelMessages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('adds a streamed pass row but still leaves other user rows to send() (spec 2026-10-01 F1)', async () => {
    let emit: ((payload: { message: Message }) => void) | null = null;
    const invoke = vi.fn().mockResolvedValue({ messages: [] });
    vi.stubGlobal('arena', { platform: 'linux', invoke,
      onStream: (_type: string, listener: (payload: { message: Message }) => void) => {
        emit = listener;
        return () => { emit = null; };
      } });
    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emit?.({ message: makeMessage({ id: 'typed', content: 'typed elsewhere' }) });
      emit?.({ message: makeMessage({ id: 'pass', content: 'user_pass', meta: { chatPass: 'user_pass' } }) });
    });

    expect(result.current.messages?.map((m) => m.id)).toEqual(['pass']);
  });

  it('adds a streamed vote-result row once without waiting for a message send or refetch', async () => {
    let emit: ((payload: { message: Message }) => void) | null = null;
    vi.stubGlobal('arena', { platform: 'linux', invoke: vi.fn().mockResolvedValue({ messages: [] }),
      onStream: (_type: string, listener: (payload: { message: Message }) => void) => {
        emit = listener;
        return () => { emit = null; };
      } });
    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const notice = makeMessage({ id: 'result', content: 'vote_result',
      meta: { chatVoteResult: { voteId: 'v', title: 'Topic', counts: { agree: 1, oppose: 0, abstain: 0, failed: 0 } } } });
    act(() => {
      emit?.({ message: notice });
      emit?.({ message: notice });
      emit?.({ message: { ...notice, id: 'other-room', channelId: 'room-b' } });
    });
    expect(result.current.messages).toEqual([notice]);
  });

  it('channelId=null → idle (no IPC, loading=false)', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages(null));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toBeNull();
  });

  it('happy path: message:list-by-channel called exactly once in strict mode (round2.5: reversed to chronological)', async () => {
    // round2.5 fix: repository 는 newest-first (DESC) 로 주는데, hook 은
    // chronological 순 (oldest-first / newest-last) 로 저장한다. UI 가
    // "새 메시지가 아래" 로 보고, send() 의 `[...prev, optimistic]` tail
    // append 가 자연스럽게 newest 자리에 들어가게 하기 위함. 따라서 server
    // 가 [m-1, m-2] (m-1 = newer) 를 주면 hook 은 [m-2, m-1] 로 보관.
    const rows = [makeMessage({ id: 'm-1' }), makeMessage({ id: 'm-2' })];
    const invoke = vi.fn().mockResolvedValue({ messages: rows });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'message:list-by-channel');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]?.[1]).toEqual({ channelId: 'c-a' });
    expect(result.current.messages).toEqual([rows[1], rows[0]]);
  });

  it('passes limit + beforeCreatedAt when supplied', async () => {
    const invoke = vi.fn().mockResolvedValue({ messages: [] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    renderHook(() => useChannelMessages('c-a', { limit: 50, beforeCreatedAt: 1234 }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('message:list-by-channel', {
        channelId: 'c-a',
        limit: 50,
        beforeCreatedAt: 1234,
      });
    });
  });

  it('IPC reject on initial fetch → messages=null, error surfaces', async () => {
    const failure = new Error('bang');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(failure);
    expect(result.current.messages).toBeNull();
  });

  it('send → optimistic insert + canonical swap (no refetch); returns appended message', async () => {
    const initial = [makeMessage({ id: 'm-1' })];
    const invoke = vi.fn((channel: string, data: unknown) => {
      if (channel === 'message:list-by-channel') {
        return Promise.resolve({ messages: initial });
      }
      if (channel === 'message:append') {
        const payload = data as { content: string };
        return Promise.resolve({
          message: makeMessage({ id: 'm-2', content: payload.content }),
        });
      }
      return Promise.reject(new Error(`no mock for ${channel}`));
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toEqual(initial);

    let returned: Message | undefined;
    await act(async () => {
      returned = await result.current.send({ content: 'world' });
    });

    expect(returned?.content).toBe('world');
    expect(invoke).toHaveBeenCalledWith('message:append', {
      channelId: 'c-a',
      content: 'world',
    });
    // R10-Task8: optimistic flow does NOT refetch after success — only
    // the initial list call is expected.
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'message:list-by-channel');
    expect(listCalls).toHaveLength(1);
    // Final list = initial + canonical row swapped in for the temp.
    await waitFor(() =>
      expect(result.current.messages?.map((m) => m.id)).toEqual(['m-1', 'm-2']),
    );
    expect(result.current.messages?.find((m) => m.id.startsWith('pending-'))).toBeUndefined();
  });

  it('send: optimistic row visible BEFORE invoke resolves', async () => {
    const initial = [makeMessage({ id: 'm-1' })];
    let resolveAppend: ((value: { message: Message }) => void) | null = null;
    const appendPromise = new Promise<{ message: Message }>((resolve) => {
      resolveAppend = resolve;
    });
    const invoke = vi.fn((channel: string) => {
      if (channel === 'message:list-by-channel') {
        return Promise.resolve({ messages: initial });
      }
      if (channel === 'message:append') {
        return appendPromise;
      }
      return Promise.reject(new Error(`no mock for ${channel}`));
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Fire send() but do NOT await — we want to inspect the optimistic
    // state while the invoke is still pending. Wrap in act for React
    // batching but capture the promise so we can resolve it later.
    let sendPromise: Promise<Message> | null = null;
    await act(async () => {
      sendPromise = result.current.send({ content: 'pending-text' });
      // Yield once so React commits the optimistic setMessages.
      await Promise.resolve();
    });

    // Pending row is immediately visible.
    const pending = result.current.messages?.find(
      (m) => m.content === 'pending-text',
    );
    expect(pending?.id.startsWith('pending-')).toBe(true);

    // Now resolve the in-flight invoke and await the send to finish.
    await act(async () => {
      resolveAppend?.({ message: makeMessage({ id: 'canonical', content: 'pending-text' }) });
      await sendPromise;
    });

    expect(
      result.current.messages?.find((m) => m.id === 'canonical'),
    ).toBeDefined();
    expect(
      result.current.messages?.some((m) => m.id.startsWith('pending-')),
    ).toBe(false);
  });

  it('send: rollback on failure (pending row removed) and rethrows', async () => {
    const initial = [makeMessage({ id: 'm-1' })];
    const failure = new Error('append-failed');
    const invoke = vi.fn((channel: string) => {
      if (channel === 'message:list-by-channel') {
        return Promise.resolve({ messages: initial });
      }
      if (channel === 'message:append') {
        return Promise.reject(failure);
      }
      return Promise.reject(new Error(`no mock for ${channel}`));
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.send({ content: 'will-fail' }),
      ).rejects.toBe(failure);
    });

    // Optimistic row was removed; only initial row remains.
    expect(result.current.messages?.map((m) => m.id)).toEqual(['m-1']);
    expect(result.current.error).toBe(failure);
  });

  it('send: stream/refetch arriving WITH server clientId before resolve dedups', async () => {
    // D8: simulate the canonical row being inserted via refresh() while
    // the optimistic invoke is still pending; the server row carries the
    // same `meta.clientId`. Because refresh runs through `runFetch`, the
    // pending row should be dropped on next setItems if its clientId
    // matches a server row, preventing double-render after invoke resolves.
    let capturedClientId = '';
    const initial = [makeMessage({ id: 'm-1' })];
    let resolveAppend: ((value: { message: Message }) => void) | null = null;
    const appendPromise = new Promise<{ message: Message }>((resolve) => {
      resolveAppend = resolve;
    });
    const invoke = vi.fn((channel: string, data: unknown) => {
      if (channel === 'message:list-by-channel') {
        if (capturedClientId === '') {
          return Promise.resolve({ messages: initial });
        }
        // Server-side echo with clientId in meta.
        return Promise.resolve({
          messages: [
            ...initial,
            makeMessage({
              id: 'canonical',
              content: 'race-text',
              meta: { clientId: capturedClientId },
            }),
          ],
        });
      }
      if (channel === 'message:append') {
        const payload = data as { content: string };
        // Capture the optimistic clientId from the (already-inserted) state.
        // We can't read it from the IPC payload because main doesn't echo
        // it; instead we read from the pending row stored by the hook.
        void payload;
        return appendPromise;
      }
      return Promise.reject(new Error(`no mock for ${channel}`));
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Fire the optimistic send. Capture the promise so we resolve later.
    let sendPromise: Promise<Message> | null = null;
    await act(async () => {
      sendPromise = result.current.send({ content: 'race-text' });
      await Promise.resolve();
    });

    const pending = result.current.messages?.find(
      (m) => m.content === 'race-text' && m.id.startsWith('pending-'),
    );
    expect(pending).toBeDefined();
    capturedClientId = (pending?.meta as { clientId: string }).clientId;

    // Trigger refresh — this simulates a stream/refetch that races the
    // pending invoke. The refetched list now contains a server row with
    // matching clientId; the pending row must be dropped.
    await act(async () => {
      await result.current.refresh();
    });

    // After refresh: only canonical row, no double-insert.
    expect(
      result.current.messages?.filter((m) => m.content === 'race-text'),
    ).toHaveLength(1);
    expect(
      result.current.messages?.find((m) => m.id.startsWith('pending-')),
    ).toBeUndefined();

    // Now resolve the invoke with the canonical message — must NOT
    // reintroduce the row.
    await act(async () => {
      resolveAppend?.({
        message: makeMessage({
          id: 'canonical',
          content: 'race-text',
          meta: { clientId: capturedClientId },
        }),
      });
      await sendPromise;
    });
    expect(
      result.current.messages?.filter((m) => m.id === 'canonical'),
    ).toHaveLength(1);
  });

  it('send throws when channelId is null', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages(null));

    await expect(result.current.send({ content: 'x' })).rejects.toThrow(
      /no active channel/,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('channelId change clears previous messages immediately and refetches', async () => {
    const rowsA = [makeMessage({ id: 'm-a' })];
    const rowsB = [makeMessage({ id: 'm-b', channelId: 'c-b' })];
    const invoke = vi.fn((_channel: string, data: unknown) => {
      const { channelId } = data as { channelId: string };
      return Promise.resolve({ messages: channelId === 'c-a' ? rowsA : rowsB });
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result, rerender } = renderHook(
      ({ cid }: { cid: string | null }) => useChannelMessages(cid),
      { initialProps: { cid: 'c-a' as string | null } },
    );
    await waitFor(() => expect(result.current.messages).toEqual(rowsA));

    rerender({ cid: 'c-b' });
    // 채널 전환 직후 messages=null 로 리셋(스트레스 플래시 방지), 이후 rowsB.
    await waitFor(() => expect(result.current.messages).toEqual(rowsB));
  });

  it('ignores a delayed old-room fetch after selecting a new room', async () => {
    let resolveA: ((value: { messages: Message[] }) => void) | undefined;
    const pendingA = new Promise<{ messages: Message[] }>((resolve) => { resolveA = resolve; });
    const rowB = makeMessage({ id: 'b', channelId: 'room-b' });
    const invoke = vi.fn((_channel: string, data: { channelId: string }) =>
      data.channelId === 'room-a' ? pendingA : Promise.resolve({ messages: [rowB] }));
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChannelMessages(channelId),
      { initialProps: { channelId: 'room-a' } },
    );

    rerender({ channelId: 'room-b' });
    expect(result.current.messages).toBeNull();
    await waitFor(() => expect(result.current.messages).toEqual([rowB]));
    await act(async () => resolveA?.({ messages: [makeMessage({ id: 'a', channelId: 'room-a' })] }));
    expect(result.current.messages).toEqual([rowB]);
  });

  it('loads older pages and ignores a delayed old-room send completion', async () => {
    const newest = Array.from({ length: 50 }, (_, index) =>
      makeMessage({ id: `new-${index}`, createdAt: 100, channelId: 'room-a' }));
    const older = [makeMessage({ id: 'old', createdAt: 100, channelId: 'room-a' })];
    let resolveSend: ((value: { message: Message }) => void) | undefined;
    const sendPending = new Promise<{ message: Message }>((resolve) => { resolveSend = resolve; });
    const invoke = vi.fn((channel: string, data: { channelId: string; beforeMessageId?: string }) => {
      if (channel === 'message:append') return sendPending;
      if (data.channelId === 'room-b') return Promise.resolve({ messages: [makeMessage({ id: 'b', channelId: 'room-b' })] });
      return Promise.resolve({ messages: data.beforeMessageId ? older : newest });
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChannelMessages(channelId),
      { initialProps: { channelId: 'room-a' } },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.hasOlder).toBe(true);
    await act(async () => result.current.loadOlder());
    expect(result.current.messages).toHaveLength(51);
    expect(result.current.messages?.[0]?.id).toBe('old');
    expect(result.current.hasOlder).toBe(false);
    expect(invoke).toHaveBeenCalledWith('message:list-by-channel', {
      channelId: 'room-a', limit: 50, beforeMessageId: newest[49]?.id,
    });

    let sendPromise: Promise<Message> | undefined;
    await act(async () => { sendPromise = result.current.send({ content: 'in A' }); });
    rerender({ channelId: 'room-b' });
    await waitFor(() => expect(result.current.messages?.[0]?.id).toBe('b'));
    await act(async () => {
      resolveSend?.({ message: makeMessage({ id: 'late-a', channelId: 'room-a' }) });
      await sendPromise;
    });
    expect(result.current.messages?.map((message) => message.id)).toEqual(['b']);
  });

  it('ignores an older-page response after switching rooms', async () => {
    let resolveOlder: ((value: { messages: Message[] }) => void) | undefined;
    const olderPending = new Promise<{ messages: Message[] }>((resolve) => { resolveOlder = resolve; });
    const latestA = Array.from({ length: 50 }, (_, index) =>
      makeMessage({ id: `a-${index}`, channelId: 'room-a' }));
    const rowB = makeMessage({ id: 'b', channelId: 'room-b' });
    const invoke = vi.fn((_channel: string, data: { channelId: string; beforeMessageId?: string }) => {
      if (data.channelId === 'room-b') return Promise.resolve({ messages: [rowB] });
      return data.beforeMessageId ? olderPending : Promise.resolve({ messages: latestA });
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChannelMessages(channelId),
      { initialProps: { channelId: 'room-a' } },
    );
    await waitFor(() => expect(result.current.hasOlder).toBe(true));
    let loadPromise: Promise<void> | undefined;
    await act(async () => { loadPromise = result.current.loadOlder(); });
    rerender({ channelId: 'room-b' });
    await waitFor(() => expect(result.current.messages).toEqual([rowB]));
    await act(async () => {
      resolveOlder?.({ messages: [makeMessage({ id: 'old-a', channelId: 'room-a' })] });
      await loadPromise;
    });
    expect(result.current.messages).toEqual([rowB]);
  });

  it('allows loading older again after refresh supersedes an in-flight older page', async () => {
    let resolveFirstOlder: ((value: { messages: Message[] }) => void) | undefined;
    const firstOlder = new Promise<{ messages: Message[] }>((resolve) => { resolveFirstOlder = resolve; });
    const newest = Array.from({ length: 50 }, (_, index) => makeMessage({ id: `new-${index}` }));
    let olderCalls = 0;
    const invoke = vi.fn((_channel: string, data: { beforeMessageId?: string }) => {
      if (!data.beforeMessageId) return Promise.resolve({ messages: newest });
      olderCalls += 1;
      return olderCalls === 1 ? firstOlder : Promise.resolve({ messages: [makeMessage({ id: 'old' })] });
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });
    const { result } = renderHook(() => useChannelMessages('c-a'));
    await waitFor(() => expect(result.current.hasOlder).toBe(true));
    let firstLoad: Promise<void> | undefined;
    await act(async () => { firstLoad = result.current.loadOlder(); });
    expect(result.current.loadingOlder).toBe(true);
    await act(async () => result.current.refresh());
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.hasOlder).toBe(true);
    await act(async () => {
      resolveFirstOlder?.({ messages: [makeMessage({ id: 'superseded' })] });
      await firstLoad;
    });
    await act(async () => result.current.loadOlder());
    expect(olderCalls).toBe(2);
    expect(result.current.messages?.[0]?.id).toBe('old');
  });
});
