/**
 * R11-Task5: zod round-trip 테스트 — 8 신규 IPC 채널 + ProviderCapability
 * union 의 'summarize' 추가 확인.
 *
 * R10 의 `r10-ipc-schemas.test.ts` 와 동일한 safeParse 패턴. 각 채널마다
 * (a) valid payload 가 parse 되는지, (b) invalid payload 가 reject 되는지
 * 의 쌍으로 작성한다. 8 채널 × 2~3 cases = 18+ cases.
 */
import { describe, it, expect } from 'vitest';
import {
  onboardingGetStateSchema,
  onboardingSetStateSchema,
  onboardingCompleteSchema,
  providerDetectSchema,
  llmCostSummarySchema,
  executionDryRunPreviewSchema,
  approvalDetailFetchSchema,
  meetingVotingHistorySchema,
  v3ChannelSchemas,
} from '../ipc-schemas';
import type { ProviderCapability } from '../provider-types';
import type { OnboardingState } from '../onboarding-types';
import type { LlmCostSummary, LlmCostAuditEntry } from '../llm-cost-types';
import type {
  ApprovalDetail,
  ApprovalImpactedFile,
  ApprovalDiffPreview,
  ApprovalConsensusContext,
  ApprovalListFilter,
} from '../approval-detail-types';

describe('R11 IPC — onboarding:get-state schema', () => {
  it('accepts undefined request (no input)', () => {
    expect(onboardingGetStateSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects any object on the wire', () => {
    expect(onboardingGetStateSchema.safeParse({}).success).toBe(false);
  });
});

describe('R11 IPC — onboarding:set-state schema', () => {
  it('accepts a partial with currentStep only', () => {
    const r = onboardingSetStateSchema.safeParse({
      partial: { currentStep: 2 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a partial with full selections', () => {
    const r = onboardingSetStateSchema.safeParse({
      partial: {
        currentStep: 5,
        selections: {
          staff: ['ai-claude', 'ai-codex'],
          roles: { 'ai-claude': '시니어' },
          permissions: 'hybrid',
          firstProject: { slug: 'demo', kind: 'new' },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty partial', () => {
    const r = onboardingSetStateSchema.safeParse({ partial: {} });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range currentStep', () => {
    const r = onboardingSetStateSchema.safeParse({
      partial: { currentStep: 6 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown permission mode', () => {
    const r = onboardingSetStateSchema.safeParse({
      partial: {
        selections: { permissions: 'unknown_mode' },
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('R11 IPC — onboarding:complete schema', () => {
  it('accepts undefined request', () => {
    expect(onboardingCompleteSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects payload', () => {
    expect(onboardingCompleteSchema.safeParse({ force: true }).success).toBe(
      false,
    );
  });
});

describe('R11 IPC — provider:detect schema', () => {
  it('accepts undefined request', () => {
    expect(providerDetectSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects object payload', () => {
    expect(providerDetectSchema.safeParse({}).success).toBe(false);
  });
});

describe('R11 IPC — llm:cost-summary schema', () => {
  it('accepts undefined (service uses default period)', () => {
    expect(llmCostSummarySchema.safeParse(undefined).success).toBe(true);
  });

  it('accepts periodDays in valid range', () => {
    expect(llmCostSummarySchema.safeParse({ periodDays: 30 }).success).toBe(
      true,
    );
  });

  it('rejects negative periodDays', () => {
    expect(llmCostSummarySchema.safeParse({ periodDays: -1 }).success).toBe(
      false,
    );
  });

  it('rejects periodDays beyond 365', () => {
    expect(llmCostSummarySchema.safeParse({ periodDays: 400 }).success).toBe(
      false,
    );
  });

  it('rejects non-integer periodDays', () => {
    expect(llmCostSummarySchema.safeParse({ periodDays: 7.5 }).success).toBe(
      false,
    );
  });
});

describe('R11 IPC — execution:dry-run-preview schema', () => {
  it('accepts a plain approvalId', () => {
    expect(
      executionDryRunPreviewSchema.safeParse({ approvalId: 'app-1' }).success,
    ).toBe(true);
  });

  it('rejects empty approvalId', () => {
    expect(
      executionDryRunPreviewSchema.safeParse({ approvalId: '' }).success,
    ).toBe(false);
  });

  it('rejects missing approvalId', () => {
    expect(executionDryRunPreviewSchema.safeParse({}).success).toBe(false);
  });
});

describe('R11 IPC — approval:detail-fetch schema', () => {
  it('accepts a plain approvalId', () => {
    expect(
      approvalDetailFetchSchema.safeParse({ approvalId: 'app-2' }).success,
    ).toBe(true);
  });

  it('rejects approvalId longer than 128 chars', () => {
    expect(
      approvalDetailFetchSchema.safeParse({ approvalId: 'x'.repeat(129) })
        .success,
    ).toBe(false);
  });
});

describe('R11 IPC — meeting:voting-history schema', () => {
  it('accepts a plain meetingId', () => {
    expect(
      meetingVotingHistorySchema.safeParse({ meetingId: 'm-1' }).success,
    ).toBe(true);
  });

  it('rejects empty meetingId', () => {
    expect(
      meetingVotingHistorySchema.safeParse({ meetingId: '' }).success,
    ).toBe(false);
  });
});

describe('R11 IPC — v3ChannelSchemas registry parity', () => {
  it('has all 8 R11 channels registered', () => {
    expect(v3ChannelSchemas['onboarding:get-state']).toBeDefined();
    expect(v3ChannelSchemas['onboarding:set-state']).toBeDefined();
    expect(v3ChannelSchemas['onboarding:complete']).toBeDefined();
    expect(v3ChannelSchemas['provider:detect']).toBeDefined();
    expect(v3ChannelSchemas['llm:cost-summary']).toBeDefined();
    expect(v3ChannelSchemas['execution:dry-run-preview']).toBeDefined();
    expect(v3ChannelSchemas['approval:detail-fetch']).toBeDefined();
    expect(v3ChannelSchemas['meeting:voting-history']).toBeDefined();
  });
});

describe('R11 shared — ProviderCapability union has summarize', () => {
  it('summarize literal is assignable to ProviderCapability', () => {
    const cap: ProviderCapability = 'summarize';
    expect(cap).toBe('summarize');
  });

  it('streaming + summarize coexist (Task 9 will swap usage)', () => {
    const caps: ProviderCapability[] = ['streaming', 'summarize'];
    expect(caps).toHaveLength(2);
  });
});

describe('R11 shared — Onboarding / LLM cost / Approval detail type shape', () => {
  it('OnboardingState compiles with empty selections', () => {
    const state: OnboardingState = {
      completed: false,
      currentStep: 1,
      selections: {},
      updatedAt: 0,
    };
    expect(state.completed).toBe(false);
  });

  it('LlmCostAuditEntry + LlmCostSummary compile with null estimatedUsd', () => {
    const entry: LlmCostAuditEntry = {
      id: 1,
      meetingId: null,
      providerId: 'ai-claude',
      tokenIn: 100,
      tokenOut: 200,
      createdAt: 1,
    };
    const summary: LlmCostSummary = {
      byProvider: [
        {
          providerId: 'ai-claude',
          tokenIn: entry.tokenIn,
          tokenOut: entry.tokenOut,
          estimatedUsd: null,
        },
      ],
      totalTokens: 300,
      periodStartAt: 0,
      periodEndAt: 1,
    };
    expect(summary.byProvider[0].estimatedUsd).toBeNull();
  });

  it('ApprovalDetail compiles with null consensusContext (stand-alone)', () => {
    const file: ApprovalImpactedFile = {
      path: 'a.ts',
      addedLines: 1,
      removedLines: 0,
      changeKind: 'added',
    };
    const preview: ApprovalDiffPreview = {
      path: 'a.ts',
      preview: '+ x',
      truncated: false,
    };
    const context: ApprovalConsensusContext = {
      meetingId: null,
      participantVotes: [
        { providerId: 'ai-claude', vote: 'approve' },
        { providerId: 'ai-codex', vote: 'reject', comment: 'risky' },
      ],
    };
    const detail: ApprovalDetail = {
      approval: {
        id: 'a-1',
        kind: 'mode_transition',
        projectId: 'p-1',
        channelId: null,
        meetingId: null,
        requesterId: null,
        payload: null,
        status: 'pending',
        decisionComment: null,
        createdAt: 0,
        decidedAt: null,
      },
      impactedFiles: [file],
      diffPreviews: [preview],
      consensusContext: null,
    };
    const filter: ApprovalListFilter = { status: 'pending' };
    expect(detail.consensusContext).toBeNull();
    expect(context.participantVotes).toHaveLength(2);
    expect(filter.status).toBe('pending');
  });
});
