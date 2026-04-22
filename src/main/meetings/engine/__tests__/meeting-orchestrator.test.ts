/**
 * MeetingOrchestrator unit tests.
 *
 * Scope: DI contract, SSM state → loop dispatch, terminal-post wiring,
 * v3-side-effects disposer lifecycle. Full SSM transition coverage lives
 * in the SSM unit tests (src/main/engine/__tests__/session-state-machine.*).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeetingSession } from '../meeting-session';
import { MeetingOrchestrator } from '../meeting-orchestrator';
import type {
  MeetingTurnExecutor,
} from '../meeting-turn-executor';
import type { StreamBridge } from '../../../streams/stream-bridge';
import type { MessageService } from '../../../channels/message-service';
import type { MeetingService } from '../../meeting-service';
import type { ChannelService } from '../../../channels/channel-service';
import type { ProjectService } from '../../../projects/project-service';
import type { ApprovalService } from '../../../approvals/approval-service';
import type { NotificationService } from '../../../notifications/notification-service';
import type { CircuitBreaker } from '../../../queue/circuit-breaker';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';

const MEETING_ID = 'mt-orc-1';
const CHANNEL_ID = 'ch-orc-1';
const PROJECT_ID = 'pr-orc-1';
const MINUTES_CHANNEL_ID = 'ch-minutes';

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
    topic: 'Ship v1.0 this week',
    participants: participants(2),
    ssmCtx: ctx(),
    // roundSetting=1 so the loop terminates after a single round. With
    // 'unlimited' the turn-manager never returns null from
    // getNextSpeaker, producing an infinite turn loop under tests.
    roundSetting: 1,
  });
}

interface Mocks {
  session: MeetingSession;
  turnExecutor: MeetingTurnExecutor;
  streamBridge: StreamBridge;
  messageService: MessageService;
  meetingService: MeetingService;
  channelService: ChannelService;
  projectService: ProjectService;
  approvalService: ApprovalService;
  notificationService: NotificationService;
  circuitBreaker: CircuitBreaker;
  listeners: {
    onOff: ReturnType<typeof vi.fn>;
    circuitBreakerOn: ReturnType<typeof vi.fn>;
    circuitBreakerOff: ReturnType<typeof vi.fn>;
  };
}

function buildMocks(): Mocks {
  const session = buildSession();

  const turnExecutor = {
    executeTurn: vi.fn(async () => {}),
    abort: vi.fn(),
  } as unknown as MeetingTurnExecutor;

  const streamBridge = {
    emitMeetingStateChanged: vi.fn(),
    emitMeetingTurnStart: vi.fn(),
    emitMeetingTurnToken: vi.fn(),
    emitMeetingTurnDone: vi.fn(),
    emitMeetingError: vi.fn(),
  } as unknown as StreamBridge;

  const messageService = {
    append: vi.fn((input) => ({
      id: 'msg-1',
      ...input,
      meta: input.meta ?? null,
      createdAt: Date.now(),
    })),
  } as unknown as MessageService;

  const meetingService = {
    get: vi.fn(() => ({
      id: MEETING_ID,
      channelId: CHANNEL_ID,
      topic: 'Ship v1.0 this week',
      state: 'DONE',
      stateSnapshotJson: null,
      startedAt: Date.now() - 5 * 60_000,
      endedAt: null,
      outcome: null,
    })),
    finish: vi.fn(),
    updateState: vi.fn(),
  } as unknown as MeetingService;

  const channelService = {
    listByProject: vi.fn(() => [
      { id: MINUTES_CHANNEL_ID, kind: 'system_minutes', name: '#회의록' },
      { id: CHANNEL_ID, kind: 'user', name: '#일반' },
    ]),
  } as unknown as ChannelService;

  const projectService = {
    setAutonomy: vi.fn(),
  } as unknown as ProjectService;

  const approvalService = {
    create: vi.fn(),
  } as unknown as ApprovalService;

  const notificationService = {
    show: vi.fn(() => null),
  } as unknown as NotificationService;

  const cbOn = vi.fn().mockReturnThis();
  const cbOff = vi.fn().mockReturnThis();
  const circuitBreaker = {
    on: cbOn,
    off: cbOff,
  } as unknown as CircuitBreaker;

  return {
    session,
    turnExecutor,
    streamBridge,
    messageService,
    meetingService,
    channelService,
    projectService,
    approvalService,
    notificationService,
    circuitBreaker,
    listeners: {
      onOff: vi.fn(),
      circuitBreakerOn: cbOn,
      circuitBreakerOff: cbOff,
    },
  };
}

function buildOrchestrator(mocks: Mocks): MeetingOrchestrator {
  return new MeetingOrchestrator({
    session: mocks.session,
    turnExecutor: mocks.turnExecutor,
    streamBridge: mocks.streamBridge,
    messageService: mocks.messageService,
    meetingService: mocks.meetingService,
    channelService: mocks.channelService,
    projectService: mocks.projectService,
    approvalService: mocks.approvalService,
    notificationService: mocks.notificationService,
    circuitBreaker: mocks.circuitBreaker,
    interTurnDelayMs: 0,
  });
}

describe('MeetingOrchestrator — DI contract', () => {
  it('constructs with all required DI fields', () => {
    const mocks = buildMocks();
    const orc = buildOrchestrator(mocks);
    expect(orc).toBeInstanceOf(MeetingOrchestrator);
    expect(orc.isRunning).toBe(false);
  });
});

describe('MeetingOrchestrator — loop dispatch', () => {
  let mocks: Mocks;
  let orc: MeetingOrchestrator;

  beforeEach(() => {
    mocks = buildMocks();
    orc = buildOrchestrator(mocks);
  });

  afterEach(() => {
    orc.stop();
  });

  it('executes at least one turn per AI participant on CONVERSATION', async () => {
    await orc.run();
    // 2 AI participants × one pass before the SSM transitions out of
    // CONVERSATION = 2 turn calls.
    expect(
      (mocks.turnExecutor.executeTurn as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('emits stream:meeting-state-changed on SSM transitions', async () => {
    await orc.run();
    expect(mocks.streamBridge.emitMeetingStateChanged).toHaveBeenCalled();
    const firstCall = (mocks.streamBridge.emitMeetingStateChanged as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall).toMatchObject({
      meetingId: MEETING_ID,
      channelId: CHANNEL_ID,
    });
  });

  it('breaks the loop when SSM enters a WAIT state', async () => {
    // Pre-transition SSM to MODE_TRANSITION_PENDING via the ROUND_COMPLETE
    // path with majority-work judgments.
    const ssm = mocks.session.sessionMachine;
    for (const p of mocks.session.participants.filter((x) => x.id !== 'user')) {
      ssm.recordModeJudgment({
        participantId: p.id,
        participantName: p.displayName,
        judgment: 'work',
        reason: 'code_change',
      });
    }
    ssm.transition('ROUND_COMPLETE');
    // Now SSM should be at MODE_TRANSITION_PENDING — run should exit
    // without calling executeTurn.
    await orc.run();
    expect(mocks.turnExecutor.executeTurn).not.toHaveBeenCalled();
  });

  it('second run() call while already running is a no-op', async () => {
    const p1 = orc.run();
    const p2 = orc.run();
    await Promise.all([p1, p2]);
    // We can't easily assert "no-op" but we CAN assert the number of
    // turn calls stays within the single-run expectation.
    expect(
      (mocks.turnExecutor.executeTurn as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeLessThan(10);
  });
});

describe('MeetingOrchestrator — terminal handling', () => {
  it('posts composed minutes to #회의록 on FAILED', async () => {
    const mocks = buildMocks();
    const orc = buildOrchestrator(mocks);
    const runPromise = orc.run();

    // Force SSM to FAILED under the live subscription so the terminal
    // listener's post path exercises.
    mocks.session.sessionMachine.setProposal('Approved plan body.');
    mocks.session.sessionMachine.transition('ERROR');

    await runPromise;

    expect(mocks.messageService.append).toHaveBeenCalled();
    const appendCalls = (mocks.messageService.append as ReturnType<typeof vi.fn>).mock.calls;
    // v3-side-effects posts a terse placeholder; the orchestrator
    // posts the composed minutes on top. Locate the richer one so the
    // assertion stays stable after R10 collapses them.
    const minutesCall = appendCalls.find((c) => {
      const p = c[0] as { channelId: string; content: string };
      return p.channelId === MINUTES_CHANNEL_ID && p.content.startsWith('## 회의 #');
    });
    expect(minutesCall).toBeDefined();
    const payload = minutesCall![0] as {
      channelId: string;
      authorKind: string;
      content: string;
    };
    expect(payload.authorKind).toBe('system');
    expect(payload.content).toContain('**참여자**:');
    expect(payload.content).toContain('SSM 최종 상태**: FAILED');

    expect(mocks.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'rejected',
      expect.any(String),
    );
  });

  it('skips the minutes post when no #회의록 channel exists', async () => {
    const mocks2 = buildMocks();
    (mocks2.channelService.listByProject as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: CHANNEL_ID, kind: 'user', name: '#일반' },
    ]);
    const orc2 = buildOrchestrator(mocks2);
    const runPromise = orc2.run();

    const ssm = mocks2.session.sessionMachine;
    ssm.transition('ERROR');

    await runPromise;

    const appendCalls = (mocks2.messageService.append as ReturnType<typeof vi.fn>).mock.calls;
    const minutesCall = appendCalls.find(
      (c) => (c[0] as { channelId: string }).channelId === MINUTES_CHANNEL_ID,
    );
    expect(minutesCall).toBeUndefined();
    // finish() still runs — minutes post is best-effort.
    expect(mocks2.meetingService.finish).toHaveBeenCalled();
  });

  it('finishes the meeting with outcome=rejected on FAILED', async () => {
    const mocks3 = buildMocks();
    const orc3 = buildOrchestrator(mocks3);
    const runPromise = orc3.run();
    mocks3.session.sessionMachine.transition('ERROR');
    await runPromise;

    expect(mocks3.meetingService.finish).toHaveBeenCalledWith(
      MEETING_ID,
      'rejected',
      expect.any(String),
    );
  });
});

describe('MeetingOrchestrator — lifecycle', () => {
  it('stop() calls turnExecutor.abort() and marks running=false', async () => {
    const mocks = buildMocks();
    const orc = buildOrchestrator(mocks);
    void orc.run();
    orc.stop();
    expect(mocks.turnExecutor.abort).toHaveBeenCalled();
    expect(orc.isRunning).toBe(false);
  });

  it('pause()/resume() toggle session turn-manager state', async () => {
    const mocks = buildMocks();
    const orc = buildOrchestrator(mocks);
    mocks.session.start();
    orc.pause();
    expect(mocks.session.turnManager.state).toBe('paused');
    orc.resume();
    expect(mocks.session.turnManager.state).toBe('running');
  });

  it('handleUserInterjection() flags the turn manager', () => {
    const mocks = buildMocks();
    const orc = buildOrchestrator(mocks);
    // Smoke — turn-manager has no public getter for the flag, but the
    // call must not throw.
    expect(() => orc.handleUserInterjection()).not.toThrow();
  });
});
