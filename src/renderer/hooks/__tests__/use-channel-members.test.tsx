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
    // R12-C T2 신규 필드 — legacy user 채널은 모두 null/디폴트.
    role: null,
    purpose: null,
    handoffMode: 'check',
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

  it('channelId=null → members=null, loading=false, no IPC fetched', async () => {
    const invoke = vi.fn().mockResolvedValue({ members: [makeMember('alice')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMembers(null, null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.members).toBeNull();
    // R12-C dogfooding round 1: idle 분기는 IPC 호출 0 — 새 hook 은 직접
    // channel:list-members 를 부르므로 channelId null 이면 어떤 fetch 도
    // 발생 안 함.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('channels loading (null) → loading=true, members=null, fetch skipped', async () => {
    const invoke = vi.fn().mockResolvedValue({ members: [makeMember('alice')] });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const { result } = renderHook(() => useChannelMembers('c-a', null));

    expect(result.current.members).toBeNull();
    expect(result.current.loading).toBe(true);
    // channels list 가 loading 인 동안 channelMissing 검증을 못 하므로
    // fetch 자체를 skip — invoke 호출 0.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('happy path: fetches channel-scoped members via channel:list-members', async () => {
    const roster = [makeMember('alice'), makeMember('bob')];
    const invoke = vi.fn().mockImplementation(async (ch: string) => {
      if (ch === 'channel:list-members') return { members: roster };
      throw new Error(`unexpected ipc ${ch}`);
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const channels = [makeChannel('c-a')];
    const { result } = renderHook(() => useChannelMembers('c-a', channels));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toEqual(roster);
    expect(invoke).toHaveBeenCalledWith('channel:list-members', {
      channelId: 'c-a',
    });
  });

  it('DM 1:1 channel returns just the AI member (사용자 참여는 암묵적)', async () => {
    // R12-C dogfooding round 1: DM channel_members 에는 AI 1명만 (migration
    // 003-channels.ts:42 주석). new IPC 가 그대로 1명 반환 → UI 가 "참여자 1"
    // 로 정확히 표시. 이전 useMembers wrap 이 project-wide 3명을 잘못
    // 표시하던 회귀의 회피 검증.
    const roster = [makeMember('claude')];
    const invoke = vi.fn().mockImplementation(async (ch: string) => {
      if (ch === 'channel:list-members') return { members: roster };
      throw new Error(`unexpected ipc ${ch}`);
    });
    vi.stubGlobal('arena', { platform: 'linux', invoke });

    const dmChannel = { ...makeChannel('c-dm', null), kind: 'dm' as const };
    const { result } = renderHook(() =>
      useChannelMembers('c-dm', [dmChannel]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toHaveLength(1);
    expect(result.current.members?.[0]?.providerId).toBe('claude');
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
    // channelMissing 분기에서 IPC 호출 안 함.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('channel:list-members error propagates through', async () => {
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
