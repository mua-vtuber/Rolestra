import { describe, expect, it } from 'vitest';

import {
  PlanningDesignCheckResponseSchema,
  buildPlanningDesignCheckPromptBody,
  normalizePlanningDesignCheckResult,
} from '../planning-design-check-workflow';
import type { PlanningDesignCheckRecord } from '../../../../shared/planning-design-check-types';

const request: PlanningDesignCheckRecord = {
  id: 'check-1',
  projectId: 'project-1',
  sourceDesignMeetingId: 'design-meeting-1',
  designChannelId: 'design-channel',
  designChannelRole: 'design.ui',
  planningChannelId: 'planning-channel',
  implementationChannelId: 'implement-channel',
  requestTitle: '디자인 검수 요청서',
  requestBody:
    '# 디자인 검수 요청서\n\n## 원래 기획 회의록\n# original planning\n\n사용자 와이어프레임 수정 지시: 목록 밀도를 높여줘.',
  finalDesignMinutesPath: '/tmp/minutes-2.md',
  finalDesignMinutesBody: '# final design',
  snapshotDesktopPath: '/tmp/desktop.png',
  snapshotMobilePath: '/tmp/mobile.png',
  wireframeCheckpointsJson: '[]',
  wireframeUserNotesJson: '[{"userNote":"목록 밀도를 높여줘."}]',
  workBundleKey: 'planning-minutes:planning-meeting-1',
  originalPlanningMinutesId: 'planning-meeting-1',
  originalPlanningMinutesPath: '/tmp/planning-minutes.md',
  originalPlanningMinutesBody: '# original planning',
  originalPlanningMinutesMissingReason: null,
  returnCount: 0,
  verdict: null,
  status: 'request_created',
  reason: null,
  revisionDirection: null,
  implementationDispatchId: null,
  designReturnDispatchId: null,
  userDecision: null,
  userDecisionNote: null,
  userDecisionDispatchId: null,
  payloadJson: null,
  createdAt: 1,
  decidedAt: null,
};

describe('planning-design-check workflow', () => {
  it('prompt에 디자인 검수 요청서와 JSON verdict 계약을 포함한다', () => {
    const body = buildPlanningDesignCheckPromptBody({
      request,
      speaker: {
        id: 'planner-1',
        providerId: 'planner-1',
        displayName: 'Planner',
        isActive: true,
      },
      suggestedLabel: 'planner-1_1',
    });

    expect(body).toContain('기획 검수');
    expect(body).toContain('디자인 검수 요청서');
    expect(body).toContain('original planning');
    expect(body).toContain('목록 밀도를 높여줘');
    expect(body).toContain('"verdict": "aligned"');
  });

  it('misaligned는 revision_direction을 요구한다', () => {
    const parsed = PlanningDesignCheckResponseSchema.safeParse({
      name: 'Planner',
      label: 'planner_1',
      verdict: 'misaligned',
      reason: '의도와 다름',
    });

    expect(parsed.success).toBe(false);
  });

  it('aligned / misaligned 결과를 정규화한다', () => {
    expect(
      normalizePlanningDesignCheckResult({
        name: 'Planner',
        label: 'planner_1',
        verdict: 'aligned',
        reason: '  의도에 맞음  ',
      }),
    ).toEqual({
      verdict: 'aligned',
      reason: '의도에 맞음',
      revisionDirection: null,
    });

    expect(
      normalizePlanningDesignCheckResult({
        name: 'Planner',
        label: 'planner_2',
        verdict: 'misaligned',
        reason: '의도와 다름',
        revision_direction: '  디자인 되돌림  ',
      }),
    ).toEqual({
      verdict: 'misaligned',
      reason: '의도와 다름',
      revisionDirection: '디자인 되돌림',
    });
  });
});
