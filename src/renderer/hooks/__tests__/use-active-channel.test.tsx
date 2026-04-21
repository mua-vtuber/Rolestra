// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useActiveChannel } from '../use-active-channel';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../stores/active-channel-store';
import type { Channel } from '../../../shared/channel-types';

function makeChannel(id: string, projectId: string | null = 'p-a'): Channel {
  return {
    id,
    projectId,
    name: id,
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
  };
}

function resetStore(): void {
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
}

describe('useActiveChannel', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('projectId=null → activeChannelId=null and set/clear are no-ops', () => {
    const { result } = renderHook(() => useActiveChannel(null, []));
    expect(result.current.activeChannelId).toBeNull();

    act(() => result.current.set('c-1'));
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({});
  });

  it('set(channelId) records per-project memory; switching project restores independently', () => {
    const channelsA: Channel[] = [makeChannel('c-1'), makeChannel('c-2')];

    const { result, rerender } = renderHook(
      ({ pid, ch }: { pid: string | null; ch: Channel[] | null }) => useActiveChannel(pid, ch),
      { initialProps: { pid: 'p-a' as string | null, ch: channelsA as Channel[] | null } },
    );

    act(() => result.current.set('c-1'));
    expect(result.current.activeChannelId).toBe('c-1');

    // 다른 프로젝트로 전환 → 기억 없으므로 null
    const channelsB: Channel[] = [makeChannel('c-9', 'p-b')];
    rerender({ pid: 'p-b', ch: channelsB });
    expect(result.current.activeChannelId).toBeNull();

    act(() => result.current.set('c-9'));
    expect(result.current.activeChannelId).toBe('c-9');

    // 다시 p-a로 복귀 → 기억된 c-1로 복원.
    rerender({ pid: 'p-a', ch: channelsA });
    expect(result.current.activeChannelId).toBe('c-1');
  });

  it('clears stored channel when it is not present in the current channels list', () => {
    useActiveChannelStore.setState({ channelIdByProject: { 'p-a': 'c-deleted' } });

    const { result } = renderHook(() =>
      useActiveChannel('p-a', [makeChannel('c-1'), makeChannel('c-2')]),
    );

    // validation effect → auto clear
    expect(result.current.activeChannelId).toBeNull();
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({});
  });

  it('does not clear while channels is loading (null)', () => {
    useActiveChannelStore.setState({ channelIdByProject: { 'p-a': 'c-1' } });

    const { result } = renderHook(() => useActiveChannel('p-a', null));
    expect(result.current.activeChannelId).toBe('c-1');
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-a': 'c-1',
    });
  });

  it('clear() removes the current project’s entry only', () => {
    useActiveChannelStore.setState({
      channelIdByProject: { 'p-a': 'c-1', 'p-b': 'c-9' },
    });

    const { result } = renderHook(() =>
      useActiveChannel('p-a', [makeChannel('c-1')]),
    );
    expect(result.current.activeChannelId).toBe('c-1');

    act(() => result.current.clear());
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-b': 'c-9',
    });
  });
});
