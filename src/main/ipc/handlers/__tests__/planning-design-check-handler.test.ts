import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningDesignCheckRecord } from '../../../../shared/planning-design-check-types';
import {
  handlePlanningDesignCheckDecide,
  setPlanningDesignCheckChannelServiceAccessor,
  setPlanningDesignCheckDispatchServiceAccessor,
  setPlanningDesignCheckMessageServiceAccessor,
  setPlanningDesignCheckMissionCardIdFactory,
  setPlanningDesignCheckServiceAccessor,
  setPlanningDesignCheckStreamBridgeAccessor,
} from '../planning-design-check-handler';

function makeCheck(
  overrides: Partial<PlanningDesignCheckRecord> = {},
): PlanningDesignCheckRecord {
  return {
    id: 'check-1',
    projectId: 'project-1',
    sourceDesignMeetingId: 'design-meeting-1',
    designChannelId: 'design-channel',
    designChannelRole: 'design.ui',
    planningChannelId: 'planning-channel',
    implementationChannelId: 'implement-channel',
    requestTitle: '디자인 검수 요청서',
    requestBody: '# 디자인 검수 요청서',
    finalDesignMinutesPath: '/tmp/final.md',
    finalDesignMinutesBody: '# final design',
    snapshotDesktopPath: null,
    snapshotMobilePath: null,
    wireframeCheckpointsJson: '[]',
    wireframeUserNotesJson: '[]',
    workBundleKey: 'planning-minutes:planning-meeting-1',
    originalPlanningMinutesId: 'planning-meeting-1',
    originalPlanningMinutesPath: '/tmp/planning.md',
    originalPlanningMinutesBody: '# original planning',
    originalPlanningMinutesMissingReason: null,
    returnCount: 1,
    verdict: 'misaligned',
    status: 'needs_user_decision',
    reason: '의도와 다름',
    revisionDirection: '업무 화면 밀도를 높이기',
    implementationDispatchId: null,
    designReturnDispatchId: null,
    userDecision: null,
    userDecisionNote: null,
    userDecisionDispatchId: null,
    payloadJson: JSON.stringify({
      designReceiver: {
        channelId: 'design-channel',
        handoffMode: 'auto',
        assignedProviderId: 'designer-1',
      },
      implementationReceiver: {
        channelId: 'implement-channel',
        handoffMode: 'auto',
        assignedProviderId: 'implementer-1',
      },
    }),
    createdAt: 1,
    decidedAt: null,
    ...overrides,
  };
}

describe('planning-design-check-handler', () => {
  const dispatchService = {
    dispatch: vi.fn((pkg) => ({
      id: `dispatch-${dispatchService.dispatch.mock.calls.length}`,
      fromMeetingId: pkg.sender.meetingId,
      fromChannelId: pkg.sender.channelId,
      toChannelId: pkg.target.channelId,
      reason: pkg.reason,
      minutesId: pkg.minutesMeetingId,
      missionCardJson: '{}',
      mode: pkg.mode,
      dispatchedAt: pkg.dispatchedAt,
      openedAt: null,
      createdAt: pkg.dispatchedAt,
    })),
  };
  const streamBridge = { emitHandoffDispatched: vi.fn() };
  const messageService = { append: vi.fn((input) => input) };
  const channelService = {
    listByProject: vi.fn(() => [{ id: 'minutes-channel', kind: 'system_minutes' }]),
  };
  const checkService = {
    get: vi.fn(() => makeCheck()),
    withTransaction: vi.fn(<T>(fn: () => T): T => fn()),
    recordUserDecision: vi.fn((input) =>
      makeCheck({
        userDecision: input.decision,
        userDecisionNote: input.userNote ?? null,
        userDecisionDispatchId: input.dispatchId ?? null,
        decidedAt: 2,
      }),
    ),
    setImplementationDispatchId: vi.fn(),
    setDesignReturnDispatchId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setPlanningDesignCheckServiceAccessor(() => checkService as never);
    setPlanningDesignCheckDispatchServiceAccessor(() => dispatchService as never);
    setPlanningDesignCheckStreamBridgeAccessor(() => streamBridge as never);
    setPlanningDesignCheckMessageServiceAccessor(() => messageService as never);
    setPlanningDesignCheckChannelServiceAccessor(() => channelService as never);
    setPlanningDesignCheckMissionCardIdFactory(
      () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('사용자 판단: 구현으로 보내기를 기록하고 구현 의뢰서를 발행한다', () => {
    const result = handlePlanningDesignCheckDecide({
      checkId: 'check-1',
      decision: 'send_to_implementation',
      userNote: '',
    });

    expect(result.check.userDecision).toBe('send_to_implementation');
    expect(dispatchService.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatchService.dispatch.mock.calls[0]![0].target.channelRole).toBe(
      'implement',
    );
    expect(checkService.setImplementationDispatchId).toHaveBeenCalled();
    expect(messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '사용자 판단에 따라 구현으로 보냈습니다.',
      }),
    );
  });

  it('사용자 판단: 디자인 수정 요청을 기록하고 디자인 의뢰서를 발행한다', () => {
    const result = handlePlanningDesignCheckDecide({
      checkId: 'check-1',
      decision: 'request_design_revision',
      userNote: '정보 밀도를 더 높여줘.',
    });

    expect(result.check.userDecision).toBe('request_design_revision');
    expect(result.check.userDecisionNote).toBe('정보 밀도를 더 높여줘.');
    expect(dispatchService.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatchService.dispatch.mock.calls[0]![0].target.channelRole).toBe(
      'design.ui',
    );
    expect(checkService.setDesignReturnDispatchId).toHaveBeenCalled();
  });

  it('사용자 판단: 진행 중지는 dispatch 없이 기록만 남긴다', () => {
    const result = handlePlanningDesignCheckDecide({
      checkId: 'check-1',
      decision: 'stop',
      userNote: '',
    });

    expect(result.check.userDecision).toBe('stop');
    expect(result.dispatchRowId).toBeNull();
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '사용자 판단에 따라 진행을 중지했습니다.',
      }),
    );
  });
});
