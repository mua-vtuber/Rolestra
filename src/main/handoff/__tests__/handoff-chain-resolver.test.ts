/**
 * handoff-chain-resolver 단위 테스트 — R12-C2 P6 T28 land.
 *
 * 검증 (순수 함수 + caller injection):
 *   - resolveHandoffChain 입력 invariant — generatedAt 음수 / NaN / projectId blank
 *   - workflowKind 분기:
 *       review            → no_chain reason='review_outside_chain'
 *       general           → no_chain reason='general_outside_chain'
 *       audit  ok         → no_chain reason='audit_verdict_ok'
 *       audit  ng + planning channel resolved → chain_resolved + HandoffPackage
 *       audit  ng + planning resolver returns null → throw
 *       idea / planning / design / implement → no_chain reason=*_unhandled (placeholder)
 *   - audit invariant:
 *       sender.channelRole !== 'audit' → throw
 *       auditInput 미지정 → throw
 *   - HandoffPackage 합성 시 mode + channelId 가 receiver lookup 결과로 들어감
 *   - HandoffPackage.missionCard.targetChannelId === target.channelId 일관성
 *
 * actual dispatch / IPC / orchestrator wire 는 후속 sub-task — 본 모듈은 *plan*
 * 만 만든다 (T25 audit-handoff-dispatch 와 동일 thin module 정책).
 */

import { describe, expect, it } from 'vitest';
import {
  HandoffChainResolverInvariantError,
  resolveHandoffChain,
  type ChainResolverInput,
  type ResolvedReceiverChannel,
} from '../handoff-chain-resolver';
import type { HandoffSender } from '../../../shared/schema/handoff-package';
import type { Opinion } from '../../../shared/opinion-types';

// ── shared fixtures ─────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;
const MISSION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const auditSender: HandoffSender & { projectId: string } = {
  meetingId: 'audit-meeting-1',
  channelId: 'audit-channel-1',
  channelRole: 'audit',
  projectId: 'proj-1',
};

const auditOpinionAgreed: Opinion = {
  id: 'op-A',
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
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const auditOpinionExcluded: Opinion = {
  ...auditOpinionAgreed,
  id: 'op-B',
  status: 'excluded',
  exclusionReason: '논의 결과 수용 가능',
};

const planningReceiver: ResolvedReceiverChannel = {
  channelId: 'planning-channel-1',
  handoffMode: 'check',
  assignedProviderId: 'codex',
};

function baseInput(
  override: Partial<ChainResolverInput> = {},
): ChainResolverInput {
  return {
    workflowKind: 'audit',
    sender: auditSender,
    auditInput: {
      opinions: [auditOpinionAgreed],
      auditMinutesMarkdown: '## [합의]\n- 하드코딩 1 건\n## [제외]\n(없음)\n',
    },
    resolveReceiverChannel: () => planningReceiver,
    missionCardIdFactory: () => MISSION_UUID,
    generatedAt: FIXED_NOW,
    ...override,
  };
}

// ── 입력 invariant ─────────────────────────────────────────────────

describe('resolveHandoffChain — input invariants', () => {
  it('generatedAt 음수 → throw', () => {
    expect(() => resolveHandoffChain(baseInput({ generatedAt: -1 }))).toThrow(
      HandoffChainResolverInvariantError,
    );
  });

  it('generatedAt NaN → throw', () => {
    expect(() => resolveHandoffChain(baseInput({ generatedAt: Number.NaN }))).toThrow(
      HandoffChainResolverInvariantError,
    );
  });

  it('sender.projectId blank → throw', () => {
    expect(() =>
      resolveHandoffChain(
        baseInput({ sender: { ...auditSender, projectId: '   ' } }),
      ),
    ).toThrow(HandoffChainResolverInvariantError);
  });
});

// ── workflowKind 분기 — chain 외 (review / general) ────────────────

describe('resolveHandoffChain — chain 외 부서', () => {
  it("workflowKind='review' → no_chain reason='review_outside_chain'", () => {
    const result = resolveHandoffChain(
      baseInput({
        workflowKind: 'review',
        sender: { ...auditSender, channelRole: 'review' },
        auditInput: undefined,
      }),
    );
    expect(result).toEqual({
      kind: 'no_chain',
      reason: 'review_outside_chain',
    });
  });

  it("workflowKind='general' → no_chain reason='general_outside_chain'", () => {
    const result = resolveHandoffChain(
      baseInput({
        workflowKind: 'general',
        sender: { ...auditSender, channelRole: null },
        auditInput: undefined,
      }),
    );
    expect(result).toEqual({
      kind: 'no_chain',
      reason: 'general_outside_chain',
    });
  });
});

// ── workflowKind 분기 — placeholder (idea / planning / design / implement) ─

describe('resolveHandoffChain — placeholder (T28 시점 미구현)', () => {
  it.each([
    ['idea', 'idea', 'idea_chain_unhandled'] as const,
    ['planning', 'planning', 'planning_chain_unhandled'] as const,
    ['design', 'design.ui', 'design_chain_unhandled'] as const,
    ['implement', 'implement', 'implement_chain_unhandled'] as const,
  ])(
    "workflowKind='%s' (sender.role=%s) → no_chain reason='%s'",
    (kind, role, reason) => {
      const result = resolveHandoffChain(
        baseInput({
          workflowKind: kind,
          sender: { ...auditSender, channelRole: role },
          auditInput: undefined,
        }),
      );
      expect(result).toEqual({ kind: 'no_chain', reason });
    },
  );
});

// ── audit chain — verdict 분기 ─────────────────────────────────────

describe('resolveHandoffChain — audit chain', () => {
  it("verdict='ok' (excluded only) → no_chain reason='audit_verdict_ok'", () => {
    const result = resolveHandoffChain(
      baseInput({
        auditInput: {
          opinions: [auditOpinionExcluded],
          auditMinutesMarkdown: '## [합의]\n(없음)\n## [제외]\n- 1 건\n',
        },
      }),
    );
    expect(result).toEqual({
      kind: 'no_chain',
      reason: 'audit_verdict_ok',
    });
  });

  it("verdict='ng' + planning resolver null → throw (planning 부서 0 건 invariant)", () => {
    expect(() =>
      resolveHandoffChain(
        baseInput({
          resolveReceiverChannel: () => null,
        }),
      ),
    ).toThrow(HandoffChainResolverInvariantError);
  });

  it("verdict='ng' + planning resolved → chain_resolved + HandoffPackage", () => {
    const result = resolveHandoffChain(baseInput());
    if (result.kind !== 'chain_resolved') {
      throw new Error(`expected chain_resolved, got ${result.kind}`);
    }
    expect(result.package.target.channelId).toBe('planning-channel-1');
    expect(result.package.target.channelRole).toBe('planning');
    expect(result.package.sender.channelId).toBe('audit-channel-1');
    expect(result.package.sender.channelRole).toBe('audit');
    expect(result.package.mode).toBe('check');
    expect(result.package.dispatchedAt).toBe(FIXED_NOW);
    expect(result.package.minutesMeetingId).toBe('audit-meeting-1');
    expect(result.package.missionCard.targetChannelId).toBe(
      'planning-channel-1',
    );
    expect(result.package.missionCard.payload.kind).toBe('fix');
    expect(result.package.reason).toContain('1 건 문제 발견');
  });

  it("verdict='ng' + receiver mode='auto' → HandoffPackage.mode='auto'", () => {
    const result = resolveHandoffChain(
      baseInput({
        resolveReceiverChannel: () => ({
          ...planningReceiver,
          handoffMode: 'auto',
        }),
      }),
    );
    if (result.kind !== 'chain_resolved') {
      throw new Error(`expected chain_resolved, got ${result.kind}`);
    }
    expect(result.package.mode).toBe('auto');
  });

  it("workflowKind='audit' + auditInput 미지정 → throw", () => {
    expect(() =>
      resolveHandoffChain(baseInput({ auditInput: undefined })),
    ).toThrow(HandoffChainResolverInvariantError);
  });

  it("workflowKind='audit' + sender.channelRole !== 'audit' → throw", () => {
    expect(() =>
      resolveHandoffChain(
        baseInput({
          sender: { ...auditSender, channelRole: 'planning' },
        }),
      ),
    ).toThrow(HandoffChainResolverInvariantError);
  });

  it('mission card UUID 가 factory 결과를 그대로 사용', () => {
    let calls = 0;
    const result = resolveHandoffChain(
      baseInput({
        missionCardIdFactory: () => {
          calls += 1;
          return MISSION_UUID;
        },
      }),
    );
    expect(calls).toBe(1);
    if (result.kind === 'chain_resolved') {
      expect(result.package.missionCard.id).toBe(MISSION_UUID);
    }
  });
});
