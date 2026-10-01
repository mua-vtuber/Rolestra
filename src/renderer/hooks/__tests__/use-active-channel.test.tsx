// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useActiveChannel } from '../use-active-channel';
import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../../stores/active-channel-store';
import type { Channel } from '../../../shared/channel-types';
import { chatChannelForTest } from '../../../test-utils/channel-fixture';

function makeChannel(id: string, projectId: string | null = 'p-a'): Channel {
  return chatChannelForTest({
    id,
    projectId,
    name: id,
    kind: 'user',
    readOnly: false,
    createdAt: 1_700_000_000_000,
  });
}

function resetStore(): void {
  useActiveChannelStore.setState({
    channelIdByProject: {},
    globalChannelId: null,
    selectedScope: 'project',
  });
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

  it('projectId=null selects and clears the global slot without touching project memory', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-project');
    const { result } = renderHook(() => useActiveChannel(null, [makeChannel('c-global', null)]));
    expect(result.current.activeChannelId).toBeNull();

    act(() => result.current.set('c-global'));
    expect(result.current.activeChannelId).toBe('c-global');
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({ 'p-a': 'c-project' });
    act(() => result.current.clear());
    expect(result.current.activeChannelId).toBeNull();
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({ 'p-a': 'c-project' });
  });

  it('retains global selection until its list loads, then clears a deleted DM', () => {
    useActiveChannelStore.setState({
      channelIdByProject: { 'p-a': 'c-project' },
      globalChannelId: 'dm-1',
      selectedScope: 'global',
    });
    const { result, rerender } = renderHook(
      ({ channels }: { channels: Channel[] | null }) => useActiveChannel(null, channels),
      { initialProps: { channels: null as Channel[] | null } },
    );
    expect(result.current.activeChannelId).toBe('dm-1');
    rerender({ channels: [makeChannel('dm-1', null)] });
    expect(result.current.activeChannelId).toBe('dm-1');
    rerender({ channels: [] });
    expect(result.current.activeChannelId).toBeNull();
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({ 'p-a': 'c-project' });
  });

  it('validates a second selection after an earlier missing channel was cleared', () => {
    const { result, rerender } = renderHook(
      ({ channels }: { channels: Channel[] }) => useActiveChannel('p-a', channels),
      { initialProps: { channels: [] as Channel[] } },
    );
    act(() => result.current.set('missing-first'));
    expect(result.current.activeChannelId).toBeNull();
    act(() => result.current.set('missing-second'));
    rerender({ channels: [] });
    expect(result.current.activeChannelId).toBeNull();
  });

  it('recovers a global ID saved in an old project slot after both lists load', () => {
    useActiveChannelStore.setState({ channelIdByProject: { 'p-a': 'dm-legacy' } });
    const dm = makeChannel('dm-legacy', null);
    const { rerender } = renderHook(
      ({ globalChannels }: { globalChannels: Channel[] | null }) =>
        useActiveChannel('p-a', [], globalChannels),
      { initialProps: { globalChannels: null as Channel[] | null } },
    );
    expect(useActiveChannelStore.getState().channelIdByProject['p-a']).toBe('dm-legacy');
    rerender({ globalChannels: [dm] });
    expect(useActiveChannelStore.getState().globalChannelId).toBe(dm.id);
    expect(useActiveChannelStore.getState().selectedScope).toBe('global');
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
