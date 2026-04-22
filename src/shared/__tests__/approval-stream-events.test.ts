/**
 * R7-Task1 — approval-stream-events zod round-trip + rejection tests.
 */
import { describe, it, expect } from 'vitest';

import {
  approvalItemSchema,
  approvalKindSchema,
  approvalPayloadSchema,
  cliPermissionPayloadSchema,
  consensusDecisionPayloadSchema,
  modeTransitionPayloadSchema,
  streamApprovalCreatedSchema,
  streamApprovalDecidedSchema,
} from '../approval-stream-events';
import type {
  CliPermissionApprovalPayload,
  ConsensusDecisionApprovalPayload,
  ModeTransitionApprovalPayload,
  TypedApprovalItem,
} from '../approval-types';

const cliPayload: CliPermissionApprovalPayload = {
  kind: 'cli_permission',
  cliRequestId: 'req-abc-1',
  toolName: 'Edit',
  target: 'src/main/index.ts',
  description: 'Rewrite imports',
  participantId: 'provider-claude',
  participantName: 'Claude',
};

const modePayload: ModeTransitionApprovalPayload = {
  kind: 'mode_transition',
  currentMode: 'hybrid',
  targetMode: 'approval',
  reason: 'Senior review requested',
};

const consensusPayload: ConsensusDecisionApprovalPayload = {
  kind: 'consensus_decision',
  snapshotHash: 'a1b2c3d4',
  finalText: 'The team agrees to ship v1.0 behind a feature flag.',
  votes: { yes: 3, no: 0, pending: 1 },
};

describe('approval-stream-events / kind schema', () => {
  it('accepts all 5 kinds (R7 3 + R8+ 2 reserved)', () => {
    for (const k of [
      'cli_permission',
      'mode_transition',
      'consensus_decision',
      'review_outcome',
      'failure_report',
    ] as const) {
      expect(approvalKindSchema.parse(k)).toBe(k);
    }
  });

  it('rejects unknown kinds', () => {
    expect(() => approvalKindSchema.parse('bogus')).toThrow();
  });
});

describe('approval-stream-events / payload union', () => {
  it('round-trips cli_permission payload', () => {
    expect(cliPermissionPayloadSchema.parse(cliPayload)).toEqual(cliPayload);
    expect(approvalPayloadSchema.parse(cliPayload)).toEqual(cliPayload);
  });

  it('round-trips mode_transition payload (with and without reason)', () => {
    expect(modeTransitionPayloadSchema.parse(modePayload)).toEqual(modePayload);
    const { reason: _reason, ...minimal } = modePayload;
    expect(approvalPayloadSchema.parse(minimal)).toEqual(minimal);
  });

  it('round-trips consensus_decision payload', () => {
    expect(consensusDecisionPayloadSchema.parse(consensusPayload)).toEqual(
      consensusPayload,
    );
    expect(approvalPayloadSchema.parse(consensusPayload)).toEqual(consensusPayload);
  });

  it('rejects payload with wrong kind literal', () => {
    expect(() =>
      approvalPayloadSchema.parse({ ...cliPayload, kind: 'mode_transition' }),
    ).toThrow();
  });

  it('rejects payload missing required field', () => {
    const { cliRequestId: _omit, ...broken } = cliPayload;
    expect(() => approvalPayloadSchema.parse(broken)).toThrow();
  });

  it('rejects consensus payload with negative vote count', () => {
    expect(() =>
      approvalPayloadSchema.parse({
        ...consensusPayload,
        votes: { yes: -1, no: 0, pending: 0 },
      }),
    ).toThrow();
  });
});

describe('approval-stream-events / ApprovalItem schema', () => {
  it('round-trips a typed cli_permission item', () => {
    const item: TypedApprovalItem<'cli_permission'> = {
      id: 'apr-1',
      kind: 'cli_permission',
      projectId: 'prj-1',
      channelId: 'ch-1',
      meetingId: 'mtg-1',
      requesterId: 'provider-claude',
      payload: cliPayload,
      status: 'pending',
      decisionComment: null,
      createdAt: 1_700_000_000_000,
      decidedAt: null,
    };
    const parsed = approvalItemSchema.parse(item);
    expect(parsed).toEqual(item);
  });

  it('accepts payload: unknown (legacy compatibility)', () => {
    const item = {
      id: 'apr-2',
      kind: 'review_outcome' as const,
      projectId: null,
      channelId: null,
      meetingId: null,
      requesterId: null,
      payload: { arbitrary: 'legacy row' },
      status: 'pending' as const,
      decisionComment: null,
      createdAt: 1_700_000_000_000,
      decidedAt: null,
    };
    expect(() => approvalItemSchema.parse(item)).not.toThrow();
  });

  it('rejects ApprovalItem with empty id', () => {
    expect(() =>
      approvalItemSchema.parse({
        id: '',
        kind: 'cli_permission',
        projectId: null,
        channelId: null,
        meetingId: null,
        requesterId: null,
        payload: cliPayload,
        status: 'pending',
        decisionComment: null,
        createdAt: 0,
        decidedAt: null,
      }),
    ).toThrow();
  });
});

describe('approval-stream-events / stream:approval-* payloads', () => {
  const sampleItem = {
    id: 'apr-3',
    kind: 'consensus_decision' as const,
    projectId: 'prj-1',
    channelId: 'ch-1',
    meetingId: 'mtg-1',
    requesterId: null,
    payload: consensusPayload,
    status: 'pending' as const,
    decisionComment: null,
    createdAt: 1_700_000_000_000,
    decidedAt: null,
  };

  it('round-trips stream:approval-created', () => {
    const evt = { item: sampleItem };
    expect(streamApprovalCreatedSchema.parse(evt)).toEqual(evt);
  });

  it('round-trips stream:approval-decided with all 3 decisions', () => {
    for (const decision of ['approve', 'reject', 'conditional'] as const) {
      const evt = {
        item: { ...sampleItem, status: 'approved' as const, decidedAt: 1_700_000_001_000 },
        decision,
        comment: decision === 'approve' ? null : 'user comment',
      };
      expect(streamApprovalDecidedSchema.parse(evt)).toEqual(evt);
    }
  });

  it('rejects stream:approval-decided without decision', () => {
    expect(() =>
      streamApprovalDecidedSchema.parse({ item: sampleItem, comment: null }),
    ).toThrow();
  });
});
