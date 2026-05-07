/**
 * handoff-handler 단위 테스트 — R12-C2 P6 T28 land.
 *
 * 검증:
 *   - approve: pending take + dispatch + emit. take 결과 null 시 throw.
 *   - cancel:  pending take 후 dispatch X + emit (reason='user_canceled').
 *              take 결과 null 도 silent OK (멱등).
 *   - spawnReview 필드는 payload 보존만 (T28 시점) — dispatch 자체엔 영향 X.
 *   - emit throw 시 caller 에 전파 X (warn 만).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleHandoffApprove,
  handleHandoffCancel,
  setHandoffDispatchServiceAccessor,
  setHandoffPendingStateAccessor,
  setHandoffStreamBridgeAccessor,
} from '../handoff-handler';
import {
  HandoffPendingState,
} from '../../../handoff/handoff-pending-state';
import type { HandoffPackage } from '../../../../shared/schema/handoff-package';
import {
  buildMissionCard,
  type FixMissionPayload,
} from '../../../../shared/schema/mission-card';

const FIXED_NOW = 1_700_000_000_000;
const MISSION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function buildPkg(): HandoffPackage {
  const fixPayload: FixMissionPayload = {
    kind: 'fix',
    body: '검토 NG — 1 건',
    inputFiles: [],
    expectedOutputs: ['처리 작업 분배'],
    auditMinutesMarkdown: '## [합의]\n- 문제 1 건\n## [제외]\n(없음)\n',
    problemList: [
      { opinionId: 'op-A', title: '하드코딩', content: 'src/foo.ts:42' },
    ],
  };
  const missionCard = buildMissionCard({
    id: MISSION_UUID,
    payload: fixPayload,
    assignedProviderId: 'codex',
    targetChannelId: 'planning-channel-1',
    createdAt: FIXED_NOW,
  });
  return {
    sender: {
      meetingId: 'audit-meeting-1',
      channelId: 'audit-channel-1',
      channelRole: 'audit',
    },
    target: {
      channelId: 'planning-channel-1',
      channelRole: 'planning',
    },
    reason: '검토 NG 판정 — 1 건',
    minutesMeetingId: 'audit-meeting-1',
    nextActions: [],
    missionCard,
    mode: 'check',
    dispatchedAt: FIXED_NOW,
  };
}

describe('handoff-handler', () => {
  let pending: HandoffPendingState;
  let dispatch: { dispatch: ReturnType<typeof vi.fn> };
  let stream: {
    emitHandoffDispatched: ReturnType<typeof vi.fn>;
    emitHandoffRejected: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    pending = new HandoffPendingState();
    dispatch = {
      dispatch: vi.fn((pkg: HandoffPackage) => ({
        id: 'dispatch-row-1',
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
    stream = {
      emitHandoffDispatched: vi.fn(),
      emitHandoffRejected: vi.fn(),
    };
    setHandoffPendingStateAccessor(() => pending);
    setHandoffDispatchServiceAccessor(
      () => dispatch as unknown as Parameters<typeof setHandoffDispatchServiceAccessor>[0] extends () => infer T ? T : never,
    );
    setHandoffStreamBridgeAccessor(
      () => stream as unknown as Parameters<typeof setHandoffStreamBridgeAccessor>[0] extends () => infer T ? T : never,
    );
  });

  it('approve — pending take + dispatch + emit', () => {
    const pkg = buildPkg();
    pending.put('audit-meeting-1', pkg);

    const result = handleHandoffApprove({
      meetingId: 'audit-meeting-1',
      spawnReview: false,
    });

    expect(result.dispatchRowId).toBe('dispatch-row-1');
    expect(dispatch.dispatch).toHaveBeenCalledOnce();
    expect(dispatch.dispatch).toHaveBeenCalledWith(pkg);
    expect(stream.emitHandoffDispatched).toHaveBeenCalledOnce();
    expect(stream.emitHandoffDispatched).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'audit-meeting-1',
        dispatchRowId: 'dispatch-row-1',
        senderChannelId: 'audit-channel-1',
        targetChannelId: 'planning-channel-1',
        mode: 'check',
      }),
    );
    expect(pending.hasPending('audit-meeting-1')).toBe(false);
  });

  it('approve — pending 미존재 → throw', () => {
    expect(() =>
      handleHandoffApprove({
        meetingId: 'no-such-meeting',
        spawnReview: false,
      }),
    ).toThrow(/no pending package/);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
    expect(stream.emitHandoffDispatched).not.toHaveBeenCalled();
  });

  it('approve — spawnReview=true 도 dispatch payload 자체엔 영향 X', () => {
    const pkg = buildPkg();
    pending.put('audit-meeting-1', pkg);

    handleHandoffApprove({
      meetingId: 'audit-meeting-1',
      spawnReview: true,
    });

    expect(dispatch.dispatch).toHaveBeenCalledWith(pkg);
  });

  it('cancel — pending take + emit + dispatch 호출 X', () => {
    pending.put('audit-meeting-1', buildPkg());

    const result = handleHandoffCancel({ meetingId: 'audit-meeting-1' });

    expect(result.success).toBe(true);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
    expect(stream.emitHandoffRejected).toHaveBeenCalledOnce();
    expect(stream.emitHandoffRejected).toHaveBeenCalledWith({
      meetingId: 'audit-meeting-1',
      reason: 'user_canceled',
    });
    expect(pending.hasPending('audit-meeting-1')).toBe(false);
  });

  it('cancel — 미존재 meetingId 도 silent OK (멱등)', () => {
    const result = handleHandoffCancel({ meetingId: 'no-such-meeting' });
    expect(result.success).toBe(true);
    expect(stream.emitHandoffRejected).toHaveBeenCalled();
  });

  it('approve — emit throw 시 caller 에 전파 X', () => {
    pending.put('audit-meeting-1', buildPkg());
    stream.emitHandoffDispatched.mockImplementation(() => {
      throw new Error('stream broken');
    });
    expect(() =>
      handleHandoffApprove({
        meetingId: 'audit-meeting-1',
        spawnReview: false,
      }),
    ).not.toThrow();
  });
});
