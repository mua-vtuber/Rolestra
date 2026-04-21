// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChannels } from '../use-channels';
import type { Channel } from '../../../shared/channel-types';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c-1',
    projectId: 'p-a',
    name: 'general',
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('useChannels', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('projectId=null → idle (no IPC, loading=false, channels=null)', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannels(null));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.channels).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('projectId non-null → calls channel:list once in strict mode', async () => {
    const channels = [makeChannel({ id: 'c-a', name: 'general' }), makeChannel({ id: 'c-b', name: 'random' })];
    const invoke = vi.fn().mockResolvedValue({ channels });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannels('p-a'), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'channel:list');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]?.[1]).toEqual({ projectId: 'p-a' });
    expect(result.current.channels).toEqual(channels);
    expect(result.current.error).toBeNull();
  });

  it('IPC reject on initial fetch → channels stays null, error surfaces', async () => {
    const failure = new Error('boom');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannels('p-a'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(failure);
    expect(result.current.channels).toBeNull();
  });

  it('refresh keeps last-good channels when the retry also fails', async () => {
    const first = [makeChannel({ id: 'c-a' })];
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ channels: first })
      .mockRejectedValueOnce(new Error('flaky'));
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannels('p-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.channels).toEqual(first);

    await act(async () => {
      await result.current.refresh();
    });

    // last-good 유지, error는 새로 surfacing.
    expect(result.current.channels).toEqual(first);
    expect(result.current.error?.message).toBe('flaky');
  });

  it('projectId change triggers a fresh fetch for the new project', async () => {
    const invoke = vi.fn((_channel: string, data: unknown) => {
      const { projectId } = data as { projectId: string };
      return Promise.resolve({ channels: [makeChannel({ id: `c-${projectId}`, projectId })] });
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result, rerender } = renderHook(({ pid }: { pid: string | null }) => useChannels(pid), {
      initialProps: { pid: 'p-a' as string | null },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.channels?.[0]?.id).toBe('c-p-a');

    rerender({ pid: 'p-b' });
    await waitFor(() => expect(result.current.channels?.[0]?.id).toBe('c-p-b'));

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'channel:list');
    expect(listCalls.map((c) => (c[1] as { projectId: string }).projectId)).toEqual(['p-a', 'p-b']);
  });

  it('transitioning to projectId=null clears channels (no stale flash)', async () => {
    const invoke = vi.fn().mockResolvedValue({ channels: [makeChannel({ id: 'c-a' })] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result, rerender } = renderHook(({ pid }: { pid: string | null }) => useChannels(pid), {
      initialProps: { pid: 'p-a' as string | null },
    });

    await waitFor(() => expect(result.current.channels).not.toBeNull());

    rerender({ pid: null });
    await waitFor(() => expect(result.current.channels).toBeNull());
    expect(result.current.loading).toBe(false);
  });
});
