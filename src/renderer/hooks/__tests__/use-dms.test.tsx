// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDms } from '../use-dms';
import type { Channel } from '../../../shared/channel-types';

const DM: Channel = {
  id: 'dm-1',
  projectId: null,
  name: 'Alice',
  kind: 'dm',
  readOnly: false,
  createdAt: 1_700_000_000_000,
};

describe('useDms', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mount → invokes channel:list with projectId=null exactly once in strict mode', async () => {
    const invoke = vi.fn().mockResolvedValue({ channels: [DM] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDms(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const listCalls = invoke.mock.calls.filter((c) => c[0] === 'channel:list');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]?.[1]).toEqual({ projectId: null });
    expect(result.current.dms).toEqual([DM]);
  });

  it('initial failure keeps dms=null and surfaces error', async () => {
    const failure = new Error('nope');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDms());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(failure);
    expect(result.current.dms).toBeNull();
  });

  it('refresh retains the last-good list on subsequent failure', async () => {
    const first = [DM];
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ channels: first })
      .mockRejectedValueOnce(new Error('flake'));
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useDms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dms).toEqual(first);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.dms).toEqual(first);
    expect(result.current.error?.message).toBe('flake');
  });
});
