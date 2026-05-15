import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  handleMeetingReviewDecide,
  handleMeetingReviewGet,
  setMeetingReviewChannelServiceAccessor,
  setMeetingReviewDispatchServiceAccessor,
  setMeetingReviewGateServiceAccessor,
  setMeetingReviewMessageServiceAccessor,
  setMeetingReviewStreamBridgeAccessor,
} from '../meeting-review-handler';
import type { MeetingReviewGate } from '../../../../shared/meeting-review-types';
import { buildMissionCard } from '../../../../shared/schema/mission-card';
import { buildHandoffPackage } from '../../../../shared/schema/handoff-package';
import { MeetingReviewGateRepository } from '../../../meeting-review/meeting-review-gate-repository';
import { MeetingReviewGateService } from '../../../meeting-review/meeting-review-gate-service';

const pendingReview: MeetingReviewGate = {
  id: 'review-1',
  projectId: 'project-1',
  meetingId: 'meeting-1',
  sourceChannelId: 'planning-channel',
  targetChannelId: 'design-channel',
  targetRole: 'design.ux',
  kind: 'planning_minutes',
  status: 'pending',
  title: '기획 회의록',
  documentPath: '/arena/consensus/meetings/meeting-1/minutes.md',
  documentBodySnapshot: '# 기획 회의록\n본문',
  userNote: null,
  payloadJson: null,
  createdAt: 1_700_000_000_000,
  decidedAt: null,
};

function makePackagePayload(): string {
  const missionCard = buildMissionCard({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: {
      kind: 'change-request',
      body: '기획 회의록 기반 디자인',
      inputFiles: [],
      expectedOutputs: ['디자인 산출물'],
      userMessage: '디자인 회의를 시작하세요.',
    },
    assignedProviderId: 'designer-1',
    targetChannelId: 'design-channel',
    createdAt: 1_700_000_000_000,
  });
  const pkg = buildHandoffPackage({
    sender: {
      meetingId: 'meeting-1',
      channelId: 'planning-channel',
      channelRole: 'planning',
    },
    target: {
      channelId: 'design-channel',
      channelRole: 'design.ux',
    },
    reason: '기획 승인',
    minutesMeetingId: 'meeting-1',
    nextActions: [],
    missionCard,
    mode: 'auto',
    dispatchedAt: 1_700_000_000_000,
  });
  return JSON.stringify({ handoffPackage: pkg });
}

describe('meeting-review-handler', () => {
  const reviewService = {
    get: vi.fn(),
    list: vi.fn(() => []),
    decide: vi.fn(),
    withTransaction: vi.fn(<T>(fn: () => T): T => fn()),
  };
  const dispatchService = {
    dispatch: vi.fn(() => ({
      id: 'dispatch-1',
      fromMeetingId: 'meeting-1',
      fromChannelId: 'planning-channel',
      toChannelId: 'design-channel',
      reason: '기획 승인',
      minutesId: 'meeting-1',
      missionCardJson: '{}',
      mode: 'auto' as const,
      dispatchedAt: 1_700_000_000_001,
      openedAt: null,
      createdAt: 1_700_000_000_001,
    })),
  };
  const streamBridge = {
    emitHandoffDispatched: vi.fn(),
  };
  const messageService = {
    append: vi.fn((input) => ({
      id: 'message-1',
      ...input,
      createdAt: 1,
    })),
  };
  const channelService = {
    listByProject: vi.fn(() => [
      {
        id: 'minutes-channel',
        kind: 'system_minutes',
      },
    ]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setMeetingReviewGateServiceAccessor(() => reviewService as never);
    setMeetingReviewDispatchServiceAccessor(() => dispatchService as never);
    setMeetingReviewStreamBridgeAccessor(() => streamBridge as never);
    setMeetingReviewMessageServiceAccessor(() => messageService as never);
    setMeetingReviewChannelServiceAccessor(() => channelService as never);
  });

  it('meeting-review:get returns the stored body and status', () => {
    reviewService.get.mockReturnValueOnce({
      ...pendingReview,
      payloadJson: makePackagePayload(),
    });

    const result = handleMeetingReviewGet({ reviewId: 'review-1' });

    expect(result.item.status).toBe('pending');
    expect(result.item.documentBodySnapshot).toContain('기획 회의록');
  });

  it('approval stores approved status and dispatches to design', () => {
    const approved = {
      ...pendingReview,
      status: 'approved' as const,
      userNote: '디자인은 단순하게',
      decidedAt: 1_700_000_000_050,
      payloadJson: makePackagePayload(),
    };
    reviewService.get.mockReturnValueOnce({
      ...pendingReview,
      payloadJson: makePackagePayload(),
    });
    reviewService.decide.mockReturnValueOnce(approved);

    const result = handleMeetingReviewDecide({
      reviewId: 'review-1',
      decision: 'approve',
      userNote: '디자인은 단순하게',
    });

    expect(dispatchService.dispatch).toHaveBeenCalledTimes(1);
    expect(reviewService.decide).toHaveBeenCalledWith({
      id: 'review-1',
      status: 'approved',
      userNote: '디자인은 단순하게',
    });
    expect(streamBridge.emitHandoffDispatched).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'meeting-1',
        dispatchRowId: 'dispatch-1',
        targetChannelId: 'design-channel',
      }),
    );
    expect(result.review.status).toBe('approved');
    expect(result.dispatchRowId).toBe('dispatch-1');
  });

  it('does not dispatch when approval is requested for an already decided review', () => {
    reviewService.get.mockReturnValueOnce({
      ...pendingReview,
      status: 'approved',
      decidedAt: 1_700_000_000_050,
      payloadJson: makePackagePayload(),
    });

    expect(() =>
      handleMeetingReviewDecide({
        reviewId: 'review-1',
        decision: 'approve',
        userNote: '다시 승인',
      }),
    ).toThrow(/not pending/);

    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(streamBridge.emitHandoffDispatched).not.toHaveBeenCalled();
    expect(reviewService.decide).not.toHaveBeenCalled();
  });

  it('keeps a pending review retryable when approval dispatch fails', () => {
    const db = new Database(':memory:');
    db.exec(`
CREATE TABLE meeting_review_gate (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  target_channel_id TEXT,
  target_role TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  document_path TEXT NOT NULL,
  document_body_snapshot TEXT NOT NULL,
  user_note TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
`);
    const repo = new MeetingReviewGateRepository(db);
    const realReviewService = new MeetingReviewGateService(
      repo,
      () => 1_700_000_000_100,
    );
    repo.insert({
      ...pendingReview,
      payloadJson: makePackagePayload(),
    });
    dispatchService.dispatch.mockImplementationOnce(() => {
      throw new Error('dispatch insert failed');
    });
    setMeetingReviewGateServiceAccessor(() => realReviewService);

    try {
      expect(() =>
        handleMeetingReviewDecide({
          reviewId: 'review-1',
          decision: 'approve',
          userNote: '다시 시도 가능해야 함',
        }),
      ).toThrow(/dispatch insert failed/);

      expect(dispatchService.dispatch).toHaveBeenCalledTimes(1);
      expect(repo.findById('review-1')).toEqual(
        expect.objectContaining({
          status: 'pending',
          userNote: null,
          decidedAt: null,
        }),
      );
      expect(messageService.append).not.toHaveBeenCalled();
      expect(streamBridge.emitHandoffDispatched).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('revision request stores rejection record without dispatching', () => {
    const revised = {
      ...pendingReview,
      status: 'revision_requested' as const,
      userNote: '범위를 더 줄여주세요.',
      decidedAt: 1_700_000_000_050,
      payloadJson: makePackagePayload(),
    };
    reviewService.get.mockReturnValueOnce({
      ...pendingReview,
      payloadJson: makePackagePayload(),
    });
    reviewService.decide.mockReturnValueOnce(revised);

    const result = handleMeetingReviewDecide({
      reviewId: 'review-1',
      decision: 'revise',
      userNote: '범위를 더 줄여주세요.',
    });

    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(result.review.status).toBe('revision_requested');
    expect(result.followUpRequired).toBe(true);
    expect(messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'planning-channel',
        content:
          '기획 회의록에 수정 지시가 저장되었습니다. 이 회의록은 반려 기록으로 보관됩니다.',
      }),
    );
    expect(messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'minutes-channel',
        content: expect.stringContaining('결정: 수정 지시'),
      }),
    );
  });

  it('stop stores stopped status and does not dispatch', () => {
    const stopped = {
      ...pendingReview,
      status: 'stopped' as const,
      userNote: '여기서 멈춤',
      decidedAt: 1_700_000_000_050,
      payloadJson: makePackagePayload(),
    };
    reviewService.get.mockReturnValueOnce({
      ...pendingReview,
      payloadJson: makePackagePayload(),
    });
    reviewService.decide.mockReturnValueOnce(stopped);

    const result = handleMeetingReviewDecide({
      reviewId: 'review-1',
      decision: 'stop',
      userNote: '여기서 멈춤',
    });

    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(reviewService.decide).toHaveBeenCalledWith({
      id: 'review-1',
      status: 'stopped',
      userNote: '여기서 멈춤',
    });
    expect(result.review.status).toBe('stopped');
    expect(result.dispatchRowId).toBeNull();
  });
});
