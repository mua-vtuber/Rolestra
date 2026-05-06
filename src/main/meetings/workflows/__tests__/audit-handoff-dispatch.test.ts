/**
 * audit-handoff-dispatch 단위 테스트 — R12-C2 T25 land.
 *
 * 검증 (순수 함수 + 타입 contract):
 *   - composeFixMissionBody:
 *     - 빈 problemList → invariant throw
 *     - 단일 problem 본문 (opinionId + title 1-line + 안내문)
 *     - 다수 problem 본문 (1. 2. 3. 카운트 + count 표기)
 *     - blank title → '(제목 없음)' normalize
 *   - buildFixMissionCardFromAuditPayload:
 *     - 정상 build (override 없는 default body / inputFiles=[] / expectedOutputs=DEFAULT)
 *     - body override 적용
 *     - inputFiles override 적용
 *     - expectedOutputs override 적용
 *     - assignedProviderId blank → throw
 *     - missionCardId blank → throw
 *     - createdAt NaN/음수 → throw
 *     - mission card targetChannelId 가 payload.targetPlanningChannelId 와 일치
 *     - problemList 변환 시 rationale + authorLabel 제거 (mission card schema 와 정합)
 *   - planAuditDispatch:
 *     - verdict='ok' → kind='end' (planning 채널 dummy 값이어도 OK)
 *     - verdict='ng' → kind='planning_handoff' + payload + missionCard + targetRole='planning'
 *     - verdict='ng' + targetPlanningChannelId blank → throw
 *     - verdict='ng' + buildAuditHandoffPayload invariant (빈 회의록) → wrap throw
 *     - body / inputFiles / expectedOutputs override 가 missionCard 까지 전파
 *     - missionCard.assignedProviderId 가 입력값 그대로 전달
 *
 * orchestrator wire (handoff_dispatch row 영속 / planning 회의 boot /
 * Notification 발송) 는 P6 책임 (T27 / T28) — 본 sub-task 스코프 X.
 */

import { describe, expect, it } from 'vitest';
import {
  AuditDispatchInvariantError,
  buildFixMissionCardFromAuditPayload,
  composeFixMissionBody,
  DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS,
  planAuditDispatch,
  type AuditDispatchOutcome,
} from '../audit-handoff-dispatch';
import type { AuditHandoffPayload, AuditProblem } from '../audit-workflow';
import type { Opinion } from '../../../../shared/opinion-types';

// ── shared fixtures ─────────────────────────────────────────────────

const sampleProblem: AuditProblem = {
  opinionId: 'op-1',
  title: '하드코딩 발견',
  content: 'src/foo.ts:42 매직넘버 5초',
  rationale: 'CLAUDE.md 절대 금지',
  authorLabel: 'claude_1',
};

const samplePayload: AuditHandoffPayload = {
  sourceAuditMeetingId: 'audit-meeting-1',
  sourceAuditChannelId: 'audit-channel-1',
  targetPlanningChannelId: 'planning-channel-1',
  auditMinutesMarkdown: '## [합의]\n- 하드코딩 1 건\n## [제외]\n(없음)\n',
  problemList: [sampleProblem],
  generatedAt: 1_700_000_000_000,
};

const baseOpinion: Opinion = {
  id: 'op-1',
  parentId: null,
  meetingId: 'audit-meeting-1',
  channelId: 'audit-channel-1',
  kind: 'root',
  authorProviderId: 'claude',
  authorLabel: 'claude_1',
  title: '하드코딩 발견',
  content: 'src/foo.ts:42 매직넘버 5초',
  rationale: 'CLAUDE.md 절대 금지',
  status: 'agreed',
  exclusionReason: null,
  round: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

// ── composeFixMissionBody ───────────────────────────────────────────

describe('composeFixMissionBody', () => {
  it('빈 problemList → invariant throw', () => {
    expect(() => composeFixMissionBody({ problemList: [] })).toThrow(
      AuditDispatchInvariantError,
    );
  });

  it('단일 problem → 본문에 1-line 요약 + count=1 표기 포함', () => {
    const body = composeFixMissionBody({ problemList: [sampleProblem] });
    expect(body).toContain('1 건 문제 발견');
    expect(body).toContain('1. (op-1) 하드코딩 발견');
    expect(body).toContain('mission card');
    expect(body).toContain('agreed');
    expect(body).toContain('excluded');
  });

  it('다수 problem → 1. 2. 3. 카운트', () => {
    const body = composeFixMissionBody({
      problemList: [
        { ...sampleProblem, opinionId: 'op-A', title: '문제 A' },
        { ...sampleProblem, opinionId: 'op-B', title: '문제 B' },
        { ...sampleProblem, opinionId: 'op-C', title: '문제 C' },
      ],
    });
    expect(body).toContain('3 건 문제 발견');
    expect(body).toContain('1. (op-A) 문제 A');
    expect(body).toContain('2. (op-B) 문제 B');
    expect(body).toContain('3. (op-C) 문제 C');
  });

  it('blank title → "(제목 없음)" normalize', () => {
    const body = composeFixMissionBody({
      problemList: [{ ...sampleProblem, title: '' }],
    });
    expect(body).toContain('(op-1) (제목 없음)');
  });

  it('whitespace-only title 도 "(제목 없음)" normalize', () => {
    const body = composeFixMissionBody({
      problemList: [{ ...sampleProblem, title: '   \t\n  ' }],
    });
    expect(body).toContain('(op-1) (제목 없음)');
  });
});

// ── buildFixMissionCardFromAuditPayload ─────────────────────────────

describe('buildFixMissionCardFromAuditPayload', () => {
  const baseInput = {
    payload: samplePayload,
    assignedProviderId: 'gemini',
    missionCardId: '11111111-1111-4111-8111-111111111111',
    createdAt: 1_700_000_000_000,
  };

  it('정상 build — default body / inputFiles=[] / expectedOutputs=DEFAULT', () => {
    const card = buildFixMissionCardFromAuditPayload(baseInput);
    expect(card.id).toBe(baseInput.missionCardId);
    expect(card.assignedProviderId).toBe('gemini');
    expect(card.targetChannelId).toBe('planning-channel-1');
    expect(card.createdAt).toBe(1_700_000_000_000);
    expect(card.payload.kind).toBe('fix');
    expect(card.payload.body.length).toBeGreaterThan(0);
    expect(card.payload.inputFiles).toEqual([]);
    expect(card.payload.expectedOutputs).toEqual(
      DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS,
    );
    if (card.payload.kind === 'fix') {
      expect(card.payload.auditMinutesMarkdown).toBe(
        samplePayload.auditMinutesMarkdown,
      );
      expect(card.payload.problemList.length).toBe(1);
      expect(card.payload.problemList[0]?.opinionId).toBe('op-1');
      expect(card.payload.problemList[0]?.title).toBe('하드코딩 발견');
      expect(card.payload.problemList[0]?.content).toBe(
        'src/foo.ts:42 매직넘버 5초',
      );
    }
  });

  it('body override 적용', () => {
    const card = buildFixMissionCardFromAuditPayload({
      ...baseInput,
      body: '커스텀 body 본문',
    });
    expect(card.payload.body).toBe('커스텀 body 본문');
  });

  it('inputFiles override 적용', () => {
    const card = buildFixMissionCardFromAuditPayload({
      ...baseInput,
      inputFiles: ['src/foo.ts', 'src/bar.ts'],
    });
    expect(card.payload.inputFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('expectedOutputs override 적용', () => {
    const card = buildFixMissionCardFromAuditPayload({
      ...baseInput,
      expectedOutputs: ['패치 리스트 1 건'],
    });
    expect(card.payload.expectedOutputs).toEqual(['패치 리스트 1 건']);
  });

  it('assignedProviderId blank → throw', () => {
    expect(() =>
      buildFixMissionCardFromAuditPayload({
        ...baseInput,
        assignedProviderId: '',
      }),
    ).toThrow(AuditDispatchInvariantError);
    expect(() =>
      buildFixMissionCardFromAuditPayload({
        ...baseInput,
        assignedProviderId: '   ',
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it('missionCardId blank → throw', () => {
    expect(() =>
      buildFixMissionCardFromAuditPayload({
        ...baseInput,
        missionCardId: '',
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it('createdAt NaN → throw', () => {
    expect(() =>
      buildFixMissionCardFromAuditPayload({
        ...baseInput,
        createdAt: Number.NaN,
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it('createdAt 음수 → throw', () => {
    expect(() =>
      buildFixMissionCardFromAuditPayload({
        ...baseInput,
        createdAt: -1,
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it('mission card targetChannelId 는 payload.targetPlanningChannelId 그대로', () => {
    const card = buildFixMissionCardFromAuditPayload({
      ...baseInput,
      payload: {
        ...samplePayload,
        targetPlanningChannelId: 'planning-channel-99',
      },
    });
    expect(card.targetChannelId).toBe('planning-channel-99');
  });

  it('problemList 변환 시 rationale + authorLabel 제거 (mission card schema 정합)', () => {
    const card = buildFixMissionCardFromAuditPayload({
      ...baseInput,
      payload: {
        ...samplePayload,
        problemList: [
          {
            opinionId: 'op-X',
            title: 'title-X',
            content: 'content-X',
            rationale: 'rationale-X',
            authorLabel: 'author-X',
          },
        ],
      },
    });
    if (card.payload.kind !== 'fix') {
      throw new Error('expected fix payload');
    }
    const first = card.payload.problemList[0];
    expect(first).toEqual({
      opinionId: 'op-X',
      title: 'title-X',
      content: 'content-X',
    });
    expect((first as unknown as { rationale?: string }).rationale).toBeUndefined();
    expect(
      (first as unknown as { authorLabel?: string }).authorLabel,
    ).toBeUndefined();
  });
});

// ── planAuditDispatch ───────────────────────────────────────────────

describe('planAuditDispatch', () => {
  const baseInput = {
    opinions: [] as Opinion[],
    auditMinutesMarkdown: '## [합의]\n(없음)\n## [제외]\n(없음)\n',
    sourceAuditMeetingId: 'audit-meeting-1',
    sourceAuditChannelId: 'audit-channel-1',
    targetPlanningChannelId: 'planning-channel-1',
    assignedPlanningProviderId: 'gemini',
    missionCardId: '22222222-2222-4222-8222-222222222222',
    generatedAt: 1_700_000_000_000,
  };

  it("verdict='ok' (agreed root 0) → kind='end'", () => {
    const out: AuditDispatchOutcome = planAuditDispatch(baseInput);
    expect(out.kind).toBe('end');
    if (out.kind === 'end') {
      expect(out.verdict).toBe('ok');
      expect(out.reason).toBe('verdict_ok_no_problems_found');
    }
  });

  it("verdict='ok' branch 는 planning 채널 dummy 값을 무시 (사용 X)", () => {
    // targetPlanningChannelId 가 빈 문자열이어도 'ok' 면 throw X — 'ng' 분기에서만
    // 검증됨.
    const out = planAuditDispatch({
      ...baseInput,
      targetPlanningChannelId: '',
      assignedPlanningProviderId: '',
      missionCardId: '',
    });
    expect(out.kind).toBe('end');
  });

  it("verdict='ng' (agreed root ≥ 1) → kind='planning_handoff' + payload + missionCard + targetRole='planning'", () => {
    const out = planAuditDispatch({
      ...baseInput,
      auditMinutesMarkdown:
        '## [합의]\n- 하드코딩 1 건\n## [제외]\n(없음)\n',
      opinions: [baseOpinion],
    });
    expect(out.kind).toBe('planning_handoff');
    if (out.kind === 'planning_handoff') {
      expect(out.verdict).toBe('ng');
      expect(out.targetRole).toBe('planning');
      expect(out.payload.sourceAuditMeetingId).toBe('audit-meeting-1');
      expect(out.payload.targetPlanningChannelId).toBe('planning-channel-1');
      expect(out.payload.problemList.length).toBe(1);
      expect(out.payload.problemList[0]?.opinionId).toBe('op-1');
      expect(out.missionCard.id).toBe(baseInput.missionCardId);
      expect(out.missionCard.assignedProviderId).toBe('gemini');
      expect(out.missionCard.targetChannelId).toBe('planning-channel-1');
      expect(out.missionCard.payload.kind).toBe('fix');
      if (out.missionCard.payload.kind === 'fix') {
        expect(out.missionCard.payload.problemList.length).toBe(1);
      }
    }
  });

  it("verdict='ng' + targetPlanningChannelId blank → throw", () => {
    expect(() =>
      planAuditDispatch({
        ...baseInput,
        opinions: [baseOpinion],
        targetPlanningChannelId: '',
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it("verdict='ng' + 빈 회의록 → buildAuditHandoffPayload 의 invariant 가 wrap 되어 throw", () => {
    expect(() =>
      planAuditDispatch({
        ...baseInput,
        opinions: [baseOpinion],
        auditMinutesMarkdown: '',
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it("verdict='ng' + assignedPlanningProviderId blank → throw (mission card builder)", () => {
    expect(() =>
      planAuditDispatch({
        ...baseInput,
        opinions: [baseOpinion],
        assignedPlanningProviderId: '',
      }),
    ).toThrow(AuditDispatchInvariantError);
  });

  it("body / inputFiles / expectedOutputs override 가 missionCard 까지 전파", () => {
    const out = planAuditDispatch({
      ...baseInput,
      opinions: [baseOpinion],
      missionBody: 'OVERRIDE_BODY',
      missionInputFiles: ['src/foo.ts'],
      missionExpectedOutputs: ['EXPECTED_X'],
    });
    expect(out.kind).toBe('planning_handoff');
    if (out.kind === 'planning_handoff') {
      expect(out.missionCard.payload.body).toBe('OVERRIDE_BODY');
      expect(out.missionCard.payload.inputFiles).toEqual(['src/foo.ts']);
      expect(out.missionCard.payload.expectedOutputs).toEqual(['EXPECTED_X']);
    }
  });

  it('payload.generatedAt 와 missionCard.createdAt 이 동일 epoch (caller 가 같은 시점 주입)', () => {
    const out = planAuditDispatch({
      ...baseInput,
      opinions: [baseOpinion],
      generatedAt: 1_777_777_777_777,
    });
    if (out.kind === 'planning_handoff') {
      expect(out.payload.generatedAt).toBe(1_777_777_777_777);
      expect(out.missionCard.createdAt).toBe(1_777_777_777_777);
    }
  });

  it('agreed root 다수 → 모두 mission card problemList 에 포함', () => {
    const out = planAuditDispatch({
      ...baseInput,
      opinions: [
        { ...baseOpinion, id: 'op-A', title: 'A' },
        { ...baseOpinion, id: 'op-B', title: 'B' },
        { ...baseOpinion, id: 'op-C', title: 'C', status: 'pending' },
      ],
    });
    expect(out.kind).toBe('planning_handoff');
    if (out.kind === 'planning_handoff') {
      expect(out.payload.problemList.length).toBe(2);
      if (out.missionCard.payload.kind === 'fix') {
        expect(out.missionCard.payload.problemList.length).toBe(2);
        expect(out.missionCard.payload.problemList[0]?.opinionId).toBe('op-A');
        expect(out.missionCard.payload.problemList[1]?.opinionId).toBe('op-B');
      }
    }
  });
});
