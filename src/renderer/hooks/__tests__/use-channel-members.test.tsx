// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelNotFoundError, useChannelMembers } from '../use-channel-members';
import type { Channel } from '../../../shared/channel-types';
import type { MemberView } from '../../../shared/member-profile-types';

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

function makeMember(id: string): MemberView {
  return {
    providerId: id,
    role: 'dev',
    personality: 'steady',
    expertise: 'general',
    avatarKind: 'default',
    avatarData: null,
    statusOverride: null,
    updatedAt: 1_700_000_000_000,
    displayName: id.toUpperCase(),
    persona: id,
    workStatus: 'online',
  };
}

describe('useChannelMembers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('channelId=null → members=null, loading=false (roster prefetch is fine, filter output is null)', async () => {
    // useMembers() underneath is unconditional on mount — that IPC is
    // shared-batch and cheap, so we don't assert zero-calls. What this
    // hook must guarantee is that its *filter output* is null + not
    // loading when there's no channel to scope to.
    const invoke = vi.fn().mockResolvedValue({ members: [makeMember('alice')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMembers(null, null));

    // Give useMembers time to settle so the assertion is about the
    // steady-state filter output, not a transient loading=true tick.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.members).toBeNull();
  });

  it('channels loading (null) → loading=true, members=null', async () => {
    const invoke = vi.fn().mockResolvedValue({ members: [makeMember('alice')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMembers('c-a', null));

    expect(result.current.members).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('happy path: returns roster filtered down to the channel’s project', async () => {
    const roster = [makeMember('alice'), makeMember('bob')];
    const invoke = vi.fn().mockResolvedValue({ members: roster });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const channels = [makeChannel('c-a')];
    const { result } = renderHook(() => useChannelMembers('c-a', channels));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toEqual(roster);
    expect(invoke).toHaveBeenCalledWith('member:list', undefined);
  });

  it('channelId that does not match any channel surfaces ChannelNotFoundError', async () => {
    const invoke = vi.fn().mockResolvedValue({ members: [makeMember('alice')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useChannelMembers('c-ghost', [makeChannel('c-real')]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toBeNull();
    expect(result.current.error).toBeInstanceOf(ChannelNotFoundError);
    expect((result.current.error as ChannelNotFoundError).channelId).toBe('c-ghost');
  });

  it('member:list error propagates through', async () => {
    const failure = new Error('roster down');
    const invoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() =>
      useChannelMembers('c-a', [makeChannel('c-a')]),
    );

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.members).toBeNull();
  });
});
