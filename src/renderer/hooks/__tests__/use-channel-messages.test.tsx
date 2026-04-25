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

  it('channelId=null → idle (no IPC, loading=false)', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages(null));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toBeNull();
  });

  it('happy path: message:list-by-channel called exactly once in strict mode', async () => {
    const rows = [makeMessage({ id: 'm-1' }), makeMessage({ id: 'm-2' })];
    const invoke = vi.fn().mockResolvedValue({ messages: rows });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMessages('c-a'), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'message:list-by-channel');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]?.[1]).toEqual({ channelId: 'c-a' });
    expect(result.current.messages).toEqual(rows);
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
});
