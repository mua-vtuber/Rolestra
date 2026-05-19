import { z } from 'zod';
import type { Participant } from '../../../shared/engine-types';
import type {
  PlanningDesignCheckRecord,
  PlanningDesignCheckVerdict,
} from '../../../shared/planning-design-check-types';
import type {
  HandoffPackage,
  HandoffSender,
} from '../../../shared/schema/handoff-package';
import { buildHandoffPackage } from '../../../shared/schema/handoff-package';
import { buildMissionCard } from '../../../shared/schema/mission-card';
import type { ResolvedReceiverChannel } from '../../handoff/handoff-chain-resolver';
import { promptLabels } from '../../planning-design-check/planning-design-check-labels';

export const PlanningDesignCheckResponseSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    verdict: z.enum(['aligned', 'misaligned']),
    reason: z.string().min(1),
    revision_direction: z.string().optional(),
  })
  .refine(
    (value) =>
      value.verdict === 'aligned' ||
      (value.revision_direction ?? '').trim().length > 0,
    {
      message:
        'planning design check misaligned verdict requires revision_direction',
      path: ['revision_direction'],
    },
  );

export type PlanningDesignCheckResponseSchemaType = z.infer<
  typeof PlanningDesignCheckResponseSchema
>;

export interface PlanningDesignCheckPromptContext {
  request: PlanningDesignCheckRecord;
  speaker: Participant;
  suggestedLabel: string;
}

export function buildPlanningDesignCheckPromptBody(
  ctx: PlanningDesignCheckPromptContext,
): string {
  const labels = promptLabels();
  const lines: string[] = [];
  lines.push(labels.labelCurrentStep);
  lines.push('');
  lines.push(labels.labelMission);
  lines.push(labels.missionBodyLine1);
  lines.push(labels.missionBodyLine2);
  lines.push('');
  lines.push(labels.labelDesignReviewRequest);
  lines.push(ctx.request.requestBody);
  lines.push('');
  lines.push(labels.labelResponseFormat);
  lines.push(labels.responseFormatBody);
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(ctx.speaker.displayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "verdict": "aligned",');
  lines.push(`  "reason": "${labels.jsonPlaceholderReason}",`);
  lines.push(`  "revision_direction": "${labels.jsonPlaceholderRevision}"`);
  lines.push('}');
  lines.push('```');
  return lines.join('\n');
}

export function normalizePlanningDesignCheckResult(
  payload: PlanningDesignCheckResponseSchemaType,
): {
  verdict: Extract<PlanningDesignCheckVerdict, 'aligned' | 'misaligned'>;
  reason: string;
  revisionDirection: string | null;
} {
  return {
    verdict: payload.verdict,
    reason: payload.reason.trim(),
    revisionDirection:
      payload.verdict === 'misaligned'
        ? (payload.revision_direction ?? '').trim()
        : null,
  };
}

export function buildImplementationHandoffPackage(input: {
  request: PlanningDesignCheckRecord;
  implementationReceiver: ResolvedReceiverChannel;
  missionCardId: string;
  generatedAt: number;
}): HandoffPackage {
  const labels = promptLabels();
  const missionCard = buildMissionCard({
    id: input.missionCardId,
    payload: {
      kind: 'change-request',
      body: [
        labels.implementationHandoffIntro,
        '',
        input.request.requestBody,
        '',
        input.request.reason !== null
          ? `${labels.planningReviewReasonPrefix}: ${input.request.reason}`
          : labels.planningReviewReasonFallback,
      ].join('\n'),
      inputFiles: compact([
        input.request.originalPlanningMinutesPath,
        input.request.finalDesignMinutesPath,
        input.request.snapshotDesktopPath,
        input.request.snapshotMobilePath,
      ]),
      expectedOutputs: [
        labels.expectedOutputImplementationPlan,
        labels.expectedOutputHandoffUnits,
      ],
      userMessage: labels.implementationHandoffUserMessage,
    },
    assignedProviderId: input.implementationReceiver.assignedProviderId,
    targetChannelId: input.implementationReceiver.channelId,
    createdAt: input.generatedAt,
  });

  return buildHandoffPackage({
    sender: senderFromPlanningCheck(input.request),
    target: {
      channelId: input.implementationReceiver.channelId,
      channelRole: 'implement',
    },
    reason: '기획 검수 결과 의도에 맞음 — 구현 부서로 자동 인계합니다.',
    minutesMeetingId: input.request.sourceDesignMeetingId,
    nextActions: [],
    missionCard,
    mode: 'auto',
    dispatchedAt: input.generatedAt,
  });
}

export function buildDesignReturnHandoffPackage(input: {
  request: PlanningDesignCheckRecord;
  designReceiver: ResolvedReceiverChannel;
  missionCardId: string;
  generatedAt: number;
}): HandoffPackage {
  const userRequested =
    input.request.userDecision === 'request_design_revision';
  const missionCard = buildMissionCard({
    id: input.missionCardId,
    payload: {
      kind: 'change-request',
      body: [
        userRequested
          ? '사용자 판단에 따라 디자인 수정 요청을 다시 보냅니다.'
          : '기획 검수 결과 의도와 다름으로 판정되어 디자인 되돌림을 요청합니다.',
        '',
        `검수 사유: ${input.request.reason ?? '(사유 없음)'}`,
        `수정 방향: ${input.request.revisionDirection ?? '(수정 방향 없음)'}`,
        input.request.userDecisionNote !== null
          ? `사용자 판단 의견: ${input.request.userDecisionNote}`
          : null,
        '',
        '사용자 와이어프레임 수정 지시:',
        input.request.wireframeUserNotesJson,
        '',
        input.request.requestBody,
      ].join('\n'),
      inputFiles: compact([
        input.request.originalPlanningMinutesPath,
        input.request.finalDesignMinutesPath,
        input.request.snapshotDesktopPath,
        input.request.snapshotMobilePath,
      ]),
      expectedOutputs: [
        '기획 검수 의견을 반영한 수정 디자인',
        '사용자 와이어프레임 수정 지시 반영 여부',
      ],
      userMessage: userRequested
        ? '사용자 판단과 기획 검수 의견을 반영해 디자인을 다시 수정하세요.'
        : '기획 검수 의견과 사용자 와이어프레임 수정 지시를 반영해 디자인을 한 번 재작업하세요.',
    },
    assignedProviderId: input.designReceiver.assignedProviderId,
    targetChannelId: input.designReceiver.channelId,
    createdAt: input.generatedAt,
  });

  return buildHandoffPackage({
    sender: senderFromPlanningCheck(input.request),
    target: {
      channelId: input.designReceiver.channelId,
      channelRole: input.request.designChannelRole,
    },
    reason: userRequested
      ? '사용자 판단에 따른 디자인 수정 요청.'
      : '기획 검수 결과 의도와 다름 — 디자인 되돌림 1회 자동 실행.',
    minutesMeetingId: input.request.sourceDesignMeetingId,
    nextActions: [],
    missionCard,
    mode: 'auto',
    dispatchedAt: input.generatedAt,
  });
}

function senderFromPlanningCheck(
  request: PlanningDesignCheckRecord,
): HandoffSender & { projectId?: never } {
  return {
    meetingId: request.sourceDesignMeetingId,
    channelId: request.planningChannelId,
    channelRole: 'planning',
  };
}

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

function escapeForPrompt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
