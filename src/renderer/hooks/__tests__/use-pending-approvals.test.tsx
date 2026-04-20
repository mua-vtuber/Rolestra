// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingApprovals } from '../use-pending-approvals';
import type { ApprovalItem } from '../../../shared/approval-types';

const SAMPLE: ApprovalItem = {
  id: 'a1',
  kind: 'cli_permission',
  projectId: null,
  channelId: null,
  meetingId: null,
  requesterId: null,
  payload: { command: 'ls' },
  status: 'pending',
  decisionComment: null,
  createdAt: 1700000000000,
  decidedAt: null,
};

describe('usePendingApprovals', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('success path: calls approval:list with status=pending and populates items', async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ items: [SAMPLE] });
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => usePendingApprovals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(bridgeInvoke).toHaveBeenCalledWith('approval:list', {
      status: 'pending',
    });
    expect(result.current.items).toEqual([SAMPLE]);
  });

  it('error path: surfaces the error and keeps items null', async () => {
    const failure = new Error('db down');
    const bridgeInvoke = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('arena', { platform: 'linux', invoke: bridgeInvoke });

    const { result } = renderHook(() => usePendingApprovals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.items).toBeNull();
  });
});
