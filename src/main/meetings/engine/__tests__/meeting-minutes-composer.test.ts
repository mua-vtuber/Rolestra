/**
 * MeetingMinutesComposer unit tests.
 *
 * Pure-function tests: no DB, no stream bridge, no filesystem. Covers
 *   - happy path (SSM=DONE, proposal present, 2 participants)
 *   - FAILED path (no proposal, failure reason line)
 *   - multi-participant formatting (3 and 5 AI)
 *   - vote tally edge cases (0/all-agree/mixed/abstain)
 *   - i18n translator delegation + missing-key fallback
 */

import { describe, it, expect } from 'vitest';
import { composeMinutes } from '../meeting-minutes-composer';
import type { SessionSnapshot } from '../../../../shared/session-state-types';
import type { Participant } from '../../../../shared/engine-types';
import type { VoteRecord } from '../../../../shared/consensus-types';

const BASE_STARTED = 1_700_000_000_000; // fixed epoch for deterministic minutes
const BASE_ENDED = BASE_STARTED + 12 * 60_000; // 12 분

function ai(name: string, i: number): Participant {
  return {
    id: `ai-${i}`,
    providerId: `ai-${i}`,
    displayName: name,
    isActive: true,
  };
}

function voteRecord(
  participantId: string,
  vote: VoteRecord['vote'],
): VoteRecord {
  return {
    participantId,
    participantName: participantId,
    vote,
    source: 'ai',
    timestamp: BASE_STARTED + 1000,
  };
}

function baseSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    state: 'DONE',
    previousState: 'USER_DECISION',
    event: 'USER_ACCEPT',
    conversationRound: 2,
    modeJudgments: [],
    workRound: 1,
    retryCount: 0,
    proposal: 'We will ship v1.0 on Friday and freeze the API.',
    proposalHash: 'hash-abc',
    aggregatorId: 'ai-1',
    votes: [
      voteRecord('ai-1', 'agree'),
      voteRecord('ai-2', 'agree'),
    ],
    workerId: 'ai-1',
    projectPath: '/tmp/project',
    timestamp: BASE_ENDED,
    conversationId: 'meeting-abc',
    ...overrides,
  };
}

describe('MeetingMinutesComposer — happy path', () => {
  it('renders the header, meta block, proposal and footer', () => {
    const body = composeMinutes({
      meetingId: 'abcdef1234-5678-uuidv4',
      topic: 'Ship v1.0 on Friday',
      participants: [ai('GPT', 1), ai('Claude', 2)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });

    expect(body).toContain('## 회의 #abcdef12');
    expect(body).toContain('**참여자**: GPT, Claude');
    expect(body).toContain('**주제**: Ship v1.0 on Friday');
    expect(body).toContain('**SSM 최종 상태**: DONE');
    expect(body).toContain('**경과 시간**: 12분');
    expect(body).toContain('**투표**: ✓ 2 · ✗ 0 · · 0');
    expect(body).toContain('We will ship v1.0 on Friday and freeze the API.');
    // Footer timestamp follows YYYY-MM-DD HH:mm (locale-independent).
    expect(body).toMatch(/_회의 종료: \d{4}-\d{2}-\d{2} \d{2}:\d{2}_/);
    // Dividers present once before body and once after.
    expect(body.match(/\n---\n/g)?.length).toBe(2);
  });

  it('filters out the implicit user sentinel from the participants line', () => {
    const body = composeMinutes({
      meetingId: 'xx',
      topic: 'irrelevant',
      participants: [
        ai('GPT', 1),
        { id: 'user', displayName: '나', isActive: true },
        ai('Claude', 2),
      ],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });

    expect(body).toContain('**참여자**: GPT, Claude');
    expect(body).not.toContain('나');
  });

  it('renders 3 AI and 5 AI participants in insertion order', () => {
    const three = composeMinutes({
      meetingId: 'xx',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2), ai('C', 3)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(three).toContain('**참여자**: A, B, C');

    const five = composeMinutes({
      meetingId: 'xx',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2), ai('C', 3), ai('D', 4), ai('E', 5)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(five).toContain('**참여자**: A, B, C, D, E');
  });

  it('renders a "-" placeholder when participants is empty', () => {
    const body = composeMinutes({
      meetingId: 'xx',
      topic: 'empty',
      participants: [],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(body).toContain('**참여자**: -');
  });
});

describe('MeetingMinutesComposer — FAILED path', () => {
  it('renders the failure reason line and "합의본 없음" fallback', () => {
    const body = composeMinutes({
      meetingId: 'fail-1',
      topic: 'Something that failed',
      participants: [ai('GPT', 1), ai('Claude', 2)],
      snapshot: baseSnapshot({
        state: 'FAILED',
        previousState: 'EXECUTING',
        proposal: null,
        votes: [],
      }),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });

    expect(body).toContain('**SSM 최종 상태**: FAILED');
    expect(body).toContain('**종료 사유**: 이전 상태 EXECUTING에서 종료');
    expect(body).toContain('_합의본 없음_');
    expect(body).not.toContain('We will ship v1.0');
  });

  it('uses "사유 불명" when previousState is null', () => {
    const body = composeMinutes({
      meetingId: 'fail-2',
      topic: 'crash',
      participants: [ai('GPT', 1), ai('Claude', 2)],
      snapshot: baseSnapshot({
        state: 'FAILED',
        previousState: null,
        proposal: null,
        votes: [],
      }),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(body).toContain('**종료 사유**: 사유 불명 — 이전 상태 기록 없음');
  });

  it('renders vote tally 0/0/0 when votes array is empty', () => {
    const body = composeMinutes({
      meetingId: 'x',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot({ votes: [] }),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(body).toContain('**투표**: ✓ 0 · ✗ 0 · · 0');
  });
});

describe('MeetingMinutesComposer — vote tally', () => {
  it('counts agree/disagree/block/abstain correctly', () => {
    const body = composeMinutes({
      meetingId: 'x',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot({
        votes: [
          voteRecord('ai-1', 'agree'),
          voteRecord('ai-2', 'agree'),
          voteRecord('ai-3', 'disagree'),
          voteRecord('ai-4', 'block'),
          voteRecord('ai-5', 'abstain'),
        ],
      }),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
    });
    expect(body).toContain('**투표**: ✓ 2 · ✗ 2 · · 1');
  });
});

describe('MeetingMinutesComposer — i18n translator', () => {
  it('delegates every label through the translator when provided', () => {
    const t = (key: string): string => `T(${key})`;
    const body = composeMinutes({
      meetingId: 'xx',
      topic: 'T',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      t,
    });

    expect(body).toContain('## T(meeting.minutes.header.titlePrefix) #');
    expect(body).toContain('**T(meeting.minutes.header.participants)**: A, B');
    expect(body).toContain('**T(meeting.minutes.header.topic)**: T');
    expect(body).toContain('**T(meeting.minutes.header.votes)**: ');
    expect(body).toContain('_T(meeting.minutes.header.minutesFooter):');
  });

  it('falls back to default labels when translator returns the key verbatim', () => {
    const identity = (key: string): string => key;
    const body = composeMinutes({
      meetingId: 'xx',
      topic: 'T',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      t: identity,
    });
    expect(body).toContain('**참여자**: A, B');
    expect(body).toContain('_회의 종료:');
  });
});

describe('MeetingMinutesComposer — elapsed time', () => {
  it('rounds sub-minute deltas to 0분', () => {
    const body = composeMinutes({
      meetingId: 'x',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_STARTED + 5_000,
    });
    expect(body).toContain('**경과 시간**: 0분');
  });

  it('rounds 90 seconds to 2분 (half-up)', () => {
    const body = composeMinutes({
      meetingId: 'x',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_STARTED + 90_000,
    });
    expect(body).toContain('**경과 시간**: 2분');
  });

  it('uses now() when endedAt is omitted', () => {
    const body = composeMinutes({
      meetingId: 'x',
      topic: 't',
      participants: [ai('A', 1), ai('B', 2)],
      snapshot: baseSnapshot(),
      startedAt: Date.now() - 30 * 60_000,
    });
    expect(body).toMatch(/\*\*경과 시간\*\*: (29|30|31)분/);
  });
});
