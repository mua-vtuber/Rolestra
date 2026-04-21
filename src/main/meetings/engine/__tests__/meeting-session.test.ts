import { describe, it, expect } from 'vitest';
import {
  MeetingSession,
  type MeetingSessionOptions,
} from '../meeting-session';
import type { Participant } from '../../../../shared/engine-types';
import type { SsmContext } from '../../../../shared/ssm-context-types';

const MEETING_ID = 'mt-1';
const CHANNEL_ID = 'ch-1';
const PROJECT_ID = 'pr-1';

function buildCtx(overrides: Partial<SsmContext> = {}): SsmContext {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    projectPath: '/tmp/project',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
    ...overrides,
  };
}

function buildParticipants(count: number = 2): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ai-${i + 1}`,
    displayName: `AI ${i + 1}`,
    providerId: `ai-${i + 1}`,
    isActive: true,
  }));
}

function buildOptions(
  overrides: Partial<MeetingSessionOptions> = {},
): MeetingSessionOptions {
  return {
    meetingId: MEETING_ID,
    channelId: CHANNEL_ID,
    projectId: PROJECT_ID,
    topic: 'Discuss release plan',
    participants: buildParticipants(2),
    ssmCtx: buildCtx(),
    ...overrides,
  };
}

describe('MeetingSession — construction validation', () => {
  it('rejects empty meetingId', () => {
    expect(() =>
      new MeetingSession(buildOptions({ meetingId: '' })),
    ).toThrow(/meetingId/);
  });

  it('rejects empty channelId', () => {
    expect(() =>
      new MeetingSession(buildOptions({ channelId: '' })),
    ).toThrow(/channelId/);
  });

  it('rejects empty projectId', () => {
    expect(() =>
      new MeetingSession(buildOptions({ projectId: '' })),
    ).toThrow(/projectId/);
  });

  it('rejects short topic', () => {
    expect(() => new MeetingSession(buildOptions({ topic: 'ok' }))).toThrow(
      /topic/,
    );
  });

  it('rejects ssmCtx.meetingId mismatch', () => {
    expect(() =>
      new MeetingSession(
        buildOptions({ ssmCtx: buildCtx({ meetingId: 'wrong' }) }),
      ),
    ).toThrow(/ssmCtx\.meetingId/);
  });

  it('rejects ssmCtx.channelId mismatch', () => {
    expect(() =>
      new MeetingSession(
        buildOptions({ ssmCtx: buildCtx({ channelId: 'wrong' }) }),
      ),
    ).toThrow(/ssmCtx\.channelId/);
  });

  it('rejects ssmCtx.projectId mismatch', () => {
    expect(() =>
      new MeetingSession(
        buildOptions({ ssmCtx: buildCtx({ projectId: 'wrong' }) }),
      ),
    ).toThrow(/ssmCtx\.projectId/);
  });

  it('rejects single-AI meeting (R6 D7: participants>=2)', () => {
    expect(() =>
      new MeetingSession(buildOptions({ participants: buildParticipants(1) })),
    ).toThrow(/at least 2/);
  });

  it('rejects zero-AI meeting even when user sentinel is present', () => {
    const participants: Participant[] = [
      { id: 'user', displayName: 'User', isActive: true },
      { id: 'ai-1', displayName: 'AI 1', providerId: 'ai-1', isActive: true },
    ];
    expect(() =>
      new MeetingSession(buildOptions({ participants })),
    ).toThrow(/at least 2/);
  });

  it('accepts exactly 2 AI participants', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.meetingId).toBe(MEETING_ID);
    expect(session.channelId).toBe(CHANNEL_ID);
    expect(session.projectId).toBe(PROJECT_ID);
    expect(session.sessionMachine).not.toBeNull();
  });

  it('accepts user sentinel alongside 2 AI participants', () => {
    const participants: Participant[] = [
      { id: 'user', displayName: 'User', isActive: true },
      ...buildParticipants(2),
    ];
    const session = new MeetingSession(buildOptions({ participants }));
    expect(session.participants).toHaveLength(3);
  });
});

describe('MeetingSession — state and message management', () => {
  it('defaults title to topic when not provided', () => {
    const session = new MeetingSession(buildOptions({ topic: 'planning' }));
    expect(session.title).toBe('planning');
  });

  it('honours explicit title override', () => {
    const session = new MeetingSession(
      buildOptions({ topic: 'planning', title: 'Sprint Planning' }),
    );
    expect(session.title).toBe('Sprint Planning');
  });

  it('createMessage pushes into messages buffer and returns the row', () => {
    const session = new MeetingSession(buildOptions());
    const msg = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI 1',
      role: 'assistant',
      content: 'hello',
    });
    expect(session.messages).toHaveLength(1);
    expect(msg.participantId).toBe('ai-1');
    expect(msg.content).toBe('hello');
  });

  it('getMessagesForProvider returns provider-adapted history', () => {
    const session = new MeetingSession(buildOptions());
    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI 1',
      role: 'assistant',
      content: 'hi',
    });
    session.createMessage({
      participantId: 'ai-2',
      participantName: 'AI 2',
      role: 'assistant',
      content: 'hey',
    });
    const forAi1 = session.getMessagesForProvider('ai-1');
    expect(forAi1.length).toBeGreaterThan(0);
  });
});

describe('MeetingSession — SSM wiring', () => {
  it('forwards setProjectPath to the SSM', () => {
    const session = new MeetingSession(buildOptions());
    session.setProjectPath('/new/path');
    // Indirect check: SSM retained the call — toInfo() surfaces nothing
    // path-specific, so we rely on absence of throw.
    expect(session.sessionMachine).toBeTruthy();
  });

  it('SSM is constructed and receives ctx with the meeting identity', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.sessionMachine).toBeTruthy();
    expect(session.sessionMachine.ctx.meetingId).toBe(MEETING_ID);
    expect(session.sessionMachine.ctx.channelId).toBe(CHANNEL_ID);
    expect(session.sessionMachine.ctx.projectId).toBe(PROJECT_ID);
  });
});

describe('MeetingSession — deep debate', () => {
  it('tracks deep-debate turn count with default budget 30', () => {
    const session = new MeetingSession(buildOptions());
    expect(session.deepDebateActive).toBe(false);
    expect(session.deepDebateTurnsRemaining).toBe(0);

    session.startDeepDebate();
    expect(session.deepDebateActive).toBe(true);
    expect(session.deepDebateTurnsRemaining).toBe(30);

    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(1);
    expect(session.deepDebateTurnsRemaining).toBe(29);

    session.stopDeepDebate();
    expect(session.deepDebateActive).toBe(false);
    expect(session.deepDebateTurnsUsed).toBe(0);
  });

  it('honours taskSettings.deepDebateTurnBudget override', () => {
    const session = new MeetingSession(
      buildOptions({
        taskSettings: { deepDebateTurnBudget: 5 } as never,
      }),
    );
    session.startDeepDebate();
    expect(session.deepDebateTurnsRemaining).toBe(5);
  });
});

describe('MeetingSession — lifecycle + serialization', () => {
  it('start/pause/resume/stop forward to turn manager', () => {
    const session = new MeetingSession(buildOptions());
    expect(() => session.start()).not.toThrow();
    expect(() => session.pause()).not.toThrow();
    expect(() => session.resume()).not.toThrow();
    expect(() => session.stop()).not.toThrow();
  });

  it('toInfo exposes identity + metadata, no message bodies', () => {
    const session = new MeetingSession(buildOptions());
    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI 1',
      role: 'assistant',
      content: 'secret content',
    });
    const info = session.toInfo();
    expect(info.meetingId).toBe(MEETING_ID);
    expect(info.channelId).toBe(CHANNEL_ID);
    expect(info.projectId).toBe(PROJECT_ID);
    // Type-level check: no message bodies in toInfo() payload.
    expect((info as unknown as { messages?: unknown }).messages).toBeUndefined();
  });
});
