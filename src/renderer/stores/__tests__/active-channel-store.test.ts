// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_CHANNEL_STORAGE_KEY,
  useActiveChannelStore,
} from '../active-channel-store';

function resetStore(): void {
  useActiveChannelStore.setState({ channelIdByProject: {} });
  localStorage.removeItem(ACTIVE_CHANNEL_STORAGE_KEY);
}

describe('active-channel-store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('persist key is literally "rolestra.activeChannel.v1"', () => {
    expect(ACTIVE_CHANNEL_STORAGE_KEY).toBe('rolestra.activeChannel.v1');
  });

  it('initial state has empty channelIdByProject', () => {
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({});
  });

  it('setActiveChannelId records channelId under the given project', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-1');
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-a': 'c-1',
    });
  });

  it('setActiveChannelId with null removes that project’s entry', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-1');
    useActiveChannelStore.getState().setActiveChannelId('p-b', 'c-9');

    useActiveChannelStore.getState().setActiveChannelId('p-a', null);
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-b': 'c-9',
    });
  });

  it('overwrites an existing entry for the same project', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-1');
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-2');
    expect(useActiveChannelStore.getState().channelIdByProject['p-a']).toBe('c-2');
  });

  it('clearProject removes only the targeted project', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-1');
    useActiveChannelStore.getState().setActiveChannelId('p-b', 'c-9');

    useActiveChannelStore.getState().clearProject('p-a');
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-b': 'c-9',
    });
  });

  it('clearProject is a no-op when the project is not stored', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-a', 'c-1');
    useActiveChannelStore.getState().clearProject('p-unknown');
    expect(useActiveChannelStore.getState().channelIdByProject).toEqual({
      'p-a': 'c-1',
    });
  });

  it('persists channelIdByProject to localStorage under the literal key', () => {
    useActiveChannelStore.getState().setActiveChannelId('p-persist', 'c-zz');

    const raw = localStorage.getItem('rolestra.activeChannel.v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}') as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({
      channelIdByProject: { 'p-persist': 'c-zz' },
    });
  });
});
