import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleOpinionListGeneralCards, handleOpinionPostFromGeneral,
  handleOpinionToggleLightVote, setOpinionServiceAccessor,
} from '../opinion-handler';
import type { OpinionService } from '../../../meetings/opinion-service';
import type {
  ListGeneralCardsResult, Opinion, PostFromGeneralChannelResult,
  ToggleLightVoteResult,
} from '../../../../shared/opinion-types';

function makeMock() {
  return {
    postFromGeneralChannel: vi.fn(),
    listGeneralCards: vi.fn(),
    toggleLightVote: vi.fn(),
  };
}

afterEach(() => setOpinionServiceAccessor(null as never));

describe('chat opinion handlers', () => {
  it('throws when accessor is not initialized', () => {
    expect(() => handleOpinionListGeneralCards({ channelId: 'ch-1' }))
      .toThrow(/service not initialized/);
  });

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
