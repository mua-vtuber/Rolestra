/**
 * R11-Task7: approval-handler unit tests for the detail-fetch composer.
 *
 * R12-C2 T10b: voting-history slice 제거됨 — consensusContext 는 항상 null.
 *
 * Coverage:
 *   1. detail-fetch happy path — combines approval row + dryRunPreview.
 *   2. dryRunPreview accessor missing → empty preview, approval still
 *      returned (defensive).
 *   3. dryRunPreview throws → swallowed, empty preview slice (panel
 *      should still render).
 *   4. throws when approval not found.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleApprovalCount,
  handleApprovalDetailFetch,
  setApprovalServiceAccessor,
  setApprovalDetailExecutionAccessor,
  setApprovalDetailMeetingAccessor,
} from '../approval-handler';
import type { ApprovalItem } from '../../../../shared/approval-types';

interface ApprovalServiceMock {
  get: ReturnType<typeof vi.fn>;
}

interface ExecutionServiceMock {
  dryRunPreview: ReturnType<typeof vi.fn>;
}

function buildApproval(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
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
    ...overrides,
  };
}

afterEach(() => {
  setApprovalServiceAccessor(null as never);
  setApprovalDetailExecutionAccessor(null as never);
  setApprovalDetailMeetingAccessor(null as never);
});

describe('handleApprovalDetailFetch (R11-Task7 → R12-C2 T10b)', () => {
  let approvalSvc: ApprovalServiceMock;
  let executionSvc: ExecutionServiceMock;

  beforeEach(() => {
    approvalSvc = { get: vi.fn() };
    executionSvc = { dryRunPreview: vi.fn() };
    setApprovalServiceAccessor(() => approvalSvc as never);
    setApprovalDetailExecutionAccessor(() => executionSvc as never);
  });

  it('happy path: combines approval + preview (consensusContext always null after T10b)', async () => {
    const approval = buildApproval({ meetingId: 'mtg-1' });
    approvalSvc.get.mockReturnValue(approval);
    executionSvc.dryRunPreview.mockResolvedValue({
      impactedFiles: [
        { path: '/tmp/x', addedLines: 0, removedLines: 0, changeKind: 'modified' },
      ],
      diffPreviews: [
        { path: '/tmp/x', preview: 'edit', truncated: false },
      ],
    });

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.approval).toBe(approval);
    expect(result.detail.impactedFiles).toHaveLength(1);
    expect(result.detail.diffPreviews).toHaveLength(1);
    expect(result.detail.consensusContext).toBeNull();
  });

  it('execution accessor unset → empty preview slice; approval still served', async () => {
    setApprovalDetailExecutionAccessor(null as never);
    approvalSvc.get.mockReturnValue(buildApproval());

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.impactedFiles).toEqual([]);
    expect(result.detail.diffPreviews).toEqual([]);
    expect(result.detail.consensusContext).toBeNull();
  });

  it('dryRunPreview throws → swallowed, panel still renders', async () => {
    approvalSvc.get.mockReturnValue(buildApproval());
    executionSvc.dryRunPreview.mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.impactedFiles).toEqual([]);
    expect(result.detail.diffPreviews).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('approval not found → throws', async () => {
    approvalSvc.get.mockReturnValue(null);

    await expect(
      handleApprovalDetailFetch({ approvalId: 'missing' }),
    ).rejects.toThrow('approval not found: missing');
  });

  it('approval service accessor not initialized → throws', async () => {
    setApprovalServiceAccessor(null as never);

    await expect(
      handleApprovalDetailFetch({ approvalId: 'app-1' }),
    ).rejects.toThrow('service not initialized');
  });
});

describe('handleApprovalCount (F6-T1)', () => {
  let approvalSvc: { count: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    approvalSvc = { count: vi.fn() };
    setApprovalServiceAccessor(() => approvalSvc as never);
  });

  it('returns three buckets plus their union as `all`', () => {
    approvalSvc.count.mockImplementation(
      (filter: { status?: string; projectId?: string }) => {
        if (filter.status === 'pending') return 4;
        if (filter.status === 'approved') return 2;
        if (filter.status === 'rejected') return 1;
        return 0;
      },
    );

    const out = handleApprovalCount({ projectId: 'proj-1' });

    expect(out).toEqual({ pending: 4, approved: 2, rejected: 1, all: 7 });
    expect(approvalSvc.count).toHaveBeenCalledWith({
      status: 'pending',
      projectId: 'proj-1',
    });
    expect(approvalSvc.count).toHaveBeenCalledWith({
      status: 'approved',
      projectId: 'proj-1',
    });
    expect(approvalSvc.count).toHaveBeenCalledWith({
      status: 'rejected',
      projectId: 'proj-1',
    });
  });

  it('omits projectId when the request has no scope (cross-project totals)', () => {
    approvalSvc.count.mockReturnValue(0);

    handleApprovalCount(undefined);

    expect(approvalSvc.count).toHaveBeenCalledWith({
      status: 'pending',
      projectId: undefined,
    });
  });
});
