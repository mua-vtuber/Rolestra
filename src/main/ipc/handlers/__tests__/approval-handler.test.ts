/**
 * R11-Task7: approval-handler unit tests for the detail-fetch composer.
 *
 * Coverage:
 *   1. detail-fetch happy path — combines approval row + dryRunPreview +
 *      voting context into a single response.
 *   2. dryRunPreview accessor missing → empty preview, approval still
 *      returned (defensive).
 *   3. dryRunPreview throws → swallowed, empty preview slice (panel
 *      should still render).
 *   4. meeting accessor returns null → consensusContext === null only when
 *      approval.meetingId === null. Missing meeting row with non-null
 *      meetingId → empty context (renders zero-state header).
 *   5. throws when approval not found.
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
import type { Meeting } from '../../../../shared/meeting-types';

interface ApprovalServiceMock {
  get: ReturnType<typeof vi.fn>;
}

interface ExecutionServiceMock {
  dryRunPreview: ReturnType<typeof vi.fn>;
}

interface MeetingServiceMock {
  get: ReturnType<typeof vi.fn>;
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

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-1',
    channelId: 'ch-1',
    topic: 't',
    state: 'CONVERSATION',
    stateSnapshotJson: null,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

afterEach(() => {
  setApprovalServiceAccessor(null as never);
  setApprovalDetailExecutionAccessor(null as never);
  setApprovalDetailMeetingAccessor(null as never);
});

describe('handleApprovalDetailFetch (R11-Task7)', () => {
  let approvalSvc: ApprovalServiceMock;
  let executionSvc: ExecutionServiceMock;
  let meetingSvc: MeetingServiceMock;

  beforeEach(() => {
    approvalSvc = { get: vi.fn() };
    executionSvc = { dryRunPreview: vi.fn() };
    meetingSvc = { get: vi.fn() };
    setApprovalServiceAccessor(() => approvalSvc as never);
    setApprovalDetailExecutionAccessor(() => executionSvc as never);
    setApprovalDetailMeetingAccessor(() => meetingSvc as never);
  });

  it('happy path: combines approval + preview + voting context', async () => {
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
    meetingSvc.get.mockReturnValue(
      buildMeeting({
        id: 'mtg-1',
        stateSnapshotJson: JSON.stringify({
          votes: [{ participantId: 'p-a', vote: 'agree' }],
        }),
      }),
    );

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.approval).toBe(approval);
    expect(result.detail.impactedFiles).toHaveLength(1);
    expect(result.detail.diffPreviews).toHaveLength(1);
    expect(result.detail.consensusContext).toEqual({
      meetingId: 'mtg-1',
      participantVotes: [{ providerId: 'p-a', vote: 'approve' }],
    });
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

  it('approval has no meetingId → consensusContext stays null', async () => {
    approvalSvc.get.mockReturnValue(buildApproval({ meetingId: null }));
    executionSvc.dryRunPreview.mockResolvedValue({
      impactedFiles: [],
      diffPreviews: [],
    });

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.consensusContext).toBeNull();
    expect(meetingSvc.get).not.toHaveBeenCalled();
  });

  it('meeting lookup miss → empty context with the requested meetingId', async () => {
    approvalSvc.get.mockReturnValue(buildApproval({ meetingId: 'mtg-x' }));
    executionSvc.dryRunPreview.mockResolvedValue({
      impactedFiles: [],
      diffPreviews: [],
    });
    meetingSvc.get.mockReturnValue(null);

    const result = await handleApprovalDetailFetch({ approvalId: 'app-1' });
    expect(result.detail.consensusContext).toEqual({
      meetingId: 'mtg-x',
      participantVotes: [],
    });
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
