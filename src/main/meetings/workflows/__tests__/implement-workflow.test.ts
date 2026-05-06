/**
 * implement-workflow 단위 테스트 — R12-C2 P5 T24 land. spec §3 line 75 / §4
 * line 143 / §11.13 line 883.
 *
 * 검증 (순수 함수 + 타입 contract):
 *   - implementResponseSchema:
 *     - 빈 patches 거부 / patches[0] 만 있어도 통과 / extra 필드 거부
 *     - operation 'create'/'modify'/'delete' 외 거부
 *     - summary 빈 문자열 거부
 *   - buildImplementPromptBody:
 *     - kind 별 헤더 / 미션 / 추가 컨텍스트 prepend
 *     - 입력 파일 list / snippet / 출력 기대치 합성
 *     - 응답 schema 안내 + truncate 금지 안내 포함
 *   - extractImplementPatchEntries:
 *     - 정상 entry 변환 (workspaceRoot 와 join → 절대 경로)
 *     - 절대 경로 거부
 *     - `..` traversal 거부
 *     - workspaceRoot 외부로 escape 거부
 *     - create/modify 시 newContent undefined → throw
 *     - delete 시 newContent 무시 + entry 의 newContent 도 undefined
 *   - buildImplementPatchSet:
 *     - dryRun true / false 둘 다 통과
 *     - 빈 entries 거부 / 빈 metadata 거부
 *   - ImplementApplyPending: idea-workflow 와 같은 single-use 계약
 *   - isImplementDepartmentRole / capabilityForMissionKind role guard
 *
 * orchestrator wire (mission card 수신 → designated worker resolve →
 * ExecutionService 호출 → audit 인계) 는 P5/P6 다른 sub-task 책임 — 본 sub-task
 * 스코프 X.
 */

import { describe, expect, it } from 'vitest';
import {
  ImplementApplyPending,
  ImplementResponseInvariantError,
  buildImplementPatchSet,
  buildImplementPromptBody,
  capabilityForMissionKind,
  extractImplementPatchEntries,
  implementResponseSchema,
  isImplementDepartmentRole,
  type ImplementApplyDecision,
  type ImplementMissionContext,
  type ImplementResponse,
} from '../implement-workflow';
import type { MissionCard } from '../../../../shared/schema/mission-card';

// ── fixtures ─────────────────────────────────────────────────────────

const SPEC_CARD: MissionCard = {
  id: '11111111-2222-3333-4444-555555555555',
  payload: {
    kind: 'spec',
    body: '회의 결과 — 로그인 폼 추가',
    inputFiles: ['src/auth/login.ts'],
    expectedOutputs: ['login form react component', 'unit test ≥ 1'],
    rootOpinionId: 'opinion-uuid-1',
    planningMinutesMarkdown: '# 회의록\n\n[합의]\n\n로그인 폼 추가\n',
  },
  assignedProviderId: 'claude',
  targetChannelId: 'channel-implement-1',
  createdAt: 1_700_000_000_000,
};

const FIX_CARD: MissionCard = {
  id: '22222222-3333-4444-5555-666666666666',
  payload: {
    kind: 'fix',
    body: 'audit 발견 문제 — 메모리 누수',
    inputFiles: ['src/main/foo.ts'],
    expectedOutputs: ['fix without regression'],
    auditMinutesMarkdown: '# audit 회의록\n\n[합의 = 문제]\n\n메모리 누수\n',
    problemList: [
      {
        opinionId: 'opinion-uuid-2',
        title: 'subprocess kill leak',
        content: 'subprocess never exits when window closes',
      },
    ],
  },
  assignedProviderId: 'claude',
  targetChannelId: 'channel-implement-1',
  createdAt: 1_700_000_000_000,
};

const CHANGE_CARD: MissionCard = {
  id: '33333333-4444-5555-6666-777777777777',
  payload: {
    kind: 'change-request',
    body: '버튼 색을 빨강으로',
    inputFiles: [],
    expectedOutputs: [],
    userMessage: '로그인 버튼 빨간색으로 바꿔주세요',
  },
  assignedProviderId: 'gemini',
  targetChannelId: 'channel-implement-1',
  createdAt: 1_700_000_000_000,
};

// path.resolve / path.relative 동작은 OS 별 다름 — POSIX absolute root 사용
const WORKSPACE_ROOT = '/tmp/workspace-root';

// ── implementResponseSchema ─────────────────────────────────────────

describe('implementResponseSchema', () => {
  it('정상 응답 통과', () => {
    const ok = {
      name: 'claude_1',
      label: 'claude_1',
      summary: '로그인 폼 추가',
      patches: [
        {
          operation: 'create' as const,
          targetPath: 'src/auth/LoginForm.tsx',
          newContent: 'export const LoginForm = () => null;',
          reasoning: 'spec 요구사항',
        },
      ],
    };
    expect(implementResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('빈 patches 배열 거부', () => {
    const bad = {
      name: 'claude_1',
      label: 'claude_1',
      summary: 'no-op',
      patches: [],
    };
    const result = implementResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('빈 summary 거부', () => {
    const bad = {
      name: 'claude_1',
      label: 'claude_1',
      summary: '',
      patches: [
        {
          operation: 'modify' as const,
          targetPath: 'src/foo.ts',
          newContent: 'x',
          reasoning: '',
        },
      ],
    };
    expect(implementResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('알 수 없는 operation 거부', () => {
    const bad = {
      name: 'claude_1',
      label: 'claude_1',
      summary: 'x',
      patches: [
        {
          operation: 'rename',
          targetPath: 'src/foo.ts',
          reasoning: '',
        },
      ],
    };
    expect(implementResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('strict mode — extra 필드 거부', () => {
    const bad = {
      name: 'claude_1',
      label: 'claude_1',
      summary: 'x',
      patches: [
        {
          operation: 'modify' as const,
          targetPath: 'src/foo.ts',
          newContent: 'x',
          reasoning: '',
          extraField: 'should reject',
        },
      ],
    };
    expect(implementResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('delete 시 newContent 생략 가능', () => {
    const ok = {
      name: 'gemini_1',
      label: 'gemini_1',
      summary: '파일 삭제',
      patches: [
        {
          operation: 'delete' as const,
          targetPath: 'src/dead.ts',
          reasoning: '사용 안 함',
        },
      ],
    };
    expect(implementResponseSchema.safeParse(ok).success).toBe(true);
  });
});

// ── buildImplementPromptBody ────────────────────────────────────────

describe('buildImplementPromptBody', () => {
  function buildCtx(card: MissionCard): ImplementMissionContext {
    return {
      missionCard: card,
      speakerDisplayName: 'claude_1',
      suggestedLabel: 'claude_1',
      inputFileSnippets: [],
    };
  }

  it("kind='spec' — 헤더 + planning 회의록 prepend", () => {
    const out = buildImplementPromptBody(buildCtx(SPEC_CARD));
    expect(out).toContain('구현 부서 — 기획 → 구현 정상 chain');
    expect(out).toContain('[참고 회의록 — planning]');
    expect(out).toContain('로그인 폼 추가');
  });

  it("kind='fix' — audit 회의록 + 문제 list prepend", () => {
    const out = buildImplementPromptBody(buildCtx(FIX_CARD));
    expect(out).toContain('구현 부서 — audit NG → 재기획 후 수정');
    expect(out).toContain('[참고 회의록 — audit]');
    expect(out).toContain('[문제 list]');
    expect(out).toContain('subprocess kill leak');
    expect(out).toContain('opinion-uuid-2');
  });

  it("kind='change-request' — 사용자 메시지 prepend", () => {
    const out = buildImplementPromptBody(buildCtx(CHANGE_CARD));
    expect(out).toContain('구현 부서 — 사용자 변경 요청');
    expect(out).toContain('[사용자 메시지]');
    expect(out).toContain('로그인 버튼 빨간색으로');
  });

  it('inputFiles list 표시 (빈 배열은 헤더 미출력)', () => {
    const withFiles = buildImplementPromptBody(buildCtx(SPEC_CARD));
    expect(withFiles).toContain('[입력 파일 list]');
    expect(withFiles).toContain('- src/auth/login.ts');

    const noFiles = buildImplementPromptBody(buildCtx(CHANGE_CARD));
    expect(noFiles).not.toContain('[입력 파일 list]');
  });

  it('inputFileSnippets 본문 합성', () => {
    const ctx: ImplementMissionContext = {
      ...buildCtx(SPEC_CARD),
      inputFileSnippets: [
        { path: 'src/auth/login.ts', content: 'export const x = 1;' },
      ],
    };
    const out = buildImplementPromptBody(ctx);
    expect(out).toContain('[입력 파일 본문]');
    expect(out).toContain('--- src/auth/login.ts');
    expect(out).toContain('export const x = 1;');
  });

  it('출력 기대치 list 표시 (빈 배열은 헤더 미출력)', () => {
    const withExpect = buildImplementPromptBody(buildCtx(SPEC_CARD));
    expect(withExpect).toContain('[출력 기대치]');
    expect(withExpect).toContain('login form react component');

    const noExpect = buildImplementPromptBody(buildCtx(CHANGE_CARD));
    expect(noExpect).not.toContain('[출력 기대치]');
  });

  it('응답 schema 안내 + truncate 금지 안내 포함', () => {
    const out = buildImplementPromptBody(buildCtx(SPEC_CARD));
    expect(out).toContain('응답은 *JSON 한 객체만*');
    expect(out).toContain('절대 경로 / `..` traversal 은 시스템이 거부합니다.');
    expect(out).toContain('`patches` 길이 ≥ 1 필수');
    expect(out).toContain('truncate 금지');
  });

  it('speakerDisplayName / suggestedLabel 의 따옴표는 escape', () => {
    const ctx: ImplementMissionContext = {
      ...buildCtx(SPEC_CARD),
      speakerDisplayName: 'name with "quote"',
      suggestedLabel: 'label\\back',
    };
    const out = buildImplementPromptBody(ctx);
    expect(out).toContain('"name": "name with \\"quote\\""');
    expect(out).toContain('"label": "label\\\\back"');
  });
});

// ── extractImplementPatchEntries ────────────────────────────────────

describe('extractImplementPatchEntries', () => {
  function buildResp(
    patches: ImplementResponse['patches'],
  ): ImplementResponse {
    return {
      name: 'claude_1',
      label: 'claude_1',
      summary: 'x',
      patches,
    };
  }

  it('상대 경로 → workspaceRoot 와 join 한 절대 경로 entry 생성', () => {
    const entries = extractImplementPatchEntries({
      response: buildResp([
        {
          operation: 'create',
          targetPath: 'src/foo.ts',
          newContent: 'x',
          reasoning: 'r',
        },
      ]),
      workspaceRoot: WORKSPACE_ROOT,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].targetPath).toBe(`${WORKSPACE_ROOT}/src/foo.ts`);
    expect(entries[0].operation).toBe('create');
    expect(entries[0].newContent).toBe('x');
  });

  it('delete 시 newContent 무시 + entry newContent undefined', () => {
    const entries = extractImplementPatchEntries({
      response: buildResp([
        {
          operation: 'delete',
          targetPath: 'src/dead.ts',
          newContent: 'ignored',
          reasoning: 'r',
        },
      ]),
      workspaceRoot: WORKSPACE_ROOT,
    });
    expect(entries[0].newContent).toBeUndefined();
  });

  it('절대 경로 거부', () => {
    expect(() =>
      extractImplementPatchEntries({
        response: buildResp([
          {
            operation: 'modify',
            targetPath: '/etc/passwd',
            newContent: 'pwned',
            reasoning: '',
          },
        ]),
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('`..` traversal 거부 (workspaceRoot escape)', () => {
    expect(() =>
      extractImplementPatchEntries({
        response: buildResp([
          {
            operation: 'modify',
            targetPath: '../sibling/foo.ts',
            newContent: 'x',
            reasoning: '',
          },
        ]),
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('빈 targetPath 거부', () => {
    expect(() =>
      extractImplementPatchEntries({
        response: buildResp([
          {
            operation: 'modify',
            targetPath: '   ',
            newContent: 'x',
            reasoning: '',
          },
        ]),
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('create / modify 시 newContent 누락 throw', () => {
    expect(() =>
      extractImplementPatchEntries({
        response: buildResp([
          {
            operation: 'create',
            targetPath: 'src/foo.ts',
            reasoning: '',
          },
        ]),
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('workspaceRoot 자체가 비어 있거나 상대경로면 throw', () => {
    const resp = buildResp([
      {
        operation: 'create',
        targetPath: 'src/foo.ts',
        newContent: 'x',
        reasoning: '',
      },
    ]);
    expect(() =>
      extractImplementPatchEntries({ response: resp, workspaceRoot: '' }),
    ).toThrow(ImplementResponseInvariantError);
    expect(() =>
      extractImplementPatchEntries({
        response: resp,
        workspaceRoot: 'relative/path',
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('`./` 시작 정규화 후 통과', () => {
    const entries = extractImplementPatchEntries({
      response: buildResp([
        {
          operation: 'create',
          targetPath: './src/bar.ts',
          newContent: 'x',
          reasoning: '',
        },
      ]),
      workspaceRoot: WORKSPACE_ROOT,
    });
    expect(entries[0].targetPath).toBe(`${WORKSPACE_ROOT}/src/bar.ts`);
  });
});

// ── buildImplementPatchSet ──────────────────────────────────────────

describe('buildImplementPatchSet', () => {
  const sampleEntries = [
    {
      operation: 'create' as const,
      targetPath: `${WORKSPACE_ROOT}/src/x.ts`,
      newContent: 'x',
    },
  ];

  it('dryRun=true PatchSet wrapper', () => {
    const set = buildImplementPatchSet({
      entries: sampleEntries,
      operationId: 'op-1',
      aiId: 'claude',
      conversationId: 'conv-1',
      dryRun: true,
    });
    expect(set.dryRun).toBe(true);
    expect(set.entries).toEqual(sampleEntries);
    expect(set.operationId).toBe('op-1');
  });

  it('dryRun=false PatchSet wrapper', () => {
    const set = buildImplementPatchSet({
      entries: sampleEntries,
      operationId: 'op-2',
      aiId: 'claude',
      conversationId: 'conv-1',
      dryRun: false,
    });
    expect(set.dryRun).toBe(false);
  });

  it('빈 entries 거부', () => {
    expect(() =>
      buildImplementPatchSet({
        entries: [],
        operationId: 'op-1',
        aiId: 'claude',
        conversationId: 'conv-1',
        dryRun: true,
      }),
    ).toThrow(ImplementResponseInvariantError);
  });

  it('빈 metadata 거부 (operationId/aiId/conversationId)', () => {
    const ok = {
      entries: sampleEntries,
      operationId: 'op-1',
      aiId: 'claude',
      conversationId: 'conv-1',
      dryRun: true,
    };
    expect(() => buildImplementPatchSet({ ...ok, operationId: '' })).toThrow(
      ImplementResponseInvariantError,
    );
    expect(() => buildImplementPatchSet({ ...ok, aiId: '   ' })).toThrow(
      ImplementResponseInvariantError,
    );
    expect(() =>
      buildImplementPatchSet({ ...ok, conversationId: '' }),
    ).toThrow(ImplementResponseInvariantError);
  });
});

// ── ImplementApplyPending ───────────────────────────────────────────

describe('ImplementApplyPending', () => {
  const approve: ImplementApplyDecision = { approved: true };
  const reject: ImplementApplyDecision = {
    approved: false,
    reason: 'user denied',
  };

  it('초기 상태 — pristine (waiting=false / settled=false)', () => {
    const p = new ImplementApplyPending();
    expect(p.isSettled).toBe(false);
    expect(p.isWaiting).toBe(false);
  });

  it('wait() → isWaiting=true', () => {
    const p = new ImplementApplyPending();
    void p.wait();
    expect(p.isWaiting).toBe(true);
    expect(p.isSettled).toBe(false);
  });

  it('commit(approve) → wait() resolve + settled', async () => {
    const p = new ImplementApplyPending();
    const promise = p.wait();
    p.commit(approve);
    await expect(promise).resolves.toEqual(approve);
    expect(p.isSettled).toBe(true);
    expect(p.isWaiting).toBe(false);
  });

  it('commit(reject) → resolve 로 reject 결정 carry', async () => {
    const p = new ImplementApplyPending();
    const promise = p.wait();
    p.commit(reject);
    await expect(promise).resolves.toEqual(reject);
  });

  it('cancel({aborted}) → wait() reject + settled', async () => {
    const p = new ImplementApplyPending();
    const promise = p.wait();
    p.cancel({ kind: 'aborted' });
    await expect(promise).rejects.toEqual({ kind: 'aborted' });
    expect(p.isSettled).toBe(true);
  });

  it('cancel({replaced, message}) → reject reason carry', async () => {
    const p = new ImplementApplyPending();
    const promise = p.wait();
    const reason = { kind: 'replaced' as const, message: 'user reset' };
    p.cancel(reason);
    await expect(promise).rejects.toEqual(reason);
  });

  it('settled 후 wait() 재호출 throw (single-use)', () => {
    const p = new ImplementApplyPending();
    void p.wait();
    p.commit(approve);
    expect(() => p.wait()).toThrow(/single-use/);
  });

  it('settled 후 commit() 재호출 throw (duplicate)', () => {
    const p = new ImplementApplyPending();
    void p.wait();
    p.commit(approve);
    expect(() => p.commit(approve)).toThrow(/duplicate commit|settled/);
  });

  it('wait() 전 commit() throw (race)', () => {
    const p = new ImplementApplyPending();
    expect(() => p.commit(approve)).toThrow(/before wait/);
  });

  it('settled / pristine 상태 cancel() no-op', () => {
    const p1 = new ImplementApplyPending();
    void p1.wait();
    p1.commit(approve);
    expect(() => p1.cancel({ kind: 'aborted' })).not.toThrow();
    expect(p1.isSettled).toBe(true);

    const p2 = new ImplementApplyPending();
    expect(() => p2.cancel({ kind: 'aborted' })).not.toThrow();
    expect(p2.isSettled).toBe(false);
  });
});

// ── role guard + capability mapping ─────────────────────────────────

describe('isImplementDepartmentRole', () => {
  it("role==='implement' → true", () => {
    expect(isImplementDepartmentRole('implement')).toBe(true);
  });

  it('다른 부서 / null → false', () => {
    expect(isImplementDepartmentRole('planning')).toBe(false);
    expect(isImplementDepartmentRole('design.ui')).toBe(false);
    expect(isImplementDepartmentRole('audit')).toBe(false);
    expect(isImplementDepartmentRole(null)).toBe(false);
  });
});

describe('capabilityForMissionKind', () => {
  it('모든 kind → "implement" capability (R12-C2 시점)', () => {
    expect(capabilityForMissionKind('spec')).toBe('implement');
    expect(capabilityForMissionKind('fix')).toBe('implement');
    expect(capabilityForMissionKind('change-request')).toBe('implement');
  });
});
