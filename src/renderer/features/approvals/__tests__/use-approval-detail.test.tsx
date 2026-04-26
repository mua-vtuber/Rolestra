// @vitest-environment jsdom

import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useApprovalDetail } from '../use-approval-detail';
import type { ApprovalDetail } from '../../../../shared/approval-detail-types';
import type { ApprovalItem } from '../../../../shared/approval-types';

const SAMPLE_APPROVAL: ApprovalItem = {
  id: 'app-1',
  kind: 'cli_permission',
  projectId: 'proj-1',
  channelId: null,
  meetingId: null,
  requesterId: null,
  payload: null,
  status: 'pending',
  decisionComment: null,
  createdAt: 0,
  decidedAt: null,
};

const SAMPLE_DETAIL: ApprovalDetail = {
  approval: SAMPLE_APPROVAL,
  impactedFiles: [
    { path: '/tmp/x', addedLines: 0, removedLines: 0, changeKind: 'modified' },
  ],
  diffPreviews: [
    { path: '/tmp/x', preview: 'sample', truncated: false },
  ],
  consensusContext: null,
};

function installArena(invokeImpl: (channel: string, data: unknown) => unknown): {
  invoke: ReturnType<typeof vi.fn>;
} {
  const invokeFn = vi.fn(invokeImpl);
  vi.stubGlobal('arena', { platform: 'linux', invoke: invokeFn });
  return { invoke: invokeFn };
}

describe('useApprovalDetail (R11-Task7)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('approvalId=null → no IPC, parked state', async () => {
    const { invoke } = installArena(() => {
      throw new Error('should not be called');
    });
    const { result } = renderHook(() => useApprovalDetail(null));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('approvalId set → fetches detail and stores it', async () => {
    const { invoke } = installArena((channel, data) => {
      expect(channel).toBe('approval:detail-fetch');
      expect(data).toEqual({ approvalId: 'app-1' });
      return Promise.resolve({ detail: SAMPLE_DETAIL });
    });
    const { result } = renderHook(() => useApprovalDetail('app-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.detail).toEqual(SAMPLE_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it('IPC failure → error set, detail stays null', async () => {
    installArena(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useApprovalDetail('app-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.detail).toBeNull();
  });

  it('approvalId change → refetches with the new id', async () => {
    const { invoke } = installArena((_, data) =>
      Promise.resolve({
        detail: { ...SAMPLE_DETAIL, approval: { ...SAMPLE_APPROVAL, id: (data as { approvalId: string }).approvalId } },
      }),
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useApprovalDetail(id),
      { initialProps: { id: 'app-1' as string | null } },
    );
    await waitFor(() => {
      expect(result.current.detail?.approval.id).toBe('app-1');
    });
    rerender({ id: 'app-2' });
    await waitFor(() => {
      expect(result.current.detail?.approval.id).toBe('app-2');
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refetch() triggers another invoke without changing id', async () => {
    const { invoke } = installArena(() =>
      Promise.resolve({ detail: SAMPLE_DETAIL }),
    );
    const { result } = renderHook(() => useApprovalDetail('app-1'));
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull();
    });
    await act(async () => {
      await result.current.refetch();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('switch to null clears state synchronously without IPC', async () => {
    const { invoke } = installArena(() =>
      Promise.resolve({ detail: SAMPLE_DETAIL }),
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useApprovalDetail(id),
      { initialProps: { id: 'app-1' as string | null } },
    );
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ id: null });
    await waitFor(() => {
      expect(result.current.detail).toBeNull();
    });
    expect(invoke).toHaveBeenCalledTimes(1); // null branch did NOT IPC
    expect(result.current.loading).toBe(false);
  });
});
