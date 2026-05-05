/**
 * opinion-handler IPC unit tests — R12-C2 P2-2.
 *
 * Coverage:
 *   - 4 handler 모두 OpinionService 의 대응 method 로 위임 + result wrap
 *   - accessor 미초기화 시 throw
 *   - service 가 throw 한 도메인 에러 (UnknownScreenIdError 등) 그대로 전파
 *
 * service 자체 동작은 opinion-service.test.ts 에서 통합 검증 — 본 파일은
 * IPC ↔ service 어댑터 표면만 본다 (mock service).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleOpinionFreeDiscussion,
  handleOpinionGather,
  handleOpinionQuickVote,
  handleOpinionTally,
  setOpinionServiceAccessor,
} from '../opinion-handler';
import { UnknownScreenIdError } from '../../../meetings/opinion-service';
import type { OpinionService } from '../../../meetings/opinion-service';
import type {
  OpinionFreeDiscussionResult,
  OpinionGatherResult,
  OpinionQuickVoteResult,
  OpinionTallyResult,
} from '../../../../shared/opinion-types';

interface ServiceMock {
  gather: ReturnType<typeof vi.fn>;
  tally: ReturnType<typeof vi.fn>;
  quickVote: ReturnType<typeof vi.fn>;
  freeDiscussionRound: ReturnType<typeof vi.fn>;
}

function makeMock(): ServiceMock {
  return {
    gather: vi.fn(),
    tally: vi.fn(),
    quickVote: vi.fn(),
    freeDiscussionRound: vi.fn(),
  };
}

afterEach(() => {
  setOpinionServiceAccessor(null as never);
});

describe('opinion-handler', () => {
  it('throws when accessor is not initialized', () => {
    expect(() =>
      handleOpinionTally({ meetingId: 'm1' }),
    ).toThrow(/service not initialized/);
  });

  it('handleOpinionGather forwards args and wraps result', () => {
    const expected: OpinionGatherResult = { meetingId: 'm1', inserted: [] };
    const svc = makeMock();
    svc.gather.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionGather({
      meetingId: 'm1',
      channelId: 'c1',
      round: 0,
      responses: [
        {
          providerId: 'pv-codex',
          payload: { name: 'Codex', label: 'codex_1', opinions: [] },
        },
      ],
    });
    expect(res).toEqual({ result: expected });
    expect(svc.gather).toHaveBeenCalledWith({
      meetingId: 'm1',
      channelId: 'c1',
      round: 0,
      responses: [
        {
          providerId: 'pv-codex',
          payload: { name: 'Codex', label: 'codex_1', opinions: [] },
        },
      ],
    });
  });

  it('handleOpinionTally forwards meetingId and wraps result', () => {
    const expected: OpinionTallyResult = {
      meetingId: 'm1',
      rootCount: 0,
      totalCount: 0,
      tree: [],
      screenToUuid: {},
      uuidToScreen: {},
    };
    const svc = makeMock();
    svc.tally.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionTally({ meetingId: 'm1' });
    expect(res).toEqual({ result: expected });
    expect(svc.tally).toHaveBeenCalledWith('m1');
  });

  it('handleOpinionQuickVote forwards args and wraps result', () => {
    const expected: OpinionQuickVoteResult = {
      meetingId: 'm1',
      agreed: ['op-1'],
      unresolved: [],
      votesInserted: 1,
    };
    const svc = makeMock();
    svc.quickVote.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionQuickVote({
      meetingId: 'm1',
      round: 1,
      responses: [],
    });
    expect(res).toEqual({ result: expected });
    expect(svc.quickVote).toHaveBeenCalledWith({
      meetingId: 'm1',
      round: 1,
      responses: [],
    });
  });

  it('handleOpinionFreeDiscussion forwards args and wraps result', () => {
    const expected: OpinionFreeDiscussionResult = {
      meetingId: 'm1',
      opinionId: 'op-1',
      agreed: false,
      additions: [],
      votesInserted: 0,
    };
    const svc = makeMock();
    svc.freeDiscussionRound.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionFreeDiscussion({
      meetingId: 'm1',
      opinionId: 'op-1',
      round: 2,
      responses: [],
    });
    expect(res).toEqual({ result: expected });
    expect(svc.freeDiscussionRound).toHaveBeenCalledWith({
      meetingId: 'm1',
      opinionId: 'op-1',
      round: 2,
      responses: [],
    });
  });

  it('propagates service-level domain errors (UnknownScreenIdError) unchanged', () => {
    const svc = makeMock();
    svc.quickVote.mockImplementation(() => {
      throw new UnknownScreenIdError('m1', 'ITEM_999');
    });
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);
    expect(() =>
      handleOpinionQuickVote({ meetingId: 'm1', round: 1, responses: [] }),
    ).toThrow(UnknownScreenIdError);
  });
});
