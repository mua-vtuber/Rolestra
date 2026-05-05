/**
 * run-step-handler IPC unit tests — R12-C2 P2 T12.
 *
 * Coverage:
 *   - 3 scope (meeting / channel / turn) 모두 RunStepService 의 대응 list*
 *     method 로 위임 + result wrap
 *   - accessor 미초기화 시 throw
 *
 * service 자체 동작은 run-step-service.test.ts 에서 통합 검증 — 본 파일은
 * IPC ↔ service 어댑터 표면만 본다 (mock service).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleMeetingListRunSteps,
  setRunStepServiceAccessor,
} from '../run-step-handler';
import type { RunStepService } from '../../../meetings/run-step/run-step-service';
import type { RunStep } from '../../../../shared/run-step-types';

interface ServiceMock {
  listByMeeting: ReturnType<typeof vi.fn>;
  listByChannel: ReturnType<typeof vi.fn>;
  listByTurn: ReturnType<typeof vi.fn>;
}

function makeMock(): ServiceMock {
  return {
    listByMeeting: vi.fn(),
    listByChannel: vi.fn(),
    listByTurn: vi.fn(),
  };
}

function fakeStep(): RunStep {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    meetingId: 'm1',
    channelId: 'c1',
    round: 0,
    turnIndex: 0,
    actorKind: 'system',
    actorId: null,
    stepKind: 'opinion_tally',
    inputJson: '{}',
    outputJson: '{}',
    nextStepCard: null,
    sideEffectSummary: null,
    durationMs: 1,
    createdAt: 1_700_000_000_000,
  };
}

afterEach(() => {
  setRunStepServiceAccessor(null as never);
});

describe('run-step-handler', () => {
  it('throws when accessor is not initialized', () => {
    expect(() =>
      handleMeetingListRunSteps({ scope: 'meeting', meetingId: 'm1' }),
    ).toThrow(/service not initialized/);
  });

  it('scope=meeting forwards meetingId to listByMeeting', () => {
    const expected = [fakeStep()];
    const svc = makeMock();
    svc.listByMeeting.mockReturnValue(expected);
    setRunStepServiceAccessor(() => svc as unknown as RunStepService);

    const res = handleMeetingListRunSteps({ scope: 'meeting', meetingId: 'm1' });

    expect(svc.listByMeeting).toHaveBeenCalledWith('m1');
    expect(svc.listByChannel).not.toHaveBeenCalled();
    expect(svc.listByTurn).not.toHaveBeenCalled();
    expect(res).toEqual({ steps: expected });
  });

  it('scope=channel forwards channelId to listByChannel', () => {
    const expected = [fakeStep()];
    const svc = makeMock();
    svc.listByChannel.mockReturnValue(expected);
    setRunStepServiceAccessor(() => svc as unknown as RunStepService);

    const res = handleMeetingListRunSteps({ scope: 'channel', channelId: 'c1' });

    expect(svc.listByChannel).toHaveBeenCalledWith('c1');
    expect(svc.listByMeeting).not.toHaveBeenCalled();
    expect(svc.listByTurn).not.toHaveBeenCalled();
    expect(res).toEqual({ steps: expected });
  });

  it('scope=turn forwards meetingId+turnIndex to listByTurn', () => {
    const expected = [fakeStep()];
    const svc = makeMock();
    svc.listByTurn.mockReturnValue(expected);
    setRunStepServiceAccessor(() => svc as unknown as RunStepService);

    const res = handleMeetingListRunSteps({
      scope: 'turn',
      meetingId: 'm1',
      turnIndex: 5,
    });

    expect(svc.listByTurn).toHaveBeenCalledWith('m1', 5);
    expect(svc.listByMeeting).not.toHaveBeenCalled();
    expect(svc.listByChannel).not.toHaveBeenCalled();
    expect(res).toEqual({ steps: expected });
  });
});
