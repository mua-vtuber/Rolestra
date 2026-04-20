// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentMessages } from '../use-recent-messages';
import type { RecentMessage } from '../../../shared/message-types';

const SAMPLE: RecentMessage = {
  id: 'msg-1',
  channelId: 'c1',
  channelName: 'general',
  senderId: 'user',
  senderKind: 'user',
  senderLabel: 'user',
  excerpt: 'hello',
  createdAt: 1700000000000,
};

describe('useRecentMessages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('success path: issues IPC call and populates messages', async () => {
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValue({ messages: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useRecentMessages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledWith('message:list-recent', {});
    expect(result.current.messages).toEqual([SAMPLE]);
    expect(result.current.error).toBeNull();
  });

  it('error path: keeps messages null on initial failure', async () => {
    const failure = new Error('boom');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useRecentMessages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.messages).toBeNull();
  });
});
