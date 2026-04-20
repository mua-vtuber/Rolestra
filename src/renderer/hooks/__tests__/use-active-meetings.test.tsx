// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveMeetings } from '../use-active-meetings';
import type { ActiveMeetingSummary } from '../../../shared/meeting-types';

const SAMPLE: ActiveMeetingSummary = {
  id: 'm1',
  projectId: 'p1',
  projectName: 'Alpha',
  channelId: 'c1',
  channelName: '회의',
  topic: 'Sprint review',
  stateIndex: 2,
  stateName: 'WORK_DISCUSSING',
  startedAt: 1700000000000,
  elapsedMs: 60_000,
};

describe('useActiveMeetings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('success path: issues one IPC call on mount and populates meetings', async () => {
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValue({ meetings: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useActiveMeetings());

    expect(result.current.loading).toBe(true);
    expect(result.current.meetings).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledTimes(1);
    expect(bridgeInvoke).toHaveBeenCalledWith('meeting:list-active', {});
    expect(result.current.meetings).toEqual([SAMPLE]);
    expect(result.current.error).toBeNull();
  });

  it('error path: populates error and leaves meetings null on initial failure', async () => {
    const failure = new Error('db exploded');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useActiveMeetings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.meetings).toBeNull();
  });

  it('forwards explicit limit to the IPC channel', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ meetings: [] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useActiveMeetings(5));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledWith('meeting:list-active', {
      limit: 5,
    });
  });
});
