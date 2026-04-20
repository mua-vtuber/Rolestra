/**
 * v3-side-effects tests.
 *
 * We drive `wireV3SideEffects()` with a minimal SSM-shaped stub so we
 * can invoke the state-change / permission callbacks directly — no
 * need to walk the 12-state machine through legitimate transitions.
 * Services are mocked so assertions stay focused on "who called what
 * with which arguments".
 *
 * Coverage map:
 *   1. onStateChange → meetings.updateState + bridge.emitMeetingStateChanged
 *   2. DONE transition → #회의록 append + work_done notification
 *   3. FAILED transition → #회의록 append + error notification
 *   4. Missing `system_minutes` channel → append skipped, notification still fires
 *   5. R2-bridge sentinel (empty meetingId) → skips DB update, bridge still fires
 *   6. Breaker 'fired' → setAutonomy + approval + error notification
 *   7. Breaker approval failure does NOT skip notification (isolation)
 *   8. Disposer unwires state + permission + breaker listeners
 *   9. Service exception in state-change handler does not rethrow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  wireV3SideEffects,
  type V3SideEffectDeps,
} from '../v3-side-effects';
import type { SessionSnapshot } from '../../../shared/session-state-types';
import type { SsmContext } from '../../../shared/ssm-context-types';
import type {
  CircuitBreaker,
  CircuitBreakerFiredEvent,
} from '../../queue/circuit-breaker';
import { CIRCUIT_BREAKER_FIRED_EVENT } from '../../queue/circuit-breaker';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<SsmContext> = {}): SsmContext {
  return {
    meetingId: 'meet-1',
    channelId: 'ch-1',
    projectId: 'proj-1',
    projectPath: '/tmp/proj-1',
    permissionMode: 'hybrid',
    autonomyMode: 'manual',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    state: 'WORK_DISCUSSING',
    previousState: 'CONVERSATION',
    event: 'ROUND_COMPLETE',
    conversationRound: 1,
    modeJudgments: [],
    workRound: 0,
    retryCount: 0,
    proposal: null,
    proposalHash: null,
    aggregatorId: null,
    votes: [],
    workerId: null,
    projectPath: '/tmp/proj-1',
    timestamp: 1,
    conversationId: 'conv-1',
    ...overrides,
  };
}

interface SsmStub {
  ctx: SsmContext;
  stateListeners: Array<(snap: SessionSnapshot) => void>;
  permListeners: Array<(action: unknown) => void>;
  onStateChange: (cb: (snap: SessionSnapshot) => void) => () => void;
  onPermissionAction: (cb: (action: unknown) => void) => () => void;
  fireState: (snap: SessionSnapshot) => void;
}

function makeSsmStub(ctx: SsmContext): SsmStub {
  const stub: SsmStub = {
    ctx,
    stateListeners: [],
    permListeners: [],
    onStateChange: (cb) => {
      stub.stateListeners.push(cb);
      return () => {
        stub.stateListeners = stub.stateListeners.filter((l) => l !== cb);
      };
    },
    onPermissionAction: (cb) => {
      stub.permListeners.push(cb);
      return () => {
        stub.permListeners = stub.permListeners.filter((l) => l !== cb);
      };
    },
    fireState: (snap) => {
      for (const l of stub.stateListeners) l(snap);
    },
  };
  return stub;
}

interface MockDeps extends V3SideEffectDeps {
  breaker: CircuitBreaker & EventEmitter;
}

function makeMockDeps(minutesChannelId: string | null = 'minutes-1'): MockDeps {
  const breakerEmitter = new EventEmitter();

  const channelsList = minutesChannelId
    ? [
        { id: 'general-1', kind: 'system_general' },
        { id: 'approval-1', kind: 'system_approval' },
        { id: minutesChannelId, kind: 'system_minutes' },
      ]
    : [
        { id: 'general-1', kind: 'system_general' },
        { id: 'approval-1', kind: 'system_approval' },
      ];

  return {
    messages: { append: vi.fn() } as never,
    meetings: { updateState: vi.fn() } as never,
    approvals: { create: vi.fn() } as never,
    notifications: { show: vi.fn() } as never,
    projects: { setAutonomy: vi.fn() } as never,
    channels: {
      listByProject: vi.fn().mockReturnValue(channelsList),
    } as never,
    bridge: {
      emitMeetingStateChanged: vi.fn(),
    } as never,
    breaker: breakerEmitter as never,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('v3-side-effects — state change', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('non-terminal state: updates meeting + emits bridge event', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps();
    wireV3SideEffects(ssm as never, deps);

    ssm.fireState(makeSnapshot({ state: 'WORK_DISCUSSING' }));

    expect(deps.meetings.updateState).toHaveBeenCalledWith(
      'meet-1',
      'WORK_DISCUSSING',
      expect.any(String),
    );
    expect(deps.bridge.emitMeetingStateChanged).toHaveBeenCalledWith({
      meetingId: 'meet-1',
      channelId: 'ch-1',
      state: 'WORK_DISCUSSING',
    });
    // Non-terminal → no message append, no notification.
    expect(deps.messages.append).not.toHaveBeenCalled();
    expect(deps.notifications.show).not.toHaveBeenCalled();
  });

  it('R2-bridge sentinel meetingId=""  skips DB update but still emits bridge', () => {
    const ssm = makeSsmStub(makeCtx({ meetingId: '' }));
    const deps = makeMockDeps();
    wireV3SideEffects(ssm as never, deps);

    ssm.fireState(makeSnapshot({ state: 'VOTING' }));

    expect(deps.meetings.updateState).not.toHaveBeenCalled();
    expect(deps.bridge.emitMeetingStateChanged).toHaveBeenCalled();
  });

  it('DONE transition: appends summary to #회의록 + fires work_done notification', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps('minutes-1');
    wireV3SideEffects(ssm as never, deps);

    ssm.fireState(
      makeSnapshot({ state: 'DONE', proposal: 'Deploy at midnight' }),
    );

    expect(deps.messages.append).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'minutes-1',
        authorKind: 'system',
        role: 'system',
        content: expect.stringContaining('Deploy at midnight'),
      }),
    );
    expect(deps.notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'work_done',
        channelId: 'minutes-1',
      }),
    );
  });

  it('FAILED transition: appends fail message + fires error notification', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps('minutes-1');
    wireV3SideEffects(ssm as never, deps);

    ssm.fireState(
      makeSnapshot({ state: 'FAILED', previousState: 'VOTING' }),
    );

    expect(deps.messages.append).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'minutes-1',
        content: expect.stringContaining('VOTING'),
      }),
    );
    expect(deps.notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', channelId: 'minutes-1' }),
    );
  });

  it('no system_minutes channel: append skipped, notification still fires', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps(null);
    wireV3SideEffects(ssm as never, deps);

    ssm.fireState(makeSnapshot({ state: 'DONE', proposal: 'x' }));

    expect(deps.messages.append).not.toHaveBeenCalled();
    expect(deps.notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'work_done', channelId: null }),
    );
  });

  it('downstream service throw does not rethrow to the SSM', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps('minutes-1');
    (deps.meetings.updateState as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('sqlite gone');
      },
    );
    wireV3SideEffects(ssm as never, deps);

    expect(() =>
      ssm.fireState(makeSnapshot({ state: 'WORK_DISCUSSING' })),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    // Bridge still emits despite the meetings failure.
    expect(deps.bridge.emitMeetingStateChanged).toHaveBeenCalled();
  });
});

describe('v3-side-effects — circuit breaker', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("'fired' triggers setAutonomy + approval + notification", () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps();
    wireV3SideEffects(ssm as never, deps);

    const event: CircuitBreakerFiredEvent = {
      reason: 'files_per_turn',
      detail: { count: 42 },
    };
    deps.breaker.emit(CIRCUIT_BREAKER_FIRED_EVENT, event);

    expect(deps.projects.setAutonomy).toHaveBeenCalledWith('proj-1', 'manual');
    expect(deps.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'failure_report',
        projectId: 'proj-1',
        payload: expect.objectContaining({
          source: 'circuit_breaker',
          reason: 'files_per_turn',
        }),
      }),
    );
    expect(deps.notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        title: expect.stringContaining('breaker'),
      }),
    );
  });

  it('approval failure does NOT skip notification (isolation)', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps();
    (deps.approvals.create as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('approval DB failed');
      },
    );
    wireV3SideEffects(ssm as never, deps);

    deps.breaker.emit(CIRCUIT_BREAKER_FIRED_EVENT, {
      reason: 'queue_streak',
      detail: null,
    });

    expect(deps.projects.setAutonomy).toHaveBeenCalled();
    expect(deps.notifications.show).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('v3-side-effects — disposer', () => {
  it('removes state + permission + breaker listeners; subsequent events are ignored', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps();
    const dispose = wireV3SideEffects(ssm as never, deps);

    expect(ssm.stateListeners).toHaveLength(1);
    expect(ssm.permListeners).toHaveLength(1);
    expect(
      deps.breaker.listenerCount(CIRCUIT_BREAKER_FIRED_EVENT),
    ).toBe(1);

    dispose();

    expect(ssm.stateListeners).toHaveLength(0);
    expect(ssm.permListeners).toHaveLength(0);
    expect(
      deps.breaker.listenerCount(CIRCUIT_BREAKER_FIRED_EVENT),
    ).toBe(0);

    // After dispose, firing state or breaker should not invoke services.
    ssm.fireState(makeSnapshot({ state: 'WORK_DISCUSSING' }));
    deps.breaker.emit(CIRCUIT_BREAKER_FIRED_EVENT, {
      reason: 'same_error',
      detail: null,
    });

    expect(deps.meetings.updateState).not.toHaveBeenCalled();
    expect(deps.projects.setAutonomy).not.toHaveBeenCalled();
  });

  it('disposer is idempotent', () => {
    const ssm = makeSsmStub(makeCtx());
    const deps = makeMockDeps();
    const dispose = wireV3SideEffects(ssm as never, deps);

    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });
});
