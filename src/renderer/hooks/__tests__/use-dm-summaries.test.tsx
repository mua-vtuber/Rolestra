// @vitest-environment jsdom

import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDmSummaries } from '../use-dm-summaries';
import { notifyChannelsChanged } from '../channel-invalidation-bus';
import type { DmSummary } from '../../../shared/dm-types';
import type { Channel } from '../../../shared/channel-types';

function makeChannel(id: string): Channel {
  return {
    id,
    projectId: null,
    name: `dm:${id}`,
    kind: 'dm',
    readOnly: false,
    createdAt: 1,
  };
}

function makeItem(providerId: string, exists: boolean): DmSummary {
  return {
    providerId,
    providerName: providerId.toUpperCase(),
    channel: exists ? makeChannel(`ch-${providerId}`) : null,
    exists,
  };
}

describe('useDmSummaries', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches once on mount and populates data', async () => {
    const invoke = vi.fn().mockResolvedValue({
      items: [makeItem('claude', true), makeItem('codex', false)],
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDmSummaries());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).toHaveBeenCalledWith('dm:list', undefined);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.exists).toBe(true);
  });

  it('keeps data null on initial error', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDmSummaries());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toBe('boom');
  });

  it('refresh() refetches and preserves stale data on refetch error', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ items: [makeItem('claude', true)] })
      .mockRejectedValueOnce(new Error('refresh failed'));
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDmSummaries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error?.message).toBe('refresh failed');
    expect(result.current.data).toHaveLength(1); // kept
  });

  it('refetches automatically when channel invalidation fires', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ items: [makeItem('claude', false)] })
      .mockResolvedValueOnce({ items: [makeItem('claude', true)] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDmSummaries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.[0]?.exists).toBe(false);

    await act(async () => {
      notifyChannelsChanged();
    });

    await waitFor(() => expect(result.current.data?.[0]?.exists).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
