// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMembers } from '../use-members';
import type { MemberView } from '../../../shared/member-profile-types';

const SAMPLE: MemberView = {
  providerId: 'p-1',
  role: 'dev',
  personality: '',
  expertise: '',
  avatarKind: 'default',
  avatarData: 'blue-dev',
  statusOverride: null,
  updatedAt: 1700000000000,
  displayName: 'Alpha',
  persona: '',
  workStatus: 'online',
};

describe('useMembers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('success path: populates members from member:list', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ members: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useMembers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledWith('member:list', undefined);
    expect(result.current.members).toEqual([SAMPLE]);
  });

  it('error path: surfaces the error and keeps members null', async () => {
    const failure = new Error('network');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => useMembers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.members).toBeNull();
  });
});
