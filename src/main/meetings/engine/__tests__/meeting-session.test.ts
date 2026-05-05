/**
 * MeetingSession 단위 테스트 — R12-C2 T10a 통째 재작성.
 *
 * 옛 SSM (`SessionStateMachine`) + DeepDebate / start / pause / resume /
 * stop 의존 테스트는 새 모델에서 의미 X — 통째 삭제. 새 surface 만 검증.
 */

import { describe, it, expect } from 'vitest';
import {
  MeetingSession,
  SYSTEM_TOPIC_PARTICIPANT_ID,
  type MeetingSessionOptions,
} from '../meeting-session';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';
import type { ParticipantMessage } from '../../../engine/history';

const MEETING_ID = 'mt-1';
const CHANNEL_ID = 'ch-1';
const PROJECT_ID = 'pr-1';

function buildCtx(overrides: Partial<SsmContext> = {}): SsmContext {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    projectPath: '/tmp/project',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
    ...overrides,
  };
}

function buildParticipants(count: number = 2): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ai-${i + 1}`,
    displayName: `AI ${i + 1}`,
    providerId: `ai-${i + 1}`,
    isActive: true,
  }));
}

function buildOptions(
  overrides: Partial<MeetingSessionOptions> = {},
): MeetingSessionOptions {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    topic: 'Discuss release plan',
    participants: buildParticipants(2),
    ssmCtx: buildCtx(),
    ...overrides,
  };
}

describe('MeetingSession — construction validation', () => {
  it('rejects empty meetingId', () => {
    expect(() => new MeetingSession(buildOptions({ meetingId: '' }))).toThrow(
      /meetingId/,
    );
  });

  it('rejects empty channelId', () => {
    expect(() => new MeetingSession(buildOptions({ channelId: '' }))).toThrow(
      /channelId/,
    );
  });

  it('rejects empty projectId', () => {
    expect(() => new MeetingSession(buildOptions({ projectId: '' }))).toThrow(
      /projectId/,
    );
  });

  it('rejects short topic', () => {
    expect(() => new MeetingSession(buildOptions({ topic: 'ok' }))).toThrow(
      /topic/,
    );
  });

  it('rejects ssmCtx.meetingId mismatch', () => {
    expect(
      () =>
        new MeetingSession(
          buildOptions({ ssmCtx: buildCtx({ meetingId: 'wrong' }) }),
        ),
    ).toThrow(/ssmCtx\.meetingId/);
  });

  it('rejects single-AI meeting (≥ 2 participants required)', () => {
    expect(
      () =>
        new MeetingSession(
          buildOptions({ participants: buildParticipants(1) }),
        ),
    ).toThrow(/at least 2/);
  });
});

describe('MeetingSession — boot invariants', () => {
  it('seeds the message buffer with the topic system message', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('system');
    expect(session.messages[0].participantId).toBe(SYSTEM_TOPIC_PARTICIPANT_ID);
    expect(session.messages[0].content).toContain('Discuss release plan');
  });

  it('starts in phase=gather, round=0, opinion=null, not aborted', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.currentPhase).toBe('gather');
    expect(session.currentRound).toBe(0);
    expect(session.currentOpinionScreenId).toBeNull();
    expect(session.aborted).toBe(false);
  });

  it('exposes only AI participants via aiParticipants', () => {
    const userPart: Participant = {
      id: 'user',
      displayName: 'User',
      providerId: 'user',
      isActive: true,
    };
    const session = new MeetingSession(
      buildOptions({
        participants: [...buildParticipants(2), userPart],
      }),
    );
    const ids = session.aiParticipants.map((p) => p.id);
    expect(ids).toEqual(['ai-1', 'ai-2']);
  });
});

describe('MeetingSession — phase / round / opinion screen ID', () => {
  it('setPhase mutates currentPhase', () => {
    const session = new MeetingSession(buildOptions());
    session.setPhase('quick_vote');
    expect(session.currentPhase).toBe('quick_vote');
  });

  it('incrementRound / resetRound update the counter', () => {
    const session = new MeetingSession(buildOptions());
    session.incrementRound();
    session.incrementRound();
    expect(session.currentRound).toBe(2);
    session.resetRound();
    expect(session.currentRound).toBe(0);
  });

  it('setCurrentOpinionScreenId stores nullable value', () => {
    const session = new MeetingSession(buildOptions());
    session.setCurrentOpinionScreenId('ITEM_002');
    expect(session.currentOpinionScreenId).toBe('ITEM_002');
    session.setCurrentOpinionScreenId(null);
    expect(session.currentOpinionScreenId).toBeNull();
  });
});

describe('MeetingSession — label counter', () => {
  it('nextLabel emits per-provider sequential labels', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.nextLabel('ai-1')).toBe('ai-1_1');
    expect(session.nextLabel('ai-1')).toBe('ai-1_2');
    expect(session.nextLabel('ai-2')).toBe('ai-2_1');
    expect(session.nextLabel('ai-1')).toBe('ai-1_3');
  });

  it('primeLabelCounter sets next number for next nextLabel call', () => {
    const session = new MeetingSession(buildOptions());
    session.primeLabelCounter('ai-1', 5);
    expect(session.nextLabel('ai-1')).toBe('ai-1_5');
    expect(session.nextLabel('ai-1')).toBe('ai-1_6');
  });

  it('primeLabelCounter rejects nextNumber < 1', () => {
    const session = new MeetingSession(buildOptions());
    expect(() => session.primeLabelCounter('ai-1', 0)).toThrow(/≥ 1/);
  });
});

describe('MeetingSession — abort', () => {
  it('abort sets aborted=true and phase=aborted', () => {
    const session = new MeetingSession(buildOptions());
    session.setPhase('free_discussion');
    session.abort();
    expect(session.aborted).toBe(true);
    expect(session.currentPhase).toBe('aborted');
  });

  it('abort is idempotent', () => {
    const session = new MeetingSession(buildOptions());
    session.abort();
    session.abort();
    expect(session.aborted).toBe(true);
  });
});

describe('MeetingSession — user message intake', () => {
  function userMsg(): ParticipantMessage {
    return {
      id: 'm1',
      role: 'user',
      content: 'hi',
      participantId: 'user',
      participantName: 'User',
    };
  }

  it('interruptWithUserMessage pushes a user role', () => {
    const session = new MeetingSession(buildOptions());
    const before = session.messages.length;
    session.interruptWithUserMessage(userMsg());
    expect(session.messages.length).toBe(before + 1);
    expect(session.messages[session.messages.length - 1].role).toBe('user');
  });

  it('interruptWithUserMessage rejects non-user role', () => {
    const session = new MeetingSession(buildOptions());
    expect(() =>
      session.interruptWithUserMessage({
        ...userMsg(),
        role: 'assistant',
      }),
    ).toThrow(/user/);
  });

  it('appendUserMessage rejects non-user role', () => {
    const session = new MeetingSession(buildOptions());
    expect(() =>
      session.appendUserMessage({
        ...userMsg(),
        role: 'system',
      }),
    ).toThrow(/user/);
  });
});

describe('MeetingSession — toInfo', () => {
  it('produces an IPC-safe projection', () => {
    const session = new MeetingSession(buildOptions());
    session.setPhase('free_discussion');
    session.incrementRound();
    session.setCurrentOpinionScreenId('ITEM_001');
    const info = session.toInfo();
    expect(info.meetingId).toBe(MEETING_ID);
    expect(info.phase).toBe('free_discussion');
    expect(info.currentRound).toBe(1);
    expect(info.currentOpinionScreenId).toBe('ITEM_001');
    expect(info.aborted).toBe(false);
  });
});
