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

  it('send → message:append + refetch, returns appended message', async () => {
    const initial = [makeMessage({ id: 'm-1' })];
    const fresh = [...initial, makeMessage({ id: 'm-2', content: 'world' })];
    let listCount = 0;
    const invoke = vi.fn((channel: string, data: unknown) => {
      if (channel === 'message:list-by-channel') {
        listCount += 1;
        return Promise.resolve({ messages: listCount === 1 ? initial : fresh });
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
    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'message:list-by-channel');
    expect(listCalls).toHaveLength(2);
    await waitFor(() => expect(result.current.messages).toEqual(fresh));
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
