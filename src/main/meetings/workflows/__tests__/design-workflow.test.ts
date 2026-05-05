/**
 * design-workflow 단위 테스트 — R12-C2 T16a land.
 *
 * 검증:
 *   - buildDesignedTaskPromptBody 가 3 sub-kind 별로 다른 헤더 / 미션 포함
 *   - JSON 스키마 양식 (Step6 = Step1 alias) 정합 — name / label / opinions[]
 *   - escapeForPrompt 가 displayName 의 " 와 \\ 를 안전 escape (JSON literal)
 *   - extractDesignedTaskOpinion: 빈 배열 → null / 1+ → 첫 번째 / 다수 → 첫 1 만
 *
 * 본 테스트는 design-workflow.ts 의 *순수 함수 + 타입 contract* 만 검증.
 * orchestrator wire (T16b) / Playwright snapshot (T16c) 는 별 sub-task 에서.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDesignedTaskPromptBody,
  capabilityForKind,
  DesignatedWorkerNotFoundError,
  extractDesignedTaskOpinion,
  resolveDesignatedWorker,
  type DesignatedWorkerCandidate,
  type DesignedTaskContext,
} from '../design-workflow';
import type { Step6DesignedTaskSchemaType } from '../../../../shared/meeting-flow-types';

const baseCtx: Omit<DesignedTaskContext, 'kind'> = {
  meetingOrdinal: 1,
  priorContent: '기획 인계서 본문 sample',
  speakerDisplayName: 'Gemini Designer',
  suggestedLabel: 'gemini_1',
};

describe('buildDesignedTaskPromptBody', () => {
  it('wireframe_drafting 헤더 + UX 미션 포함', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'wireframe_drafting',
    });
    expect(body).toContain('step 1 — UX 와이어프레임 작성');
    expect(body).toContain('와이어프레임');
    expect(body).toContain('기획 인계서');
    // JSON skeleton
    expect(body).toContain('"name": "Gemini Designer"');
    expect(body).toContain('"label": "gemini_1"');
    expect(body).toContain('"opinions"');
  });

  it('wireframe_revision 헤더 + 합의 반영 미션 포함', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'wireframe_revision',
    });
    expect(body).toContain('step 5 — 와이어프레임 수정');
    expect(body).toContain('합의');
    // 직전 단계 자료 prompt 안 포함
    expect(body).toContain('기획 인계서 본문 sample');
  });

  it('design_implementation 헤더 + HTML/CSS 미션 포함 + viewport 명시', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'design_implementation',
    });
    expect(body).toContain('step 6 — UI 디자인 (HTML/CSS) 작성');
    expect(body).toContain('HTML');
    expect(body).toContain('CSS');
    // Playwright viewport 안내
    expect(body).toContain('1280x720');
    expect(body).toContain('375x812');
  });

  it('priorContent 가 비어도 prompt build 가능 ("없음" 표기)', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'wireframe_drafting',
      priorContent: '',
    });
    expect(body).toContain('(없음');
  });

  it('displayName 안 " 와 \\ 가 JSON 안 안전 escape', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'wireframe_drafting',
      speakerDisplayName: 'A "B" \\ C',
    });
    // JSON literal 안에 " → \\" / \\ → \\\\ 형태로 들어가야
    expect(body).toContain('"name": "A \\"B\\" \\\\ C"');
  });

  it('label 안 " 도 JSON 안 안전 escape', () => {
    const body = buildDesignedTaskPromptBody({
      ...baseCtx,
      kind: 'wireframe_revision',
      suggestedLabel: 'foo "bar"',
    });
    expect(body).toContain('"label": "foo \\"bar\\""');
  });

  it('3 sub-kind 모두 동일 JSON skeleton 구조 (name + label + opinions)', () => {
    const kinds = [
      'wireframe_drafting',
      'wireframe_revision',
      'design_implementation',
    ] as const;
    for (const kind of kinds) {
      const body = buildDesignedTaskPromptBody({ ...baseCtx, kind });
      expect(body).toContain('"name":');
      expect(body).toContain('"label":');
      expect(body).toContain('"opinions"');
      expect(body).toContain('"title":');
      expect(body).toContain('"content":');
      expect(body).toContain('"rationale":');
      // schema fence
      expect(body).toContain('```json');
      // 응답 형식 강제
      expect(body).toContain('JSON 한 객체만');
    }
  });
});

describe('extractDesignedTaskOpinion', () => {
  it('빈 opinions → null', () => {
    const payload: Step6DesignedTaskSchemaType = {
      name: 'X',
      label: 'x_1',
      opinions: [],
    };
    expect(extractDesignedTaskOpinion(payload)).toBeNull();
  });

  it('1 건 → 그대로 반환', () => {
    const payload: Step6DesignedTaskSchemaType = {
      name: 'X',
      label: 'x_1',
      opinions: [
        { title: 'T1', content: 'C1', rationale: 'R1' },
      ],
    };
    expect(extractDesignedTaskOpinion(payload)).toEqual({
      title: 'T1',
      content: 'C1',
      rationale: 'R1',
    });
  });

  it('다수 건 → 첫 1 만 (silent drop)', () => {
    const payload: Step6DesignedTaskSchemaType = {
      name: 'X',
      label: 'x_1',
      opinions: [
        { title: 'T1', content: 'C1', rationale: 'R1' },
        { title: 'T2', content: 'C2', rationale: 'R2' },
      ],
    };
    const got = extractDesignedTaskOpinion(payload);
    expect(got?.title).toBe('T1');
    expect(got?.content).toBe('C1');
  });
});

// ── T16b 신규: capabilityForKind + resolveDesignatedWorker ───────────

describe('capabilityForKind', () => {
  it('wireframe_drafting → design.ux', () => {
    expect(capabilityForKind('wireframe_drafting')).toBe('design.ux');
  });

  it('wireframe_revision → design.ui', () => {
    expect(capabilityForKind('wireframe_revision')).toBe('design.ui');
  });

  it('design_implementation → design.ui', () => {
    expect(capabilityForKind('design_implementation')).toBe('design.ui');
  });
});

describe('resolveDesignatedWorker', () => {
  const ux: DesignatedWorkerCandidate = {
    providerId: 'codex',
    displayName: 'Codex UX',
    roles: ['design.ux', 'planning'],
  };
  const ui: DesignatedWorkerCandidate = {
    providerId: 'gemini',
    displayName: 'Gemini UI',
    roles: ['design.ui'],
  };
  const generalist: DesignatedWorkerCandidate = {
    providerId: 'claude',
    displayName: 'Claude PM',
    roles: ['planning', 'review'],
  };

  it('design.ux 매칭 첫 직원 반환', () => {
    expect(resolveDesignatedWorker([generalist, ux, ui], 'design.ux')).toBe(ux);
  });

  it('design.ui 매칭 첫 직원 반환', () => {
    expect(resolveDesignatedWorker([generalist, ux, ui], 'design.ui')).toBe(ui);
  });

  it('동일 capability 직원 둘 → 입력 순서 첫 건', () => {
    const ux2: DesignatedWorkerCandidate = {
      providerId: 'gpt5',
      displayName: 'GPT-5 UX',
      roles: ['design.ux'],
    };
    expect(resolveDesignatedWorker([ux, ux2], 'design.ux')).toBe(ux);
    expect(resolveDesignatedWorker([ux2, ux], 'design.ux')).toBe(ux2);
  });

  it('design.ux 매칭 0 명 → DesignatedWorkerNotFoundError', () => {
    expect(() => resolveDesignatedWorker([generalist, ui], 'design.ux'))
      .toThrow(DesignatedWorkerNotFoundError);
  });

  it('design.ui 매칭 0 명 → DesignatedWorkerNotFoundError', () => {
    expect(() => resolveDesignatedWorker([generalist, ux], 'design.ui'))
      .toThrow(DesignatedWorkerNotFoundError);
  });

  it('빈 후보 → DesignatedWorkerNotFoundError', () => {
    expect(() => resolveDesignatedWorker([], 'design.ux'))
      .toThrow(DesignatedWorkerNotFoundError);
  });

  it('error.capability 필드 = 입력 capability', () => {
    try {
      resolveDesignatedWorker([generalist], 'design.ui');
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DesignatedWorkerNotFoundError);
      expect((err as DesignatedWorkerNotFoundError).capability).toBe('design.ui');
    }
  });

  it('design.ux 직원이 다른 능력도 보유 — 매칭 통과', () => {
    expect(resolveDesignatedWorker([ux], 'design.ux')).toBe(ux);
    expect(ux.roles).toContain('planning');
  });
});
