/**
 * D-A T8: composeMinutes partial-summary layout 단위 테스트.
 *
 * partial=true 가 layout (제목 suffix + body) 분기를 정확히 트리거하고,
 * partial=false (default) 가 기존 회귀 없는지 확인. 본 composer 는
 * pure-function 이므로 LLM 미호출 — partialSummary 본문은 호출자
 * (T9 orchestrator) 가 MeetingSummaryService 로 미리 생성해 전달한다.
 */

import { describe, it, expect } from 'vitest';
import { composeMinutes } from '../meeting-minutes-composer';
import type { SessionSnapshot } from '../../../../shared/session-state-types';
import type { Participant } from '../../../../shared/engine-types';

const BASE_STARTED = 1_700_000_000_000;
const BASE_ENDED = BASE_STARTED + 30 * 60_000;

function ai(name: string, i: number): Participant {
  return {
    id: `ai-${i}`,
    providerId: `ai-${i}`,
    displayName: name,
    isActive: true,
  };
}

function failedSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    state: 'FAILED',
    previousState: 'VOTING',
    event: 'TIMEOUT',
    conversationRound: 3,
    modeJudgments: [],
    workRound: 5,
    retryCount: 5,
    proposal: null,
    proposalHash: null,
    aggregatorId: 'ai-1',
    votes: [],
    workerId: 'ai-1',
    projectPath: null,
    timestamp: BASE_ENDED,
    conversationId: 'meeting-partial-1',
    ...overrides,
  };
}

describe('composeMinutes — partial summary (D-A T8)', () => {
  it('renders partialSummary body and round-limit title suffix when partial=true', () => {
    const summary = [
      '## 합의된 결정',
      '- API 동결 일정에 동의',
      '',
      '## 논쟁 점',
      '- 배포 시점 (금/월)',
      '',
      '## 미결 항목',
      '- 회귀 테스트 범위',
    ].join('\n');

    const body = composeMinutes({
      meetingId: 'partial-uuid-12345678',
      topic: 'v1.0 배포 일정',
      participants: [ai('GPT', 1), ai('Claude', 2)],
      snapshot: failedSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      partial: true,
      partialSummary: summary,
      locale: 'ko',
    });

    expect(body).toContain('## 회의 #partialu (라운드 한계 도달)');
    expect(body).toContain('## 합의된 결정');
    expect(body).toContain('## 논쟁 점');
    expect(body).toContain('## 미결 항목');
    expect(body).toContain('API 동결 일정에 동의');
    // FAILED meta line 그대로 보존
    expect(body).toContain('**SSM 최종 상태**: FAILED');
    expect(body).toContain('**종료 사유**');
  });

  it('renders fallback i18n message when partialSummary is null (LLM 호출 실패 가정)', () => {
    const body = composeMinutes({
      meetingId: 'partial-uuid-87654321',
      topic: '미결 안건',
      participants: [ai('GPT', 1)],
      snapshot: failedSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      partial: true,
      partialSummary: null,
      locale: 'ko',
    });

    expect(body).toContain('## 회의 #partialu (라운드 한계 도달)');
    expect(body).toContain('회의가 라운드 한계로 종료되었습니다');
    // partialFallback 한 줄만 — proposal noConsensus 라인은 안 보여야 함
    expect(body).not.toContain('합의본 없음');
  });

  it('renders fallback when partialSummary is empty string (whitespace-only)', () => {
    const body = composeMinutes({
      meetingId: 'partial-empty',
      topic: '빈 요약',
      participants: [ai('GPT', 1)],
      snapshot: failedSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      partial: true,
      partialSummary: '   \n   ',
      locale: 'ko',
    });

    expect(body).toContain('회의가 라운드 한계로 종료되었습니다');
  });

  it('uses English fallback in en locale', () => {
    const body = composeMinutes({
      meetingId: 'partial-en',
      topic: 'unresolved',
      participants: [ai('GPT', 1)],
      snapshot: failedSnapshot(),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      partial: true,
      partialSummary: null,
      locale: 'en',
    });

    expect(body).toContain('## Meeting #partiale (round limit reached)');
    expect(body).toContain('Meeting ended at the round limit');
  });

  it('partial=false (default) does not add suffix or use partialSummary', () => {
    const body = composeMinutes({
      meetingId: 'normal-uuid-12345678',
      topic: 'normal flow',
      participants: [ai('GPT', 1)],
      snapshot: failedSnapshot({
        proposal: 'Decision text from non-partial path',
      }),
      startedAt: BASE_STARTED,
      endedAt: BASE_ENDED,
      // partial 미지정 → 기존 동작
      partialSummary: '이게 보이면 안 됨', // partial=false 면 무시
      locale: 'ko',
    });

    expect(body).not.toContain('(라운드 한계 도달)');
    expect(body).not.toContain('이게 보이면 안 됨');
    expect(body).toContain('Decision text from non-partial path');
  });
});
