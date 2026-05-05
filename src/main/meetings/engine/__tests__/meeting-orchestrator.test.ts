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
import type { RunStepService } from '../../run-step/run-step-service';
import type { RunStep, NewRunStep } from '../../../../shared/run-step-types';

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
    interTurnDelayMs: 0,
    onFinalized: overrides.onFinalized,
  };
}

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
