/**
 * MeetingOrchestrator 단위 테스트 — R12-C2 T10a 통째 재작성.
 *
 * 옛 12 단계 SSM + WAIT_STATES + consensus_decision approval gate +
 * composeMinutes 의존 시나리오는 새 모델 (phase loop) 에서 의미 X. 본 파일은
 * 새 surface 의 happy-path + abort 분기만 커버 — turn-executor 와 OpinionService
 * 는 mock 으로 차단.
 */

import { describe, it, expect, vi } from 'vitest';
import { MeetingSession } from '../meeting-session';
import { HandoffPendingState } from '../../../handoff/handoff-pending-state';
import {
  MeetingOrchestrator,
  type MeetingOrchestratorDeps,
} from '../meeting-orchestrator';
import type { MeetingTurnExecutor } from '../meeting-turn-executor';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';
import type { StreamBridge } from '../../../streams/stream-bridge';
import type { MessageService } from '../../../channels/message-service';
import type { MeetingService } from '../../meeting-service';
import type { ChannelService } from '../../../channels/channel-service';
import type { ProjectService } from '../../../projects/project-service';
import type { NotificationService } from '../../../notifications/notification-service';
import type { OpinionService } from '../../opinion-service';
import type { MeetingMinutesService } from '../../meeting-minutes-service';
import type { Channel } from '../../../../shared/channel-types';
import type { Opinion } from '../../../../shared/opinion-types';
import type { RunStepService } from '../../run-step/run-step-service';
import type { RunStep, NewRunStep } from '../../../../shared/run-step-types';
import type { PlanningDesignCheckRecord } from '../../../../shared/planning-design-check-types';
import type { SourceHandoffContext } from '../../../../shared/handoff/source-handoff-context';

const MEETING_ID = 'mt-1';
const CHANNEL_ID = 'ch-1';
const PROJECT_ID = 'pr-1';

function ctx(): SsmContext {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    projectPath: '/tmp/project',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
  };
}

function participants(count = 2): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ai-${i + 1}`,
    providerId: `ai-${i + 1}`,
    displayName: `AI ${i + 1}`,
    isActive: true,
  }));
}

function buildSession(): MeetingSession {
  return new MeetingSession({
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    topic: 'Release planning',
    participants: participants(2),
    ssmCtx: ctx(),
    channelRole: null,
  });
}

function makeChannel(maxRounds: number | null = 5): Channel {
  return {
    id: CHANNEL_ID,
    projectId: PROJECT_ID,
    kind: 'department',
    name: '#planning',
    department: 'planning',
    maxRounds,
    handoffMode: 'check',
    pinned: false,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Channel;
}

function makeOpinion(id: string, overrides: Partial<Opinion> = {}): Opinion {
  return {
    id,
    parentId: null,
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    kind: 'root',
    authorProviderId: 'ai-1',
    authorLabel: 'ai-1_1',
    title: 't1',
    content: 'c1',
    rationale: 'r1',
    status: 'pending',
    exclusionReason: null,
    round: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makePlanningDesignCheckRecord(
  overrides: Partial<PlanningDesignCheckRecord> = {},
): PlanningDesignCheckRecord {
  return {
    id: 'planning-design-check-1',
    projectId: PROJECT_ID,
    sourceDesignMeetingId: MEETING_ID,
    designChannelId: CHANNEL_ID,
    designChannelRole: 'design.ui',
    planningChannelId: 'ch-planning',
    implementationChannelId: 'ch-implement',
    requestTitle: '디자인 검수 요청서',
    requestBody: '# 디자인 검수 요청서',
    finalDesignMinutesPath: '/tmp/minutes-2.md',
    finalDesignMinutesBody: '# final minutes',
    snapshotDesktopPath: '/tmp/desktop.png',
    snapshotMobilePath: '/tmp/mobile.png',
    wireframeCheckpointsJson: '[]',
    wireframeUserNotesJson: '[]',
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
    ...overrides,
  };
}

function buildDeps(
  overrides: Partial<MeetingOrchestratorDeps> = {},
): MeetingOrchestratorDeps {
  const session = overrides.session ?? buildSession();

  const turnExecutor = {
    requestOpinionGather: vi.fn(async (speaker, c) => ({
      kind: 'ok' as const,
      providerId: speaker.id,
      messageId: 'msg',
      payload: {
        name: speaker.displayName,
        label: c.suggestedLabel,
        opinions: [{ title: 't1', content: 'c1', rationale: 'r1' }],
      },
    })),
    requestQuickVote: vi.fn(async (speaker, c) => ({
      kind: 'ok' as const,
      providerId: speaker.id,
      messageId: 'msg',
      payload: {
        name: speaker.displayName,
        label: c.suggestedLabel,
        quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' as const }],
      },
    })),
    requestFreeDiscussion: vi.fn(async (speaker, c) => ({
      kind: 'ok' as const,
      providerId: speaker.id,
      messageId: 'msg',
      payload: {
        name: speaker.displayName,
        label: c.suggestedLabel,
        votes: [{ target_id: 'ITEM_001', vote: 'agree' as const }],
        additions: [],
      },
    })),
    abort: vi.fn(),
  } as unknown as MeetingTurnExecutor;

  const streamBridge = {
    emitMeetingPhaseChanged: vi.fn(),
    emitMeetingStateChanged: vi.fn(),
    emitMeetingTurnStart: vi.fn(),
    emitMeetingTurnToken: vi.fn(),
    emitMeetingTurnDone: vi.fn(),
    emitMeetingError: vi.fn(),
    emitMeetingTurnSkipped: vi.fn(),
    emitNextStepClassified: vi.fn(),
  } as unknown as StreamBridge;

  const messageService = {
    append: vi.fn((input) => ({
      id: 'msg',
      ...input,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    })),
  } as unknown as MessageService;

  const meetingService = {
    updateState: vi.fn(),
    finish: vi.fn(),
  } as unknown as MeetingService;

  const channelService = {
    get: vi.fn(() => makeChannel(5)),
  } as unknown as ChannelService;

  const projectService = {
    consumePendingAdvisory: vi.fn(() => null),
  } as unknown as ProjectService;

  const notificationService = {
    show: vi.fn(),
  } as unknown as NotificationService;

  const opinionService = {
    nextLabelHint: vi.fn(() => 1),
    gather: vi.fn(() => ({ meetingId: MEETING_ID, inserted: [] })),
    tally: vi.fn(() => ({
      meetingId: MEETING_ID,
      rootCount: 0,
      totalCount: 0,
      tree: [],
      screenToUuid: {},
      uuidToScreen: {},
    })),
    quickVote: vi.fn(() => ({
      meetingId: MEETING_ID,
      agreed: [],
      unresolved: [],
      votesInserted: 0,
    })),
    freeDiscussionRound: vi.fn(() => ({
      meetingId: MEETING_ID,
      opinionId: 'op',
      agreed: true,
      additions: [],
      votesInserted: 0,
    })),
  } as unknown as OpinionService;

  const meetingMinutesService = {
    compose: vi.fn(async () => ({
      body: '# minutes',
      source: 'fallback' as const,
      providerId: null,
      minutesPath: '/tmp/minutes.md',
      truncationDetected: false,
    })),
  } as unknown as MeetingMinutesService;

  // R12-C2 T13 — RunStep 영속 mock. 본 단위 테스트는 분류기 결과 / stream emit
  // 시나리오만 보고, 영속 자체는 통합 테스트에서 검증.
  let runStepCounter = 0;
  const runStepService = {
    appendOne: vi.fn((row: NewRunStep): RunStep => {
      runStepCounter += 1;
      return {
        ...row,
        id: `rs-${runStepCounter}`,
        createdAt: 0,
      };
    }),
    appendForTurn: vi.fn((rows: ReadonlyArray<NewRunStep>): RunStep[] => {
      return rows.map((row) => {
        runStepCounter += 1;
        return { ...row, id: `rs-${runStepCounter}`, createdAt: 0 };
      });
    }),
    listByMeeting: vi.fn(() => []),
    listByChannel: vi.fn(() => []),
    listByTurn: vi.fn(() => []),
  } as unknown as RunStepService;

  // T16b — design-workflow 가 ProviderRegistry 를 capability lookup 에 사용.
  // 테스트 디폴트는 빈 registry (get → undefined) — design 부서 회의가 아닌
  // 풀세트 / idea 흐름에서는 미사용. design 분기 테스트가 필요한 경우 override.
  const providerRegistry = {
    get: vi.fn(() => undefined),
  } as unknown as MeetingOrchestratorDeps['providerRegistry'];

  // T16c — design-workflow step 7b 본체. 디폴트는 reject (호출되면 throw) —
  // 풀세트 / idea 흐름은 미호출이라야 한다. design 분기 테스트가 capture 결과
  // 검증 필요 시 override.
  const designSnapshotService: MeetingOrchestratorDeps['designSnapshotService'] =
    {
      captureDesignSnapshot: vi.fn(() => {
        throw new Error(
          '[test] designSnapshotService.captureDesignSnapshot — default stub. design-workflow only path; override in design test.',
        );
      }),
    };

  return {
    session,
    turnExecutor: overrides.turnExecutor ?? turnExecutor,
    streamBridge: overrides.streamBridge ?? streamBridge,
    messageService: overrides.messageService ?? messageService,
    meetingService: overrides.meetingService ?? meetingService,
    channelService: overrides.channelService ?? channelService,
    projectService: overrides.projectService ?? projectService,
    notificationService: overrides.notificationService ?? notificationService,
    opinionService: overrides.opinionService ?? opinionService,
    meetingMinutesService:
      overrides.meetingMinutesService ?? meetingMinutesService,
    runStepService: overrides.runStepService ?? runStepService,
    providerRegistry: overrides.providerRegistry ?? providerRegistry,
    designSnapshotService:
      overrides.designSnapshotService ?? designSnapshotService,
    // R12-C2 T28 — handoff_mode 우회 wire 의존성. 테스트 디폴트:
    //   - handoffPendingState: 실 instance (in-memory Map, 테스트 재진입 시 초기화)
    //   - handoffDispatchService: vi.fn 으로 wrapped — runHandoffPhase 의 dispatch
    //     호출 시 throw 안 함. 실 dispatch 검증이 필요한 테스트는 override.
    //   - resolveReceiverChannel: 디폴트 = null (chain resolver 가 'no_chain' 분기
    //     또는 invariant throw — fallback path). audit chain 검증 시 override.
    //   - missionCardIdFactory: fixed UUID — 테스트 결정 가능성.
    handoffPendingState:
      overrides.handoffPendingState ?? new HandoffPendingState(),
    handoffDispatchService:
      overrides.handoffDispatchService ?? handoffDispatchServiceStub,
    meetingReviewGateService: overrides.meetingReviewGateService,
    designCheckpointService: overrides.designCheckpointService,
    planningDesignCheckService: overrides.planningDesignCheckService,
    resolveReceiverChannel:
      overrides.resolveReceiverChannel ?? (() => null),
    missionCardIdFactory:
      overrides.missionCardIdFactory ??
      (() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    interTurnDelayMs: 0,
    onFinalized: overrides.onFinalized,
  };
}

const handoffDispatchServiceStub = {
  dispatch: vi.fn(() => ({
    id: 'stub-row-id',
    fromMeetingId: 'm',
    fromChannelId: 'sender',
    toChannelId: 'receiver',
    reason: 'stub',
    minutesId: null,
    missionCardJson: '{}',
    mode: 'check' as const,
    dispatchedAt: 0,
    openedAt: null,
    createdAt: 0,
  })),
  open: vi.fn(() => null),
  findById: vi.fn(() => null),
  trackByMeeting: vi.fn(() => []),
  trackByChannel: vi.fn(() => []),
  serializeRowToPackage: vi.fn(() => '{}'),
} as unknown as MeetingOrchestratorDeps['handoffDispatchService'];

describe('MeetingOrchestrator — happy-path phase loop', () => {
  it('runs gather → tally → quick_vote → compose_minutes → handoff → done', async () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // 2 명의 AI participant 각각 gather + quick_vote 1 회씩 호출.
    expect(deps.turnExecutor.requestOpinionGather).toHaveBeenCalledTimes(2);
    expect(deps.turnExecutor.requestQuickVote).toHaveBeenCalledTimes(2);
    // free_discussion skip — quickVote.unresolved = [].
    expect(deps.turnExecutor.requestFreeDiscussion).not.toHaveBeenCalled();
    expect(deps.meetingMinutesService.compose).toHaveBeenCalledTimes(1);
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'accepted',
      null,
    );
    expect(deps.streamBridge.emitMeetingPhaseChanged).toHaveBeenCalled();
  });

  it('creates a pending planning minutes review instead of dispatching immediately', async () => {
    const session = new MeetingSession({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      topic: '기획 회의',
      participants: participants(2),
      ssmCtx: ctx(),
      channelRole: 'planning',
    });
    const planningChannel = {
      ...makeChannel(5),
      role: 'planning',
      name: '기획',
    } as Channel;
    const channelService = {
      get: vi.fn(() => planningChannel),
    } as unknown as ChannelService;
    const reviewGate = {
      id: 'review-1',
      projectId: PROJECT_ID,
      meetingId: MEETING_ID,
      sourceChannelId: CHANNEL_ID,
      targetChannelId: 'ch-design',
      targetRole: 'design.ux' as const,
      kind: 'planning_minutes' as const,
      status: 'pending' as const,
      title: '기획 회의록',
      documentPath: '/tmp/minutes.md',
      documentBodySnapshot: '# planning minutes',
      userNote: null,
      payloadJson: '{}',
      createdAt: 1,
      decidedAt: null,
    };
    const meetingReviewGateService = {
      createPending: vi.fn(() => reviewGate),
    };
    const handoffDispatchService = {
      dispatch: vi.fn(),
      open: vi.fn(),
      findById: vi.fn(),
      trackByMeeting: vi.fn(() => []),
      trackByChannel: vi.fn(() => []),
      serializeRowToPackage: vi.fn(() => '{}'),
    } as unknown as MeetingOrchestratorDeps['handoffDispatchService'];

    const deps = buildDeps({
      session,
      channelService,
      meetingReviewGateService:
        meetingReviewGateService as unknown as MeetingOrchestratorDeps['meetingReviewGateService'],
      handoffDispatchService,
      resolveReceiverChannel: (_projectId, role) =>
        role === 'design.ux'
          ? {
              channelId: 'ch-design',
              handoffMode: 'check',
              assignedProviderId: 'designer-1',
            }
          : null,
    });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(meetingReviewGateService.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        meetingId: MEETING_ID,
        sourceChannelId: CHANNEL_ID,
        targetChannelId: 'ch-design',
        targetRole: 'design.ux',
        kind: 'planning_minutes',
        documentBodySnapshot: '# minutes',
      }),
    );
    expect(handoffDispatchService.dispatch).not.toHaveBeenCalled();

    const appendCalls = (
      deps.messageService.append as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(
      appendCalls.some((input) => {
        const meta = input.meta as { reviewGate?: { id?: string } } | null;
        return meta?.reviewGate?.id === 'review-1';
      }),
    ).toBe(true);
    expect(
      appendCalls.some((input) => input.content === '# minutes'),
    ).toBe(false);
  });

  it('does not leave handoff blocked when planning review notice append fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const session = new MeetingSession({
        meetingId: MEETING_ID,
        channelId: CHANNEL_ID,
        projectId: PROJECT_ID,
        topic: '기획 회의',
        participants: participants(2),
        ssmCtx: ctx(),
        channelRole: 'planning',
      });
      const planningChannel = {
        ...makeChannel(5),
        role: 'planning',
        name: '기획',
      } as Channel;
      const channelService = {
        get: vi.fn(() => planningChannel),
      } as unknown as ChannelService;
      const reviewGate = {
        id: 'review-1',
        projectId: PROJECT_ID,
        meetingId: MEETING_ID,
        sourceChannelId: CHANNEL_ID,
        targetChannelId: 'ch-design',
        targetRole: 'design.ux' as const,
        kind: 'planning_minutes' as const,
        status: 'pending' as const,
        title: '기획 회의록',
        documentPath: '/tmp/minutes.md',
        documentBodySnapshot: '# planning minutes',
        userNote: null,
        payloadJson: '{}',
        createdAt: 1,
        decidedAt: null,
      };
      const meetingReviewGateService = {
        createPending: vi.fn(() => reviewGate),
      };
      const messageService = {
        append: vi.fn((input) => {
          const meta = input.meta as { reviewGate?: { id?: string } } | null;
          if (meta?.reviewGate?.id === 'review-1') {
            throw new Error('review notice append failed');
          }
          return {
            id: 'msg',
            ...input,
            meta: input.meta ?? null,
            createdAt: Date.now(),
          };
        }),
      } as unknown as MessageService;
      const handoffDispatchService = {
        dispatch: vi.fn(() => ({
          id: 'dispatch-1',
          fromMeetingId: MEETING_ID,
          fromChannelId: CHANNEL_ID,
          toChannelId: 'ch-design',
          reason: '기획 승인',
          minutesId: MEETING_ID,
          missionCardJson: '{}',
          mode: 'auto' as const,
          dispatchedAt: 1,
          openedAt: null,
          createdAt: 1,
        })),
        open: vi.fn(),
        findById: vi.fn(),
        trackByMeeting: vi.fn(() => []),
        trackByChannel: vi.fn(() => []),
        serializeRowToPackage: vi.fn(() => '{}'),
      } as unknown as MeetingOrchestratorDeps['handoffDispatchService'];

      const deps = buildDeps({
        session,
        channelService,
        messageService,
        meetingReviewGateService:
          meetingReviewGateService as unknown as MeetingOrchestratorDeps['meetingReviewGateService'],
        handoffDispatchService,
        resolveReceiverChannel: (_projectId, role) =>
          role === 'design.ux'
            ? {
                channelId: 'ch-design',
                handoffMode: 'check',
                assignedProviderId: 'designer-1',
              }
            : null,
      });
      const orchestrator = new MeetingOrchestrator(deps);

      await orchestrator.run();

      expect(meetingReviewGateService.createPending).toHaveBeenCalledTimes(1);
      expect(handoffDispatchService.dispatch).toHaveBeenCalledTimes(1);

      const appendCalls = (
        deps.messageService.append as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.map((call) => call[0] as Record<string, unknown>);
      expect(
        appendCalls.some((input) => input.content === '# minutes'),
      ).toBe(true);
      expect(
        appendCalls.some((input) => {
          const meta = input.meta as { handoff?: string } | null;
          return meta?.handoff === 'review_gate_pending';
        }),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('publishes gathered opinions as card messages, not raw assistant JSON', async () => {
    const deps = buildDeps();
    const inserted = [
      makeOpinion('op-1', {
        authorProviderId: 'ai-1',
        authorLabel: 'ai-1_1',
        title: 'A',
        content: '첫 번째 의견',
        rationale: '근거 A',
        createdAt: 1,
        updatedAt: 1,
      }),
      makeOpinion('op-2', {
        authorProviderId: 'ai-2',
        authorLabel: 'ai-2_1',
        title: 'B',
        content: '두 번째 의견',
        rationale: '근거 B',
        createdAt: 2,
        updatedAt: 2,
      }),
    ];
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(() => ({ meetingId: MEETING_ID, inserted })),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: 2,
        totalCount: 2,
        tree: inserted.map((opinion, index) => ({
          opinion,
          screenId: `ITEM_${String(index + 1).padStart(3, '0')}`,
          depth: 0,
          children: [],
        })),
        screenToUuid: { ITEM_001: 'op-1', ITEM_002: 'op-2' },
        uuidToScreen: { 'op-1': 'ITEM_001', 'op-2': 'ITEM_002' },
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: ['op-1', 'op-2'],
        unresolved: [],
        votesInserted: 2,
      })),
      freeDiscussionRound: vi.fn(),
    } as unknown as OpinionService;
    const orchestrator = new MeetingOrchestrator({
      ...deps,
      opinionService,
    });

    await orchestrator.run();

    const appendCalls = (
      deps.messageService.append as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as Record<string, unknown>);
    const opinionCalls = appendCalls.filter((input) => {
      const meta = input.meta as { opinion?: unknown } | null | undefined;
      return meta?.opinion !== undefined;
    });

    expect(opinionCalls).toHaveLength(2);
    expect(opinionCalls[0]).toEqual(
      expect.objectContaining({
        authorKind: 'member',
        role: 'assistant',
        content: '첫 번째 의견',
        meta: {
          opinion: {
            opinionRef: 'op-1',
            opinionKind: 'root',
            opinionScreenId: 'ITEM_001',
            authorLabel: 'ai-1_1',
            opinionTitle: 'A',
            opinionRationale: '근거 A',
          },
        },
      }),
    );
    expect(
      appendCalls.some(
        (input) =>
          typeof input.content === 'string' &&
          input.content.startsWith('{"name"'),
      ),
    ).toBe(false);
  });

  it('publishes minutes with nested card meta contract', async () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(deps.messageService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '# minutes',
        meta: {
          minutes: {
            minutesPath: '/tmp/minutes.md',
            minutesSource: 'fallback',
            minutesProviderId: null,
          },
        },
      }),
    );
  });

  it('enters free_discussion when quickVote leaves unresolved opinions', async () => {
    const deps = buildDeps();
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(() => ({ meetingId: MEETING_ID, inserted: [] })),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: 1,
        totalCount: 1,
        tree: [
          {
            opinion: {
              id: 'op-1',
              parentId: null,
              meetingId: MEETING_ID,
              channelId: CHANNEL_ID,
              kind: 'root',
              authorProviderId: 'ai-1',
              authorLabel: 'ai-1_1',
              title: 't1',
              content: 'c1',
              rationale: 'r1',
              status: 'pending',
              exclusionReason: null,
              round: 0,
              createdAt: 0,
              updatedAt: 0,
            },
            screenId: 'ITEM_001',
            depth: 0,
            children: [],
          },
        ],
        screenToUuid: { ITEM_001: 'op-1' },
        uuidToScreen: { 'op-1': 'ITEM_001' },
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: [],
        unresolved: ['op-1'],
        votesInserted: 0,
      })),
      freeDiscussionRound: vi.fn(() => ({
        meetingId: MEETING_ID,
        opinionId: 'op-1',
        agreed: true,
        additions: [],
        votesInserted: 0,
      })),
    } as unknown as OpinionService;

    const orchestrator = new MeetingOrchestrator({
      ...deps,
      opinionService,
    });
    await orchestrator.run();

    expect(deps.turnExecutor.requestFreeDiscussion).toHaveBeenCalled();
    // 합의 도달 → 다음 round 진입 X. 1 라운드만 (2 명 호출).
    expect(deps.turnExecutor.requestFreeDiscussion).toHaveBeenCalledTimes(2);
    expect(deps.meetingMinutesService.compose).toHaveBeenCalled();
  });
});

describe('MeetingOrchestrator — idea request-more context', () => {
  it('passes selected idea details and user instruction into the next gather turn and provider history', async () => {
    const session = new MeetingSession({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      topic: '새 제품 아이디어',
      participants: participants(2),
      ssmCtx: ctx(),
      channelRole: 'idea',
    });
    let selectedStatus: Opinion['status'] = 'pending';
    const selectedOpinion = (): Opinion =>
      makeOpinion('op-selected', {
        title: 'AI 회의 코치',
        content: '회의 중 사용자의 결정을 놓치지 않고 다음 부서에 전달한다.',
        rationale: '부서 간 인계 누락을 줄인다.',
        status: selectedStatus,
      });
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(() => ({ meetingId: MEETING_ID, inserted: [] })),
      tally: vi.fn(() => {
        const opinion = selectedOpinion();
        return {
          meetingId: MEETING_ID,
          rootCount: 1,
          totalCount: 1,
          tree: [
            {
              opinion,
              screenId: 'ITEM_001',
              depth: 0,
              children: [],
            },
          ],
          screenToUuid: { ITEM_001: opinion.id },
          uuidToScreen: { [opinion.id]: 'ITEM_001' },
        };
      }),
      requestMoreIdeas: vi.fn(() => {
        selectedStatus = 'agreed';
        return {
          meetingId: MEETING_ID,
          selectedIds: ['op-selected'],
          userOpinion: null,
        };
      }),
      finalizeIdeaSelection: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreedIds: ['op-selected'],
        excludedIds: [],
        userOpinion: null,
      })),
      quickVote: vi.fn(),
      freeDiscussionRound: vi.fn(),
    } as unknown as OpinionService;
    const channelService = {
      get: vi.fn(() => ({
        ...makeChannel(5),
        role: 'idea',
        name: '#idea',
      })),
      listByProject: vi.fn(() => [
        { ...makeChannel(5), role: 'idea', name: '#idea' },
        {
          ...makeChannel(5),
          id: 'ch-minutes',
          kind: 'system_minutes',
          role: null,
          name: '#회의록',
        },
      ]),
    } as unknown as ChannelService;
    let requestMore = (): void => {
      throw new Error('requestMore called before orchestrator was created');
    };
    let submitPick = (): void => {
      throw new Error('submitPick called before orchestrator was created');
    };
    let snapshotCount = 0;
    const streamBridge = {
      emitMeetingPhaseChanged: vi.fn(),
      emitMeetingStateChanged: vi.fn(),
      emitMeetingTurnStart: vi.fn(),
      emitMeetingTurnToken: vi.fn(),
      emitMeetingTurnDone: vi.fn(),
      emitMeetingError: vi.fn(),
      emitMeetingTurnSkipped: vi.fn(),
      emitNextStepClassified: vi.fn(),
      emitHandoffDispatched: vi.fn(),
      emitHandoffRequired: vi.fn(),
      emitIdeaPickSnapshot: vi.fn(() => {
        snapshotCount += 1;
        if (snapshotCount === 1) {
          queueMicrotask(() => {
            requestMore();
          });
        } else if (snapshotCount === 2) {
          queueMicrotask(() => {
            submitPick();
          });
        }
      }),
    } as unknown as StreamBridge;
    const deps = buildDeps({
      session,
      opinionService,
      channelService,
      streamBridge,
    });
    const orchestrator = new MeetingOrchestrator(deps);
    requestMore = () => {
      orchestrator.requestMoreIdeas({
        meetingId: MEETING_ID,
        selectedScreenIds: ['ITEM_001'],
        userComment: 'B2B 온보딩 관점으로 더 넓혀 주세요.',
      });
    };
    submitPick = () => {
      orchestrator.submitIdeaPick({
        meetingId: MEETING_ID,
        selectedScreenIds: ['ITEM_001'],
        userComment: undefined,
      });
    };

    await orchestrator.run();

    const gatherCalls = (
      deps.turnExecutor.requestOpinionGather as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(gatherCalls).toHaveLength(4);

    const firstCtx = gatherCalls[0][1] as { requestMoreContextMarkdown?: string | null };
    const secondGatherCtx = gatherCalls[2][1] as {
      requestMoreContextMarkdown?: string | null;
    };
    expect(firstCtx.requestMoreContextMarkdown).toBeNull();
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain('ITEM_001');
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain('AI 회의 코치');
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain(
      '회의 중 사용자의 결정을 놓치지 않고 다음 부서에 전달한다.',
    );
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain(
      '부서 간 인계 누락을 줄인다.',
    );
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain(
      'B2B 온보딩 관점으로 더 넓혀 주세요.',
    );
    expect(secondGatherCtx.requestMoreContextMarkdown).toContain('반복하지 말고');

    const providerHistory = session
      .getMessagesForProvider('ai-1')
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      )
      .join('\n');
    expect(providerHistory).toContain('ITEM_001');
    expect(providerHistory).toContain('AI 회의 코치');
    expect(providerHistory).toContain('B2B 온보딩 관점으로 더 넓혀 주세요.');
  });
});

describe('MeetingOrchestrator — abort handling', () => {
  it('stop() flips session.aborted and finalize is called with aborted', async () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);

    // 첫 gather turn 직후 stop. 이후 phase 진입 가드에서 자연 abort.
    (deps.turnExecutor.requestOpinionGather as unknown as ReturnType<
      typeof vi.fn
    >).mockImplementation(async (speaker: Participant) => {
      orchestrator.stop();
      return {
        kind: 'skipped',
        providerId: speaker.id,
        reason: 'aborted',
      };
    });

    await orchestrator.run();

    expect(deps.session.aborted).toBe(true);
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'aborted',
      null,
    );
    expect(deps.turnExecutor.requestFreeDiscussion).not.toHaveBeenCalled();
    expect(deps.meetingMinutesService.compose).not.toHaveBeenCalled();
  });
});

describe('MeetingOrchestrator — design-workflow 분기 (T16b)', () => {
  function buildPlanningCheckedDesignDeps(args: {
    verdict: 'aligned' | 'misaligned';
    returnCount?: number;
    dispatchFails?: boolean;
  }): {
    deps: MeetingOrchestratorDeps;
    dispatch: ReturnType<typeof vi.fn>;
    planningDesignCheckService: {
      createRequest: ReturnType<typeof vi.fn>;
      recordAligned: ReturnType<typeof vi.fn>;
      recordMisaligned: ReturnType<typeof vi.fn>;
      recordNeedsUserDecision: ReturnType<typeof vi.fn>;
      setImplementationDispatchId: ReturnType<typeof vi.fn>;
      setDesignReturnDispatchId: ReturnType<typeof vi.fn>;
      findByDesignReturnDispatchId: ReturnType<typeof vi.fn>;
    };
  } {
    const session = new MeetingSession({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      topic: 'Design login screen',
      participants: participants(2),
      ssmCtx: ctx(),
      channelRole: 'design.ui',
      sourceHandoffContext: {
        dispatchRowId: 'dispatch-planning-to-design',
        handoffPackage: {
          sender: {
            meetingId: 'planning-meeting-1',
            channelId: 'ch-planning',
            channelRole: 'planning',
          },
        } as SourceHandoffContext['handoffPackage'],
        minutesMeetingId: 'planning-meeting-1',
        minutesPath: '/tmp/planning-minutes.md',
        minutesBody: '# original planning',
      },
    });
    const designChannel = makeChannel(5);
    (designChannel as unknown as { role: string }).role = 'design.ui';
    const channelService = {
      get: vi.fn(() => designChannel),
      list: vi.fn(() => [designChannel]),
      listByProject: vi.fn(() => [
        { id: 'minutes-channel', kind: 'system_minutes' },
      ]),
    } as unknown as ChannelService;
    const providerRegistry = {
      get: vi.fn((id: string) => ({
        id,
        type: 'api' as const,
        displayName: id,
        model: 'm',
        capabilities: [],
        status: 'ready' as const,
        config: {},
        roles:
          id === 'planner-1'
            ? ['planning']
            : ['design.ux', 'design.ui'],
        skill_overrides: null,
      })),
    } as unknown as MeetingOrchestratorDeps['providerRegistry'];

    let designedCallCount = 0;
    const turnExecutor = {
      requestOpinionGather: vi.fn(),
      requestQuickVote: vi.fn(async (speaker, c) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: c.suggestedLabel,
          quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' as const }],
        },
      })),
      requestFreeDiscussion: vi.fn(),
      requestAssigningDesignatedTask: vi.fn(async (speaker, dctx) => {
        designedCallCount += 1;
        return {
          kind: 'ok' as const,
          providerId: speaker.id,
          messageId: `msg-${designedCallCount}`,
          payload: {
            name: speaker.displayName,
            label: dctx.suggestedLabel,
            opinions: [
              {
                title: `step-${designedCallCount}`,
                content:
                  dctx.kind === 'design_implementation'
                    ? '<html><body>final</body></html>'
                    : `wireframe-${designedCallCount}`,
                rationale: 'r',
              },
            ],
          },
        };
      }),
      requestPlanningDesignCheck: vi.fn(async (speaker, pctx) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'planning-check-msg',
        payload: {
          name: speaker.displayName,
          label: pctx.suggestedLabel,
          verdict: args.verdict,
          reason:
            args.verdict === 'aligned'
              ? '기획 의도와 일치함'
              : '반복 업무 도구 의도와 다름',
          revision_direction:
            args.verdict === 'misaligned'
              ? '소개형 구성을 줄이고 업무 화면 밀도를 높이기'
              : undefined,
        },
      })),
      abort: vi.fn(),
    } as unknown as MeetingTurnExecutor;

    const roots: Opinion[] = [];
    let opinionCounter = 0;
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn((req: { responses: Array<{ payload: { opinions: Array<{ content: string }> } }> }) => {
        const inserted: Opinion[] = [];
        for (const response of req.responses) {
          for (const op of response.payload.opinions) {
            opinionCounter += 1;
            const opinion = makeOpinion(`op-${opinionCounter}`, {
              content: op.content,
              status: 'pending',
              createdAt: opinionCounter,
              updatedAt: opinionCounter,
            });
            roots.push(opinion);
            inserted.push(opinion);
          }
        }
        return { meetingId: MEETING_ID, inserted };
      }),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: roots.length,
        totalCount: roots.length,
        tree: roots.map((opinion) => ({
          opinion,
          screenId: null,
          children: [],
        })),
        screenToUuid: {},
        uuidToScreen: {},
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: [],
        unresolved: [],
        votesInserted: 0,
      })),
      freeDiscussionRound: vi.fn(),
    } as unknown as OpinionService;
    const meetingMinutesService = {
      compose: vi.fn(async (request: { ordinal?: number }) => ({
        body: request.ordinal === 1 ? '# wireframe minutes' : '# final minutes',
        source: 'fallback' as const,
        providerId: null,
        minutesPath:
          request.ordinal === 1 ? '/tmp/minutes-1.md' : '/tmp/minutes-2.md',
        truncationDetected: false,
      })),
      readMinutesBody: vi.fn(async () => '# wireframe minutes'),
    } as unknown as MeetingMinutesService;
    const designSnapshotService: MeetingOrchestratorDeps['designSnapshotService'] =
      {
        captureDesignSnapshot: vi.fn(async (req) => ({
          desktopPath: '/tmp/desktop.png',
          mobilePath: '/tmp/mobile.png',
          generatedAt: 1_700_000_001_000,
          sourceOpinionUuid: req.sourceOpinionUuid,
        })),
      };
    const request = makePlanningDesignCheckRecord({
      returnCount: args.returnCount ?? 0,
    });
    const planningDesignCheckService = {
      createRequest: vi.fn(() => request),
      findByDesignReturnDispatchId: vi.fn(() => null),
      recordAligned: vi.fn(() =>
        makePlanningDesignCheckRecord({
          status: 'aligned',
          verdict: 'aligned',
          reason: '기획 의도와 일치함',
        }),
      ),
      recordMisaligned: vi.fn(() => {
        const shouldReturn = (args.returnCount ?? 0) < 1;
        const record = makePlanningDesignCheckRecord({
          status: shouldReturn ? 'returned_to_design' : 'needs_user_decision',
          verdict: 'misaligned',
          returnCount: shouldReturn ? 1 : 1,
          reason: '반복 업무 도구 의도와 다름',
          revisionDirection: '업무 화면 밀도를 높이기',
        });
        return {
          record,
          action: shouldReturn ? 'return_to_design' : 'needs_user_decision',
        };
      }),
      recordNeedsUserDecision: vi.fn((input: { reason?: string | null }) =>
        makePlanningDesignCheckRecord({
          status: 'needs_user_decision',
          verdict: args.verdict,
          returnCount: args.returnCount ?? 0,
          reason: input.reason ?? '사용자 판단 필요',
        }),
      ),
      setImplementationDispatchId: vi.fn((id: string, dispatchId: string) =>
        makePlanningDesignCheckRecord({
          id,
          status: 'aligned',
          verdict: 'aligned',
          implementationDispatchId: dispatchId,
        }),
      ),
      setDesignReturnDispatchId: vi.fn((id: string, dispatchId: string) =>
        makePlanningDesignCheckRecord({
          id,
          status: 'returned_to_design',
          verdict: 'misaligned',
          returnCount: 1,
          designReturnDispatchId: dispatchId,
        }),
      ),
    };
    const dispatch = vi.fn((pkg) => {
      if (args.dispatchFails === true) {
        throw new Error('dispatch insert failed');
      }
      return {
        id: `dispatch-${dispatch.mock.calls.length + 1}`,
        fromMeetingId: pkg.sender.meetingId,
        fromChannelId: pkg.sender.channelId,
        toChannelId: pkg.target.channelId,
        reason: pkg.reason,
        minutesId: pkg.minutesMeetingId,
        missionCardJson: '{}',
        mode: pkg.mode,
        dispatchedAt: pkg.dispatchedAt,
        openedAt: null,
        createdAt: pkg.dispatchedAt,
      };
    });
    const deps = buildDeps({
      session,
      channelService,
      providerRegistry,
      turnExecutor,
      opinionService,
      meetingMinutesService,
      designSnapshotService,
      planningDesignCheckService:
        planningDesignCheckService as unknown as MeetingOrchestratorDeps['planningDesignCheckService'],
      handoffDispatchService: {
        ...handoffDispatchServiceStub,
        dispatch,
      } as unknown as MeetingOrchestratorDeps['handoffDispatchService'],
      resolveReceiverChannel: (_projectId, role) => {
        if (role === 'planning') {
          return {
            channelId: 'ch-planning',
            handoffMode: 'auto',
            assignedProviderId: 'planner-1',
          };
        }
        if (role === 'implement') {
          return {
            channelId: 'ch-implement',
            handoffMode: 'auto',
            assignedProviderId: 'implementer-1',
          };
        }
        if (role === 'design.ui') {
          return {
            channelId: CHANNEL_ID,
            handoffMode: 'auto',
            assignedProviderId: 'designer-1',
          };
        }
        return null;
      },
    });
    return { deps, dispatch, planningDesignCheckService };
  }

  it('design 채널 + capability 매칭 직원 0 명 → designed_task_failed 분기 → finalize aborted', async () => {
    // 디자인 부서 채널 (role='design.ux') 인데 모든 직원이 design 능력 미보유.
    // runDesignWorkflow 가 step 1 wireframe_drafting 진입 시 resolveDesignatedWorker
    // 가 throw DesignatedWorkerNotFoundError → outcome='aborted' / abortReason
    // 'designated_task_failed' → finalize('aborted').
    const session = buildSession();
    const designChannel = makeChannel(5);
    (designChannel as unknown as { role: string }).role = 'design.ux';

    const channelService = {
      get: vi.fn(() => designChannel),
      list: vi.fn(() => [designChannel]),
    } as unknown as ChannelService;

    // providerRegistry.get → roles=['planning'] 만 (design 능력 X) — resolver 가 throw.
    const providerRegistry = {
      get: vi.fn(() => ({
        id: 'ai-1',
        type: 'api' as const,
        displayName: 'AI 1',
        model: 'm',
        capabilities: [],
        status: 'ready' as const,
        config: {},
        roles: ['planning'],
        skill_overrides: null,
      })),
    } as unknown as MeetingOrchestratorDeps['providerRegistry'];

    const deps = buildDeps({
      session,
      channelService,
      providerRegistry,
    });
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // gather phase 자체 진입 X (design 분기에서 우회).
    expect(deps.turnExecutor.requestOpinionGather).not.toHaveBeenCalled();
    // resolver 가 throw → assigning_designated_task turn 호출 X.
    // (turn-executor mock 에 requestAssigningDesignatedTask 가 없어서 호출 시
    //  TypeError — 본 분기에서는 호출 자체가 없어야 함을 검증.)
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'aborted',
      null,
    );
  });

  it('T16c: design 부서 happy-path — snapshot 캡처 + stream emit + outcome.committed', async () => {
    // 디자인 부서 채널 (role='design.ui') + 직원 1 명이 design.ux/ui 통째 보유.
    // requestAssigningDesignatedTask 3 회 + requestQuickVote 2 회 + compose 2 회
    // 통째 성공 → step 7b snapshot 호출 → emitDesignSnapshotReady → handoff →
    // outcome='committed' + result.snapshot 채워짐.
    const session = new MeetingSession({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      topic: 'Design login screen',
      participants: [
        {
          id: 'designer-1',
          providerId: 'designer-1',
          displayName: 'Designer 1',
          isActive: true,
        },
        {
          id: 'designer-2',
          providerId: 'designer-2',
          displayName: 'Designer 2',
          isActive: true,
        },
      ],
      ssmCtx: ctx(),
      channelRole: 'design.ui',
    });
    const designChannel = makeChannel(5);
    (designChannel as unknown as { role: string }).role = 'design.ui';

    const channelService = {
      get: vi.fn(() => designChannel),
      list: vi.fn(() => [designChannel]),
    } as unknown as ChannelService;

    const providerRegistry = {
      get: vi.fn((id: string) => ({
        id,
        type: 'api' as const,
        displayName: id === 'designer-1' ? 'Designer 1' : 'Designer 2',
        model: 'm',
        capabilities: [],
        status: 'ready' as const,
        config: {},
        roles: ['design.ux', 'design.ui'],
        skill_overrides: null,
      })),
    } as unknown as MeetingOrchestratorDeps['providerRegistry'];

    // 3 회 requestAssigningDesignatedTask 응답 — 각 step 의 가짜 본문.
    let designedCallCount = 0;
    const turnExecutor = {
      requestOpinionGather: vi.fn(),
      requestQuickVote: vi.fn(async (speaker, c) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: c.suggestedLabel,
          quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' as const }],
        },
      })),
      requestFreeDiscussion: vi.fn(),
      requestAssigningDesignatedTask: vi.fn(async (speaker, dctx) => {
        designedCallCount += 1;
        const content =
          dctx.kind === 'design_implementation'
            ? '<html><body><div>login</div></body></html>'
            : `wireframe step ${designedCallCount}`;
        return {
          kind: 'ok' as const,
          providerId: speaker.id,
          messageId: `msg-${designedCallCount}`,
          payload: {
            name: speaker.displayName,
            label: dctx.suggestedLabel,
            opinions: [
              {
                title: `step-${designedCallCount}`,
                content,
                rationale: 'r',
              },
            ],
          },
        };
      }),
      abort: vi.fn(),
    } as unknown as MeetingTurnExecutor;

    // opinionService.gather → 본문을 누적해서 inserted row 반환 + tally 도 같은
    // 누적에서 빌드. orchestrator 의 designated-task path 가 "OpinionService.gather
    // returned empty inserted" invariant 를 갖고 있어 inserted 비면 throw.
    const accumulatedRoots: Array<{
      id: string;
      content: string;
      createdAt: number;
    }> = [];
    let opinionCounter = 0;
    const buildOpinion = (root: typeof accumulatedRoots[number]) => ({
      id: root.id,
      parentId: null,
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      kind: 'root' as const,
      authorProviderId: 'designer-1',
      authorLabel: 'designer_1',
      title: null,
      content: root.content,
      rationale: null,
      status: 'draft' as const,
      exclusionReason: null,
      round: 0,
      createdAt: root.createdAt,
      updatedAt: root.createdAt,
    });
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(
        (req: {
          responses: { payload: { opinions: { content: string }[] } }[];
        }) => {
          const inserted: ReturnType<typeof buildOpinion>[] = [];
          for (const r of req.responses) {
            for (const op of r.payload.opinions) {
              opinionCounter += 1;
              const root = {
                id: `op-${opinionCounter}`,
                content: op.content,
                createdAt: opinionCounter,
              };
              accumulatedRoots.push(root);
              inserted.push(buildOpinion(root));
            }
          }
          return { meetingId: MEETING_ID, inserted };
        },
      ),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: accumulatedRoots.length,
        totalCount: accumulatedRoots.length,
        tree: accumulatedRoots.map((r) => ({
          opinion: buildOpinion(r),
          screenId: null,
          children: [],
        })),
        screenToUuid: {},
        uuidToScreen: {},
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: [],
        unresolved: [],
        votesInserted: 0,
      })),
      freeDiscussionRound: vi.fn(),
    } as unknown as OpinionService;

    const meetingMinutesService = {
      compose: vi.fn(async (request: { ordinal?: number }) => ({
        body: request.ordinal === 1 ? '# wireframe minutes' : '# final minutes',
        source: 'fallback' as const,
        providerId: null,
        minutesPath:
          request.ordinal === 1 ? '/tmp/minutes-1.md' : '/tmp/minutes-2.md',
        truncationDetected: false,
      })),
      readMinutesBody: vi.fn(async () => '# minutes #1 합의 본문'),
    } as unknown as MeetingMinutesService;

    const createWireframeCheckpoint = vi.fn(() => ({
      checkpoint: {
        id: 'checkpoint-1',
        projectId: PROJECT_ID,
        meetingId: MEETING_ID,
        channelId: CHANNEL_ID,
        kind: 'wireframe' as const,
        status: 'pending' as const,
        title: '와이어프레임 확인',
        documentPath: '/tmp/minutes-1.md',
        documentBodySnapshot: '# wireframe minutes',
        userNote: null,
        payloadJson: '{}',
        createdAt: 1,
        decidedAt: null,
      },
      shouldShowNotice: true,
    }));
    const designCheckpointService = {
      createWireframeCheckpoint,
    } as unknown as NonNullable<
      MeetingOrchestratorDeps['designCheckpointService']
    >;

    // T16c — snapshot service mock + stream emit spy.
    const captureDesignSnapshot = vi.fn(async (req) => ({
      desktopPath: `/fake/consensus/meetings/${req.meetingId}/design-snapshot-desktop.png`,
      mobilePath: `/fake/consensus/meetings/${req.meetingId}/design-snapshot-mobile.png`,
      generatedAt: 1_700_000_001_234,
      sourceOpinionUuid: req.sourceOpinionUuid,
    }));
    const designSnapshotService: MeetingOrchestratorDeps['designSnapshotService'] =
      { captureDesignSnapshot };

    const emitDesignSnapshotReady = vi.fn();
    const streamBridge = {
      emitMeetingPhaseChanged: vi.fn(),
      emitMeetingStateChanged: vi.fn(),
      emitMeetingTurnStart: vi.fn(),
      emitMeetingTurnToken: vi.fn(),
      emitMeetingTurnDone: vi.fn(),
      emitMeetingError: vi.fn(),
      emitMeetingTurnSkipped: vi.fn(),
      emitNextStepClassified: vi.fn(),
      emitDesignedTaskAssigned: vi.fn(),
      emitDesignSnapshotReady,
    } as unknown as StreamBridge;

    const deps = buildDeps({
      session,
      channelService,
      providerRegistry,
      turnExecutor,
      opinionService,
      meetingMinutesService,
      streamBridge,
      designSnapshotService,
      designCheckpointService,
    });
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // 3 회 design-task 호출 (step 1 / 5 / 6).
    expect(turnExecutor.requestAssigningDesignatedTask).toHaveBeenCalledTimes(3);
    // 2 회 회의 (#1 wireframe / #2 design) → quick_vote 회의당 1 회 + compose 1 회.
    expect(turnExecutor.requestQuickVote).toHaveBeenCalled();
    expect(meetingMinutesService.compose).toHaveBeenCalledTimes(2);
    expect(createWireframeCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        meetingId: MEETING_ID,
        channelId: CHANNEL_ID,
        documentPath: '/tmp/minutes-1.md',
        documentBodySnapshot: '# wireframe minutes',
      }),
    );
    expect(
      (deps.messageService.append as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0] as { meta?: { wireframeCheckpoint?: { id?: string } } })
        .some((input) => input.meta?.wireframeCheckpoint?.id === 'checkpoint-1'),
    ).toBe(true);

    // T16c 핵심 — snapshot service 호출 + 입력 검증.
    expect(captureDesignSnapshot).toHaveBeenCalledTimes(1);
    const snapArgs = captureDesignSnapshot.mock.calls[0]![0];
    expect(snapArgs.meetingId).toBe(MEETING_ID);
    expect(snapArgs.htmlContent).toBe(
      '<html><body><div>login</div></body></html>',
    );
    expect(snapArgs.sourceOpinionUuid).toBe('op-3');

    // stream emit 검증.
    expect(emitDesignSnapshotReady).toHaveBeenCalledTimes(1);
    const streamPayload = emitDesignSnapshotReady.mock.calls[0]![0];
    expect(streamPayload.meetingId).toBe(MEETING_ID);
    expect(streamPayload.channelId).toBe(CHANNEL_ID);
    expect(streamPayload.desktopPath).toContain('design-snapshot-desktop.png');
    expect(streamPayload.mobilePath).toContain('design-snapshot-mobile.png');

    // outcome.committed (accepted = committed 매핑).
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'accepted',
      null,
    );
  });

  it('디자인 최종 결과 후 기획 검수 aligned면 구현 부서 의뢰서를 생성한다', async () => {
    const { deps, dispatch, planningDesignCheckService } =
      buildPlanningCheckedDesignDeps({ verdict: 'aligned' });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(planningDesignCheckService.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sourceDesignMeetingId: MEETING_ID,
        designChannelId: CHANNEL_ID,
        planningChannelId: 'ch-planning',
        implementationChannelId: 'ch-implement',
        originalPlanningMinutesBody: '# original planning',
        originalPlanningMinutesPath: '/tmp/planning-minutes.md',
        workBundleKey: 'planning-minutes:planning-meeting-1',
        finalDesignMinutesBody: '# final minutes',
        snapshotDesktopPath: '/tmp/desktop.png',
      }),
    );
    expect(planningDesignCheckService.recordAligned).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].target.channelRole).toBe('implement');
  });

  it('aligned 후 구현 자동 인계가 실패하면 성공 메시지 대신 사용자 판단 필요로 남긴다', async () => {
    const { deps, dispatch, planningDesignCheckService } =
      buildPlanningCheckedDesignDeps({
        verdict: 'aligned',
        dispatchFails: true,
      });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.recordAligned).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.setImplementationDispatchId).not.toHaveBeenCalled();
    expect(planningDesignCheckService.recordNeedsUserDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        reason:
          '구현 부서 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
      }),
    );
    const appended = (
      deps.messageService.append as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as { content?: string; meta?: unknown });
    expect(
      appended.some((message) =>
        message.content?.includes('구현 부서로 자동 인계되었습니다'),
      ),
    ).toBe(false);
    expect(
      appended.some(
        (message) =>
          message.content ===
          '구현 부서 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
      ),
    ).toBe(true);
  });

  it('첫 misaligned면 디자인 부서로 한 번 되돌린다', async () => {
    const { deps, dispatch, planningDesignCheckService } =
      buildPlanningCheckedDesignDeps({ verdict: 'misaligned' });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(planningDesignCheckService.recordMisaligned).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.setDesignReturnDispatchId).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].target.channelRole).toBe('design.ui');
  });

  it('첫 misaligned 후 디자인 되돌림 인계가 실패하면 성공 메시지 대신 사용자 판단 필요로 남긴다', async () => {
    const { deps, dispatch, planningDesignCheckService } =
      buildPlanningCheckedDesignDeps({
        verdict: 'misaligned',
        dispatchFails: true,
      });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.recordMisaligned).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.setDesignReturnDispatchId).not.toHaveBeenCalled();
    expect(planningDesignCheckService.recordNeedsUserDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        reason:
          '디자인 수정 요청 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
      }),
    );
    const appended = (
      deps.messageService.append as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as { content?: string });
    expect(
      appended.some((message) =>
        message.content?.includes('디자인 되돌림을 한 번 자동 실행했습니다'),
      ),
    ).toBe(false);
    expect(
      appended.some(
        (message) =>
          message.content ===
          '디자인 수정 요청 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
      ),
    ).toBe(true);
  });

  it('두 번째 misaligned면 자동 되돌림 없이 사용자 판단 필요 메시지를 남긴다', async () => {
    const { deps, dispatch, planningDesignCheckService } =
      buildPlanningCheckedDesignDeps({
        verdict: 'misaligned',
        returnCount: 1,
      });
    const orchestrator = new MeetingOrchestrator(deps);

    await orchestrator.run();

    expect(planningDesignCheckService.recordMisaligned).toHaveBeenCalledTimes(1);
    expect(planningDesignCheckService.setDesignReturnDispatchId).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    const appended = (
      deps.messageService.append as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as { content?: string; meta?: unknown });
    expect(
      appended.some((message) => message.content === '사용자 판단 필요'),
    ).toBe(true);
    expect(
      appended.some((message) => {
        const meta = message.meta as {
          planningDesignCheck?: { status?: string };
        };
        return meta?.planningDesignCheck?.status === 'needs_user_decision';
      }),
    ).toBe(true);
  });

  it('T16c: snapshot 실패 → snapshot_failed abort, 회의록은 이미 land', async () => {
    // 위 happy-path 와 동일 setup 인데 captureDesignSnapshot 가 throw → orchestrator
    // catch + outcome='aborted' / abortReason.kind='snapshot_failed' 매핑.
    const session = new MeetingSession({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      projectId: PROJECT_ID,
      topic: 'Design login screen',
      participants: [
        {
          id: 'designer-1',
          providerId: 'designer-1',
          displayName: 'Designer 1',
          isActive: true,
        },
        {
          id: 'designer-2',
          providerId: 'designer-2',
          displayName: 'Designer 2',
          isActive: true,
        },
      ],
      ssmCtx: ctx(),
      channelRole: 'design.ui',
    });
    const designChannel = makeChannel(5);
    (designChannel as unknown as { role: string }).role = 'design.ui';

    const channelService = {
      get: vi.fn(() => designChannel),
      list: vi.fn(() => [designChannel]),
    } as unknown as ChannelService;

    const providerRegistry = {
      get: vi.fn((id: string) => ({
        id,
        type: 'api' as const,
        displayName: id === 'designer-1' ? 'Designer 1' : 'Designer 2',
        model: 'm',
        capabilities: [],
        status: 'ready' as const,
        config: {},
        roles: ['design.ux', 'design.ui'],
        skill_overrides: null,
      })),
    } as unknown as MeetingOrchestratorDeps['providerRegistry'];

    let designedCallCount = 0;
    const turnExecutor = {
      requestOpinionGather: vi.fn(),
      requestQuickVote: vi.fn(async (speaker, c) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: c.suggestedLabel,
          quick_votes: [{ target_id: 'ITEM_001', vote: 'agree' as const }],
        },
      })),
      requestFreeDiscussion: vi.fn(),
      requestAssigningDesignatedTask: vi.fn(async (speaker, dctx) => {
        designedCallCount += 1;
        const content =
          dctx.kind === 'design_implementation'
            ? '<html><body>x</body></html>'
            : `wf-${designedCallCount}`;
        return {
          kind: 'ok' as const,
          providerId: speaker.id,
          messageId: `msg-${designedCallCount}`,
          payload: {
            name: speaker.displayName,
            label: dctx.suggestedLabel,
            opinions: [
              { title: 't', content, rationale: 'r' },
            ],
          },
        };
      }),
      abort: vi.fn(),
    } as unknown as MeetingTurnExecutor;

    const accumulatedRoots: Array<{
      id: string;
      content: string;
      createdAt: number;
    }> = [];
    let opinionCounter = 0;
    const buildOpinion = (root: typeof accumulatedRoots[number]) => ({
      id: root.id,
      parentId: null,
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
      kind: 'root' as const,
      authorProviderId: 'designer-1',
      authorLabel: 'designer_1',
      title: null,
      content: root.content,
      rationale: null,
      status: 'draft' as const,
      exclusionReason: null,
      round: 0,
      createdAt: root.createdAt,
      updatedAt: root.createdAt,
    });
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(
        (req: {
          responses: { payload: { opinions: { content: string }[] } }[];
        }) => {
          const inserted: ReturnType<typeof buildOpinion>[] = [];
          for (const r of req.responses) {
            for (const op of r.payload.opinions) {
              opinionCounter += 1;
              const root = {
                id: `op-${opinionCounter}`,
                content: op.content,
                createdAt: opinionCounter,
              };
              accumulatedRoots.push(root);
              inserted.push(buildOpinion(root));
            }
          }
          return { meetingId: MEETING_ID, inserted };
        },
      ),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: accumulatedRoots.length,
        totalCount: accumulatedRoots.length,
        tree: accumulatedRoots.map((r) => ({
          opinion: buildOpinion(r),
          screenId: null,
          children: [],
        })),
        screenToUuid: {},
        uuidToScreen: {},
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: [],
        unresolved: [],
        votesInserted: 0,
      })),
      freeDiscussionRound: vi.fn(),
    } as unknown as OpinionService;

    const meetingMinutesService = {
      compose: vi.fn(async () => ({
        body: '# minutes',
        source: 'fallback' as const,
        providerId: null,
        minutesPath: '/tmp/minutes.md',
        truncationDetected: false,
      })),
      readMinutesBody: vi.fn(async () => '# m1'),
    } as unknown as MeetingMinutesService;

    // T16c — snapshot service throws → snapshot_failed abort.
    const captureDesignSnapshot = vi.fn(async () => {
      throw new Error('chromium gpu crashed');
    });
    const designSnapshotService: MeetingOrchestratorDeps['designSnapshotService'] =
      { captureDesignSnapshot };

    const deps = buildDeps({
      session,
      channelService,
      providerRegistry,
      turnExecutor,
      opinionService,
      meetingMinutesService,
      designSnapshotService,
    });
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // 회의록 #2 까지 land 후 snapshot 만 실패 → 회의록 compose 2 회 모두 호출됨.
    expect(meetingMinutesService.compose).toHaveBeenCalledTimes(2);
    // snapshot 1 회 시도 후 throw.
    expect(captureDesignSnapshot).toHaveBeenCalledTimes(1);
    // outcome aborted.
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'aborted',
      null,
    );
  });

  it('design 채널 + 풀세트 흐름 우회 — runQuickVotePhase 호출 안 됨 (step 1 진입 전 abort)', async () => {
    const session = buildSession();
    const designChannel = makeChannel(5);
    (designChannel as unknown as { role: string }).role = 'design.ui';

    const channelService = {
      get: vi.fn(() => designChannel),
      list: vi.fn(() => [designChannel]),
    } as unknown as ChannelService;

    // 모든 직원이 design 능력 미보유 → step 1 진입 시 즉시 abort.
    const providerRegistry = {
      get: vi.fn(() => ({
        id: 'ai-1',
        type: 'api' as const,
        displayName: 'AI 1',
        model: 'm',
        capabilities: [],
        status: 'ready' as const,
        config: {},
        roles: ['general'],
        skill_overrides: null,
      })),
    } as unknown as MeetingOrchestratorDeps['providerRegistry'];

    const deps = buildDeps({
      session,
      channelService,
      providerRegistry,
    });
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // 풀세트의 quick_vote / free_discussion / compose_minutes 통째 우회.
    expect(deps.turnExecutor.requestQuickVote).not.toHaveBeenCalled();
    expect(deps.turnExecutor.requestFreeDiscussion).not.toHaveBeenCalled();
    expect(deps.meetingMinutesService.compose).not.toHaveBeenCalled();
    // finalize aborted.
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'aborted',
      null,
    );
  });
});

describe('MeetingOrchestrator — onFinalized hook', () => {
  it('fires the onFinalized callback with outcome=accepted on happy-path', async () => {
    const onFinalized = vi.fn();
    const deps = buildDeps({ onFinalized });
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();
    // onFinalized 가 fire-and-forget 이라 microtask 1 회 양보.
    await Promise.resolve();
    await Promise.resolve();

    expect(onFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: MEETING_ID,
        projectId: PROJECT_ID,
        channelId: CHANNEL_ID,
        outcome: 'accepted',
      }),
    );
  });
});

describe('MeetingOrchestrator — T13 NextStep classify wire', () => {
  it('classifies + persists RunStep + emits stream after each AI gather/quick_vote turn (happy-path)', async () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    // gather (2 turns) + quick_vote (2 turns) + compose_minutes boundary (1) = 5
    expect(deps.runStepService.appendOne).toHaveBeenCalledTimes(5);
    expect(deps.streamBridge.emitNextStepClassified).toHaveBeenCalledTimes(5);

    // 모든 RunStep row 가 stepKind='next_step_classify' 로 영속.
    const calls = (
      deps.runStepService.appendOne as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    for (const [row] of calls) {
      expect(row.stepKind).toBe('next_step_classify');
      expect(row.nextStepCard).toBeTypeOf('string');
    }

    // turnIndex 가 0 부터 monotonically 증가.
    const turnIndices = calls.map(([row]) => row.turnIndex);
    expect(turnIndices).toEqual([0, 1, 2, 3, 4]);

    // gather phase 의 actor 는 'employee' + speaker.id.
    const gatherCalls = calls.filter(([r]) => r.actorKind === 'employee');
    expect(gatherCalls.length).toBe(4); // 2 gather + 2 quick_vote
    for (const [row] of gatherCalls) {
      expect(row.actorId).toMatch(/^ai-/);
    }

    // compose_minutes boundary 는 actorKind='moderator' + actorId=null.
    const moderatorCalls = calls.filter(([r]) => r.actorKind === 'moderator');
    expect(moderatorCalls.length).toBe(1);
    expect(moderatorCalls[0][0].actorId).toBeNull();
    // chain 미정의 (T13 placeholder false) + minutesComposed=true → 'end'.
    expect(moderatorCalls[0][0].nextStepCard).toBe('end');
  });

  it('cap interlock: free_discussion 라운드 cap 도달 시 자연 continue → end override', async () => {
    // cap=2 채널 + freeDiscussionRound 가 매 round 자식 의견을 추가하는 시나리오.
    // round 1, 2 모두 additions 있어 자연 'continue' → cap 도달 시점에 'end' 강제.
    const opinionService = {
      nextLabelHint: vi.fn(() => 1),
      gather: vi.fn(() => ({ meetingId: MEETING_ID, inserted: [] })),
      tally: vi.fn(() => ({
        meetingId: MEETING_ID,
        rootCount: 1,
        totalCount: 1,
        tree: [
          {
            opinion: {
              id: 'op-1',
              parentId: null,
              meetingId: MEETING_ID,
              channelId: CHANNEL_ID,
              kind: 'root',
              authorProviderId: 'ai-1',
              authorLabel: 'ai-1_1',
              title: 't1',
              content: 'c1',
              rationale: 'r1',
              status: 'pending',
              exclusionReason: null,
              round: 0,
              createdAt: 0,
              updatedAt: 0,
            },
            screenId: 'ITEM_001',
            depth: 0,
            children: [],
          },
        ],
        screenToUuid: { ITEM_001: 'op-1' },
        uuidToScreen: { 'op-1': 'ITEM_001' },
      })),
      quickVote: vi.fn(() => ({
        meetingId: MEETING_ID,
        agreed: [],
        unresolved: ['op-1'],
        votesInserted: 0,
      })),
      // 매 round 합의 안 되고 자식 의견 추가 — additions 있는 응답 시뮬레이션.
      freeDiscussionRound: vi.fn(() => ({
        meetingId: MEETING_ID,
        opinionId: 'op-1',
        agreed: false,
        additions: [],
        votesInserted: 0,
      })),
    } as unknown as OpinionService;

    const channelService = {
      get: vi.fn(() => makeChannel(2)), // maxRounds = 2
      list: vi.fn(() => []),
    } as unknown as ChannelService;

    const turnExecutorWithAdditions = {
      requestOpinionGather: vi.fn(async (speaker) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: 'ai_1',
          opinions: [
            { title: 't', content: 'c', rationale: 'r' },
          ],
        },
      })),
      requestQuickVote: vi.fn(async (speaker) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: 'ai_2',
          quick_votes: [
            { target_id: 'ITEM_001', vote: 'oppose' as const },
          ],
        },
      })),
      requestFreeDiscussion: vi.fn(async (speaker) => ({
        kind: 'ok' as const,
        providerId: speaker.id,
        messageId: 'msg',
        payload: {
          name: speaker.displayName,
          label: 'ai_3',
          votes: [],
          additions: [
            {
              parent_id: 'ITEM_001',
              kind: 'addition' as const,
              title: 't',
              content: 'c',
              rationale: 'r',
            },
          ],
        },
      })),
      abort: vi.fn(),
      getCircuitBreaker: vi.fn(),
    } as unknown as MeetingTurnExecutor;

    const deps = buildDeps({
      opinionService,
      channelService,
      turnExecutor: turnExecutorWithAdditions,
    });

    const orchestrator = new MeetingOrchestrator(deps);
    await orchestrator.run();

    const calls = (
      deps.runStepService.appendOne as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;

    // free_discussion 안 발화의 분류 결과 추출.
    const freeDiscRows = calls
      .map(([r]) => r)
      .filter((r) => {
        const inputObj = JSON.parse(r.inputJson as string);
        return inputObj.phase === 'free_discussion';
      });
    expect(freeDiscRows.length).toBeGreaterThan(0);

    // cap=2 + currentRound=2 인 발화에서 capOverride 발생 (output_json 검증).
    const capOverrideRows = freeDiscRows.filter((r) => {
      const out = JSON.parse(r.outputJson as string);
      return out.capOverride === true;
    });
    expect(capOverrideRows.length).toBeGreaterThan(0);
    for (const row of capOverrideRows) {
      expect(row.nextStepCard).toBe('end');
      // capOverride 발생 row 의 자연 분류는 'continue' 였어야 한다.
      const out = JSON.parse(row.outputJson as string);
      expect(out.natural).toBe('continue');
    }

    // 같은 capOverride row 의 stream payload 도 capOverride=true 로 통지.
    const streamCalls = (
      deps.streamBridge.emitNextStepClassified as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    const streamCapOverrideEvents = streamCalls
      .map(([p]) => p)
      .filter((p) => p.capOverride === true);
    expect(streamCapOverrideEvents.length).toBeGreaterThan(0);
    for (const evt of streamCapOverrideEvents) {
      expect(evt.card).toBe('end');
      expect(evt.phase).toBe('free_discussion');
    }
  });

  it('classifier throw 는 회의 흐름을 멈추지 않고 RunStep 만 skip', async () => {
    const deps = buildDeps();

    // RunStepService.appendOne 가 throw — 분류는 됐어도 영속이 실패.
    (deps.runStepService.appendOne as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('RunStep DB write failed (test)');
      },
    );

    const orchestrator = new MeetingOrchestrator(deps);
    // throw 무시되고 회의는 정상 종결되어야 한다.
    await expect(orchestrator.run()).resolves.toBeUndefined();
    expect(deps.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'accepted',
      null,
    );
  });
});

describe('MeetingOrchestrator — caller surface', () => {
  it('handleUserInterjection pushes user message to session buffer', () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);
    const before = deps.session.messages.length;
    orchestrator.handleUserInterjection({
      id: 'm',
      role: 'user',
      content: 'hi',
      participantId: 'user',
      participantName: 'User',
    });
    expect(deps.session.messages.length).toBe(before + 1);
  });

  it('injectInitialUserMessage also appends a user message', () => {
    const deps = buildDeps();
    const orchestrator = new MeetingOrchestrator(deps);
    const before = deps.session.messages.length;
    orchestrator.injectInitialUserMessage({
      id: 'm',
      role: 'user',
      content: 'hello',
      participantId: 'user',
      participantName: 'User',
    });
    expect(deps.session.messages.length).toBe(before + 1);
  });
});
