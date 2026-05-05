/**
 * audit-workflow 단위 테스트 — R12-C2 T17 land. spec §3 line 77 / §4 line 145 /
 * §11.12.1 line 955 + 957 + 959 / §11.22.4.
 *
 * 검증 (순수 함수 + 타입 contract):
 *   - classifyAuditVerdict: 결정적 분류 (agreed root opinion 수 → 'ok' | 'ng')
 *     - agreed root 0 → 'ok'
 *     - agreed root ≥ 1 → 'ng'
 *     - revise/block/addition status='agreed' 도 verdict 영향 X (root 만 본다)
 *     - rejected/excluded/pending 도 verdict 영향 X
 *     - self-raised/user-raised 는 silent ignore (kind !== 'root')
 *   - extractAuditProblemList: agreed root 만 추출 + NULL 필드 normalize
 *   - buildAuditHandoffPayload:
 *     - 'ok' → null
 *     - 'ng' → AuditHandoffPayload (problemList + minutesMarkdown 전달)
 *     - invariant 위반 (problemList 0 / 빈 markdown / NaN epoch) → throw
 *   - AUDIT_NG_TARGET_ROLE === 'planning'
 *   - isAuditDepartmentRole role guard
 *
 * orchestrator wire (NG → 기획 인계 dispatch + Notification + handoff_dispatch
 * row 영속) 는 T25 책임 — 본 sub-task 스코프 X.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIT_NG_TARGET_ROLE,
  AuditHandoffPayloadInvariantError,
  buildAuditHandoffPayload,
  classifyAuditVerdict,
  extractAuditProblemList,
  isAuditDepartmentRole,
  type AuditProblem,
  type AuditVerdictOpinionView,
} from '../audit-workflow';
import type { Opinion } from '../../../../shared/opinion-types';

// ── classifyAuditVerdict ────────────────────────────────────────────

describe('classifyAuditVerdict', () => {
  it('빈 list → ok (agreed root 0)', () => {
    expect(classifyAuditVerdict([])).toBe('ok');
  });

  it('agreed root 1 건 → ng', () => {
    const opinions: AuditVerdictOpinionView[] = [
      { kind: 'root', status: 'agreed' },
    ];
    expect(classifyAuditVerdict(opinions)).toBe('ng');
  });

  it('agreed root 다수 → ng', () => {
    const opinions: AuditVerdictOpinionView[] = [
      { kind: 'root', status: 'agreed' },
      { kind: 'root', status: 'agreed' },
      { kind: 'root', status: 'pending' },
    ];
    expect(classifyAuditVerdict(opinions)).toBe('ng');
  });

  it('agreed 자식 (revise/block/addition) 만 있고 root 는 미합의 → ok', () => {
    // 자식 의견은 root 의 합의 처리에 흡수되므로 verdict 에 직접 영향 X.
    const opinions: AuditVerdictOpinionView[] = [
      { kind: 'root', status: 'pending' },
      { kind: 'revise', status: 'agreed' },
      { kind: 'block', status: 'agreed' },
      { kind: 'addition', status: 'agreed' },
    ];
    expect(classifyAuditVerdict(opinions)).toBe('ok');
  });

  it('root 가 모두 rejected / excluded / pending → ok', () => {
    const opinions: AuditVerdictOpinionView[] = [
      { kind: 'root', status: 'rejected' },
      { kind: 'root', status: 'excluded' },
      { kind: 'root', status: 'pending' },
    ];
    expect(classifyAuditVerdict(opinions)).toBe('ok');
  });

  it('self-raised/user-raised 는 silent ignore (audit 회의에서 발생 X invariant)', () => {
    const opinions: AuditVerdictOpinionView[] = [
      { kind: 'self-raised', status: 'agreed' },
      { kind: 'user-raised', status: 'agreed' },
    ];
    expect(classifyAuditVerdict(opinions)).toBe('ok');
  });
});

// ── extractAuditProblemList ─────────────────────────────────────────

describe('extractAuditProblemList', () => {
  const baseOpinion: Opinion = {
    id: 'op-1',
    parentId: null,
    meetingId: 'meeting-1',
    channelId: 'audit-channel-1',
    kind: 'root',
    authorProviderId: 'claude',
    authorLabel: 'claude_1',
    title: '하드코딩 발견',
    content: 'src/foo.ts:42 에 매직넘버 5초',
    rationale: 'CLAUDE.md 절대 금지',
    status: 'agreed',
    exclusionReason: null,
    round: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  it('agreed root 만 추출, 다른 status / kind 는 skip', () => {
    const opinions: Opinion[] = [
      { ...baseOpinion, id: 'op-1', status: 'agreed' },
      { ...baseOpinion, id: 'op-2', status: 'pending' },
      { ...baseOpinion, id: 'op-3', kind: 'revise', status: 'agreed' },
      { ...baseOpinion, id: 'op-4', status: 'rejected' },
    ];
    const result = extractAuditProblemList(opinions);
    expect(result.length).toBe(1);
    expect(result[0]?.opinionId).toBe('op-1');
  });

  it('NULL title/content/rationale 은 빈 문자열로 normalize', () => {
    const opinions: Opinion[] = [
      {
        ...baseOpinion,
        title: null,
        content: null,
        rationale: null,
      },
    ];
    const result = extractAuditProblemList(opinions);
    const first = result[0] as AuditProblem | undefined;
    expect(first?.title).toBe('');
    expect(first?.content).toBe('');
    expect(first?.rationale).toBe('');
  });

  it('authorLabel 보존', () => {
    const opinions: Opinion[] = [
      { ...baseOpinion, authorLabel: 'gemini_2' },
    ];
    expect(extractAuditProblemList(opinions)[0]?.authorLabel).toBe('gemini_2');
  });
});

// ── buildAuditHandoffPayload ────────────────────────────────────────

describe('buildAuditHandoffPayload', () => {
  const sampleProblem: AuditProblem = {
    opinionId: 'op-1',
    title: '하드코딩 발견',
    content: 'src/foo.ts:42 매직넘버',
    rationale: 'CLAUDE.md 위반',
    authorLabel: 'claude_1',
  };

  const baseInput = {
    sourceAuditMeetingId: 'audit-meeting-1',
    sourceAuditChannelId: 'audit-channel-1',
    targetPlanningChannelId: 'planning-channel-1',
    auditMinutesMarkdown: '## [합의]\n- 하드코딩 1 건\n## [제외]\n(없음)\n',
    problemList: [sampleProblem] as readonly AuditProblem[],
    generatedAt: 1_700_000_000_000,
  };

  it("verdict='ok' → null (인계 X)", () => {
    expect(
      buildAuditHandoffPayload({ ...baseInput, verdict: 'ok' }),
    ).toBeNull();
  });

  it("verdict='ok' 면 problemList 가 비어도 OK (chain 종료)", () => {
    expect(
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ok',
        problemList: [],
      }),
    ).toBeNull();
  });

  it("verdict='ng' → AuditHandoffPayload (모든 필드 그대로)", () => {
    const payload = buildAuditHandoffPayload({
      ...baseInput,
      verdict: 'ng',
    });
    expect(payload).not.toBeNull();
    expect(payload?.sourceAuditMeetingId).toBe('audit-meeting-1');
    expect(payload?.sourceAuditChannelId).toBe('audit-channel-1');
    expect(payload?.targetPlanningChannelId).toBe('planning-channel-1');
    expect(payload?.auditMinutesMarkdown).toBe(baseInput.auditMinutesMarkdown);
    expect(payload?.problemList).toEqual([sampleProblem]);
    expect(payload?.generatedAt).toBe(1_700_000_000_000);
  });

  it("verdict='ng' 인데 problemList 가 비면 invariant violation throw", () => {
    expect(() =>
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ng',
        problemList: [],
      }),
    ).toThrow(AuditHandoffPayloadInvariantError);
  });

  it("verdict='ng' 인데 빈 회의록 → throw", () => {
    expect(() =>
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ng',
        auditMinutesMarkdown: '',
      }),
    ).toThrow(AuditHandoffPayloadInvariantError);
  });

  it("verdict='ng' 인데 whitespace-only 회의록 → throw", () => {
    expect(() =>
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ng',
        auditMinutesMarkdown: '   \n\t  ',
      }),
    ).toThrow(AuditHandoffPayloadInvariantError);
  });

  it("verdict='ng' 인데 NaN/음수 epoch → throw", () => {
    expect(() =>
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ng',
        generatedAt: Number.NaN,
      }),
    ).toThrow(AuditHandoffPayloadInvariantError);

    expect(() =>
      buildAuditHandoffPayload({
        ...baseInput,
        verdict: 'ng',
        generatedAt: -1,
      }),
    ).toThrow(AuditHandoffPayloadInvariantError);
  });
});

// ── 상수 + role guard ──────────────────────────────────────────────

describe('AUDIT_NG_TARGET_ROLE', () => {
  it("'planning' 으로 고정 (spec line 77 — NG → 항상 기획)", () => {
    expect(AUDIT_NG_TARGET_ROLE).toBe('planning');
  });
});

describe('isAuditDepartmentRole', () => {
  it("'audit' → true", () => {
    expect(isAuditDepartmentRole('audit')).toBe(true);
  });

  it('다른 role → false', () => {
    expect(isAuditDepartmentRole('review')).toBe(false);
    expect(isAuditDepartmentRole('planning')).toBe(false);
    expect(isAuditDepartmentRole('implement')).toBe(false);
    expect(isAuditDepartmentRole('idea')).toBe(false);
    expect(isAuditDepartmentRole('general')).toBe(false);
    expect(isAuditDepartmentRole(null)).toBe(false);
  });
});
