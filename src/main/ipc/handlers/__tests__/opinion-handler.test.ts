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
  handleOpinionListGeneralCards,
  handleOpinionPostFromGeneral,
  handleOpinionQuickVote,
  handleOpinionTally,
  handleOpinionToggleLightVote,
  setOpinionServiceAccessor,
} from '../opinion-handler';
import { UnknownScreenIdError } from '../../../meetings/opinion-service';
import type { OpinionService } from '../../../meetings/opinion-service';
import type {
  ListGeneralCardsResult,
  Opinion,
  OpinionFreeDiscussionResult,
  OpinionGatherResult,
  OpinionQuickVoteResult,
  OpinionTallyResult,
  PostFromGeneralChannelResult,
  ToggleLightVoteResult,
} from '../../../../shared/opinion-types';

interface ServiceMock {
  gather: ReturnType<typeof vi.fn>;
  tally: ReturnType<typeof vi.fn>;
  quickVote: ReturnType<typeof vi.fn>;
  freeDiscussionRound: ReturnType<typeof vi.fn>;
  postFromGeneralChannel: ReturnType<typeof vi.fn>;
  listGeneralCards: ReturnType<typeof vi.fn>;
  toggleLightVote: ReturnType<typeof vi.fn>;
}

function makeMock(): ServiceMock {
  return {
    gather: vi.fn(),
    tally: vi.fn(),
    quickVote: vi.fn(),
    freeDiscussionRound: vi.fn(),
    postFromGeneralChannel: vi.fn(),
    listGeneralCards: vi.fn(),
    toggleLightVote: vi.fn(),
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

  // ── postFromGeneral (R12-C2 P4 T20) ─────────────────────────────────

  it('handleOpinionPostFromGeneral forwards args and wraps result', () => {
    const insertedOp: Opinion = {
      id: 'op-1',
      parentId: null,
      meetingId: null,
      channelId: 'ch-1',
      kind: 'user-raised',
      authorProviderId: null,
      authorLabel: 'user_1',
      title: '제목',
      content: '본문',
      rationale: null,
      status: 'pending',
      exclusionReason: null,
      round: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const expected: PostFromGeneralChannelResult = {
      channelId: 'ch-1',
      inserted: [insertedOp],
    };
    const svc = makeMock();
    svc.postFromGeneralChannel.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionPostFromGeneral({
      channelId: 'ch-1',
      authorProviderId: null,
      parts: [{ title: '제목', content: '본문' }],
    });
    expect(res).toEqual({ result: expected });
    expect(svc.postFromGeneralChannel).toHaveBeenCalledWith({
      channelId: 'ch-1',
      authorProviderId: null,
      parts: [{ title: '제목', content: '본문' }],
    });
  });

  // ── listGeneralCards / toggleLightVote (R12-C2 P4 T21) ─────────────

  it('handleOpinionListGeneralCards forwards channelId and wraps result', () => {
    const expected: ListGeneralCardsResult = {
      channelId: 'ch-1',
      cards: [],
    };
    const svc = makeMock();
    svc.listGeneralCards.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionListGeneralCards({ channelId: 'ch-1' });
    expect(res).toEqual({ result: expected });
    expect(svc.listGeneralCards).toHaveBeenCalledWith('ch-1');
  });

  it('handleOpinionToggleLightVote forwards args and wraps result', () => {
    const expected: ToggleLightVoteResult = {
      opinionId: 'op-1',
      effect: 'inserted',
      userVote: 'agree',
      agreeCount: 1,
      opposeCount: 0,
    };
    const svc = makeMock();
    svc.toggleLightVote.mockReturnValue(expected);
    setOpinionServiceAccessor(() => svc as unknown as OpinionService);

    const res = handleOpinionToggleLightVote({
      opinionId: 'op-1',
      vote: 'agree',
    });
    expect(res).toEqual({ result: expected });
    expect(svc.toggleLightVote).toHaveBeenCalledWith({
      opinionId: 'op-1',
      vote: 'agree',
    });
  });
});
