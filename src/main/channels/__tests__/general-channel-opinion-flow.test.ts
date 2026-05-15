/**
 * GeneralChannelOpinionFlow 단위 테스트 — R12-C2 P4 T20.
 *
 * 검증:
 *   - system_general 메시지에 [##] → postFromGeneralChannel 호출 + 'user-raised'
 *   - user kind + role='general' 메시지에 [##] → 'self-raised' (member authorKind)
 *   - 부서 채널 (role='planning') 은 skip
 *   - DM / system_approval / system_minutes 는 skip
 *   - [##] 0 건 메시지 → service 호출 X
 *   - 'system' authorKind → skip (자동 메시지 차단)
 *   - 채널 lookup 실패 → skip + 로그 (silent fallback X — throw 안 함)
 *   - service throw → listener swallow (메시지 영속 흐름 깨지 X)
 *   - 한 메시지 안 [##] N 건 → 단일 batch (N parts)
 *   - isGeneralChannel helper export — 분기 진리표
 */

import { describe, expect, it, vi } from 'vitest';

import type { Channel } from '../../../shared/channel-types';
import { catalogDefaultForNullRole } from '../../../shared/permission-set-types';
import type {
  Message,
  MessageAuthorKind,
} from '../../../shared/message-types';
import type {
  Opinion,
  PostFromGeneralChannelInput,
  PostFromGeneralChannelResult,
} from '../../../shared/opinion-types';
import type { OpinionService } from '../../meetings/opinion-service';
import {
  GeneralChannelOpinionFlow,
  isGeneralChannel,
} from '../general-channel-opinion-flow';

function mkChannel(overrides: Partial<Channel> = {}): Channel {
  const base: Channel = {
    id: 'ch-1',
    projectId: null,
    name: '#일반',
    kind: 'system_general',
    readOnly: false,
    createdAt: 0,
    role: null,
    purpose: null,
    handoffMode: 'check',
    maxRounds: null,
    permissions: catalogDefaultForNullRole(),
  };
  return {
    ...base,
    ...overrides,
    permissions: overrides.permissions ?? base.permissions,
  };
}

function mkMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    channelId: 'ch-1',
    meetingId: null,
    authorId: 'user',
    authorKind: 'user' as MessageAuthorKind,
    role: 'user',
    content: '',
    meta: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function mkInsertedRow(overrides: Partial<Opinion> = {}): Opinion {
  return {
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
    ...overrides,
  };
}

interface FlowFixture {
  flow: GeneralChannelOpinionFlow;
  channelGet: ReturnType<typeof vi.fn>;
  postFromGeneralChannel: ReturnType<typeof vi.fn>;
}

function makeFlow(channel: Channel | null): FlowFixture {
  const channelGet = vi.fn().mockReturnValue(channel);
  const postFromGeneralChannel = vi
    .fn<
      (
        input: PostFromGeneralChannelInput,
      ) => PostFromGeneralChannelResult
    >()
    .mockImplementation((input) => ({
      channelId: input.channelId,
      inserted: input.parts.map((p, i) =>
        mkInsertedRow({
          id: `op-${i + 1}`,
          channelId: input.channelId,
          authorProviderId: input.authorProviderId,
          kind:
            input.authorProviderId === null ? 'user-raised' : 'self-raised',
          title: p.title ?? p.content,
          content: p.content,
        }),
      ),
    }));
  const flow = new GeneralChannelOpinionFlow({
    channelService: { get: channelGet },
    opinionService: {
      postFromGeneralChannel,
    } as Pick<OpinionService, 'postFromGeneralChannel'>,
  });
  return { flow, channelGet, postFromGeneralChannel };
}

describe('GeneralChannelOpinionFlow', () => {
  describe('일반 채널 매칭 + 호출', () => {
    it('system_general 메시지 + [##] → service 호출 + authorProviderId=null', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(
        mkMessage({ content: '잡담 [##할 일 제안] 더 잡담' }),
      );
      expect(postFromGeneralChannel).toHaveBeenCalledTimes(1);
      const arg = postFromGeneralChannel.mock.calls[0]![0];
      expect(arg.channelId).toBe('ch-1');
      expect(arg.authorProviderId).toBeNull();
      expect(arg.parts).toEqual([{ title: null, content: '할 일 제안' }]);
    });

    it('user kind + role=general 메시지 + [##] → service 호출', () => {
      const channel = mkChannel({
        kind: 'user',
        role: 'general',
        projectId: 'p-1',
        name: 'general',
      });
      const { flow, postFromGeneralChannel } = makeFlow(channel);
      flow.onMessage(mkMessage({ content: '[##아이디어]' }));
      expect(postFromGeneralChannel).toHaveBeenCalledTimes(1);
    });

    it('직원 응답 (authorKind=member) → authorProviderId=providerId / kind=self-raised 분기', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(
        mkMessage({
          authorId: 'pv-codex',
          authorKind: 'member',
          role: 'assistant',
          content: '직원 응답 [##직원 의견]',
        }),
      );
      const arg = postFromGeneralChannel.mock.calls[0]![0];
      expect(arg.authorProviderId).toBe('pv-codex');
    });

    it('한 메시지 안 [##] N 건 → 단일 batch (N parts, 등장 순서 유지)', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(
        mkMessage({ content: '[##first] mid [##second] tail [##third]' }),
      );
      expect(postFromGeneralChannel).toHaveBeenCalledTimes(1);
      const arg = postFromGeneralChannel.mock.calls[0]![0];
      expect(arg.parts.map((p: { content: string }) => p.content)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });
  });

  describe('skip 케이스 (silent — service 호출 0 회)', () => {
    it('[##] 0 건 메시지 → service 호출 X', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(mkMessage({ content: '잡담만 있고 [##] 없음' }));
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });

    it('빈 본문 [##] / [##  ] → service 호출 X (parser 단계에서 skip)', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(mkMessage({ content: '[##] 그리고 [##   ]' }));
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });

    it("authorKind='system' → 자동 메시지 차단 (skip)", () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      flow.onMessage(
        mkMessage({
          authorId: 'system',
          authorKind: 'system',
          role: 'system',
          content: '[##should not register]',
        }),
      );
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });

    it('부서 채널 (role=planning) → skip', () => {
      const planning = mkChannel({
        kind: 'user',
        role: 'planning',
        projectId: 'p-1',
        name: 'planning',
      });
      const { flow, postFromGeneralChannel } = makeFlow(planning);
      flow.onMessage(mkMessage({ content: '[##planning에 들어와도 무시]' }));
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });

    it('DM 채널 → skip', () => {
      const dm = mkChannel({
        kind: 'dm',
        role: null,
        projectId: null,
        name: 'dm:claude',
      });
      const { flow, postFromGeneralChannel } = makeFlow(dm);
      flow.onMessage(mkMessage({ content: '[##dm 에서도 무시]' }));
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });

    it('system_approval / system_minutes → skip', () => {
      for (const kind of ['system_approval', 'system_minutes'] as const) {
        const ch = mkChannel({ kind, role: null });
        const { flow, postFromGeneralChannel } = makeFlow(ch);
        flow.onMessage(mkMessage({ content: '[##should be ignored]' }));
        expect(postFromGeneralChannel).not.toHaveBeenCalled();
      }
    });

    it('채널 lookup 실패 (null) → skip + throw X', () => {
      const { flow, postFromGeneralChannel } = makeFlow(null);
      expect(() =>
        flow.onMessage(mkMessage({ content: '[##body]' })),
      ).not.toThrow();
      expect(postFromGeneralChannel).not.toHaveBeenCalled();
    });
  });

  describe('isolation', () => {
    it('service throw → listener swallow (throw 안 함)', () => {
      const { flow, postFromGeneralChannel } = makeFlow(mkChannel());
      postFromGeneralChannel.mockImplementation(() => {
        throw new Error('boom');
      });
      expect(() =>
        flow.onMessage(mkMessage({ content: '[##body]' })),
      ).not.toThrow();
      expect(postFromGeneralChannel).toHaveBeenCalledTimes(1);
    });
  });

  describe('isGeneralChannel helper', () => {
    it('system_general → true', () => {
      expect(isGeneralChannel(mkChannel())).toBe(true);
    });

    it("user + role='general' → true", () => {
      expect(
        isGeneralChannel(
          mkChannel({ kind: 'user', role: 'general', projectId: 'p-1' }),
        ),
      ).toBe(true);
    });

    it("user + role='planning' → false", () => {
      expect(
        isGeneralChannel(
          mkChannel({ kind: 'user', role: 'planning', projectId: 'p-1' }),
        ),
      ).toBe(false);
    });

    it('user + role=null → false', () => {
      expect(
        isGeneralChannel(
          mkChannel({ kind: 'user', role: null, projectId: 'p-1' }),
        ),
      ).toBe(false);
    });

    it('dm → false', () => {
      expect(
        isGeneralChannel(mkChannel({ kind: 'dm', role: null })),
      ).toBe(false);
    });
  });
});
