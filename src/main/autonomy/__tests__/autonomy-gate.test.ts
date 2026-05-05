/**
 * Unit tests for AutonomyGate (R9-Task5).
 *
 * Coverage:
 *   - manual → no side-effects, approval left pending.
 *   - auto_toggle:
 *     - mode_transition(target=auto) → decide(approve) + minutes trace +
 *       work_done notification.
 *     - review_outcome(outcome=accepted) → auto accept.
 *     - review_outcome(outcome=rework/fail) → downgrade path, no decide.
 *     - cli_permission → downgrade path, no decide.
 *   - queue: same policy as auto_toggle (review_outcome accepted).
 *   - Downgrade path calls setAutonomy('manual', reason='autonomy_gate_fail')
 *     and posts the correct minutes trace + error notification.
 *   - failure isolation: downstream throws do not rethrow into the
 *     approvalService listener chain.
 *   - wire() idempotency + disposer.
 *
 * R12-C2 T10b: 옛 consensus_decision kind 폐기 — 본 fixture default 와
 * dedicated consensus_decision 테스트가 review_outcome / mode_transition 으로
 * 대체됨.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem, ApprovalKind } from '../../../shared/approval-types';
import type { AutonomyMode } from '../../../shared/project-types';
import { APPROVAL_CREATED_EVENT } from '../../approvals/approval-service';
import {
  AutonomyGate,
  AUTONOMY_GATE_AUTO_COMMENT,
  evaluateDecision,
  type AutonomyGateDeps,
} from '../autonomy-gate';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'appr-1',
    kind: 'review_outcome',
    projectId: 'p-1',
    channelId: 'c-1',
    meetingId: 'm-1',
    requesterId: null,
    payload: null,
    status: 'pending',
    decisionComment: null,
    createdAt: 1_700_000_000_000,
    decidedAt: null,
    ...overrides,
  };
}

interface Harness {
  approvalService: EventEmitter;
  decideSpy: ReturnType<typeof vi.fn>;
  getProjectSpy: ReturnType<typeof vi.fn>;
  setAutonomySpy: ReturnType<typeof vi.fn>;
  notifySpy: ReturnType<typeof vi.fn>;
  appendSpy: ReturnType<typeof vi.fn>;
  listByProjectSpy: ReturnType<typeof vi.fn>;
  gate: AutonomyGate;
  dispose: () => void;
  emitCreated(item: ApprovalItem): void;
}

function makeHarness(options: {
  autonomyMode?: AutonomyMode;
  projectReturn?: { id: string; autonomyMode: AutonomyMode } | null;
  notifyThrows?: Error;
  decideThrows?: Error;
  setAutonomyThrows?: Error;
  appendThrows?: Error;
  listByProjectThrows?: Error;
  minutesChannelId?: string | null;
} = {}): Harness {
  const approvalService = new EventEmitter();
  const decideSpy = vi.fn(() => {
    if (options.decideThrows) throw options.decideThrows;
  });
  const projectRow =
    options.projectReturn !== undefined
      ? options.projectReturn
      : { id: 'p-1', autonomyMode: options.autonomyMode ?? 'auto_toggle' };
  const getProjectSpy = vi.fn(() => projectRow);
  const setAutonomySpy = vi.fn(() => {
    if (options.setAutonomyThrows) throw options.setAutonomyThrows;
  });
  const notifySpy = vi.fn(() => {
    if (options.notifyThrows) throw options.notifyThrows;
    return null;
  });
  const appendSpy = vi.fn(() => {
    if (options.appendThrows) throw options.appendThrows;
  });
  const listByProjectSpy = vi.fn(() => {
    if (options.listByProjectThrows) throw options.listByProjectThrows;
    const minutesId =
      options.minutesChannelId !== undefined
        ? options.minutesChannelId
        : 'minutes-c-1';
    if (minutesId === null) return [];
    return [
      { id: 'general-c-1', kind: 'system_general' },
      { id: minutesId, kind: 'system_minutes' },
    ];
  });

  const deps: AutonomyGateDeps = {
    approvalService: {
      on: approvalService.on.bind(approvalService) as never,
      off: approvalService.off.bind(approvalService) as never,
      decide: decideSpy as never,
    },
    projectService: {
      get: getProjectSpy as never,
      setAutonomy: setAutonomySpy as never,
    },
    notificationService: { show: notifySpy as never },
    messageService: { append: appendSpy as never },
    channelService: { listByProject: listByProjectSpy as never },
  };

  const gate = new AutonomyGate(deps);
  const dispose = gate.wire();
  return {
    approvalService,
    decideSpy,
    getProjectSpy,
    setAutonomySpy,
    notifySpy,
    appendSpy,
    listByProjectSpy,
    gate,
    dispose,
    emitCreated(item) {
      approvalService.emit(APPROVAL_CREATED_EVENT, item);
    },
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('AutonomyGate — manual mode', () => {
  it('manual → no decide / setAutonomy / notify / minutes', () => {
    const h = makeHarness({ autonomyMode: 'manual' });
    h.emitCreated(makeItem());
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).not.toHaveBeenCalled();
    expect(h.notifySpy).not.toHaveBeenCalled();
    expect(h.appendSpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('no projectId on the approval → skip entirely', () => {
    const h = makeHarness();
    h.emitCreated(makeItem({ projectId: null }));
    expect(h.getProjectSpy).not.toHaveBeenCalled();
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('unknown project (get returns null) → skip entirely', () => {
    const h = makeHarness({ projectReturn: null });
    h.emitCreated(makeItem());
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).not.toHaveBeenCalled();
    h.dispose();
  });
});

describe('AutonomyGate — auto_toggle accept path', () => {
  it('mode_transition(target=auto) → decide(approve) + minutes + work_done', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'mode_transition',
        payload: {
          kind: 'mode_transition',
          currentMode: 'approval',
          targetMode: 'auto',
        },
      }),
    );
    expect(h.decideSpy).toHaveBeenCalledWith(
      'appr-1',
      'approve',
      AUTONOMY_GATE_AUTO_COMMENT,
    );
    expect(h.setAutonomySpy).not.toHaveBeenCalled();
    expect(h.appendSpy).toHaveBeenCalledTimes(1);
    const msg = h.appendSpy.mock.calls[0][0];
    expect(msg.channelId).toBe('minutes-c-1');
    expect(msg.authorKind).toBe('system');
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('모드 전환');
    expect(msg.content).toContain('자동 수락');
    expect(h.notifySpy).toHaveBeenCalledTimes(1);
    const notif = h.notifySpy.mock.calls[0][0];
    expect(notif.kind).toBe('work_done');
    expect(notif.body).toContain('모드 전환');
    h.dispose();
  });

  it('mode_transition(target=hybrid) → accept', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'mode_transition',
        payload: {
          kind: 'mode_transition',
          currentMode: 'approval',
          targetMode: 'hybrid',
        },
      }),
    );
    expect(h.decideSpy).toHaveBeenCalledWith(
      'appr-1',
      'approve',
      AUTONOMY_GATE_AUTO_COMMENT,
    );
    h.dispose();
  });

  it('review_outcome(outcome=accepted) → decide(approve)', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'review_outcome',
        payload: { outcome: 'accepted' },
      }),
    );
    expect(h.decideSpy).toHaveBeenCalledWith(
      'appr-1',
      'approve',
      AUTONOMY_GATE_AUTO_COMMENT,
    );
    h.dispose();
  });
});

describe('AutonomyGate — auto_toggle downgrade path', () => {
  it('review_outcome(outcome=rework) → setAutonomy(manual) + no decide', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'review_outcome',
        payload: { outcome: 'rework' },
      }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    const msg = h.appendSpy.mock.calls[0][0];
    expect(msg.content).toContain('manual로 강제 전환');
    const notif = h.notifySpy.mock.calls[0][0];
    expect(notif.kind).toBe('error');
    h.dispose();
  });

  it('cli_permission → downgrade (no auto-accept)', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'cli_permission',
        payload: {
          kind: 'cli_permission',
          cliRequestId: 'cli-1',
          toolName: 'Bash',
          target: 'rm -rf /',
          description: null,
          participantId: 'prov-a',
          participantName: 'Alpha',
        },
      }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    h.dispose();
  });

  it('review_outcome(outcome=fail) → downgrade', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'review_outcome',
        payload: { outcome: 'fail' },
      }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    h.dispose();
  });

  it('failure_report → downgrade', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(makeItem({ kind: 'failure_report', payload: {} }));
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    h.dispose();
  });

  it('mode_transition(target=approval) → downgrade (stricter-side default)', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.emitCreated(
      makeItem({
        kind: 'mode_transition',
        payload: {
          kind: 'mode_transition',
          currentMode: 'auto',
          targetMode: 'approval',
        },
      }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    h.dispose();
  });
});

describe('AutonomyGate — queue mode parity with auto_toggle', () => {
  it('queue + review_outcome accepted → decide(approve)', () => {
    const h = makeHarness({ autonomyMode: 'queue' });
    h.emitCreated(
      makeItem({
        kind: 'review_outcome',
        payload: { outcome: 'accepted' },
      }),
    );
    expect(h.decideSpy).toHaveBeenCalledWith(
      'appr-1',
      'approve',
      AUTONOMY_GATE_AUTO_COMMENT,
    );
    h.dispose();
  });

  it('queue + review_outcome rework → downgrade (same as auto_toggle)', () => {
    const h = makeHarness({ autonomyMode: 'queue' });
    h.emitCreated(
      makeItem({
        kind: 'review_outcome',
        payload: { outcome: 'rework' },
      }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.setAutonomySpy).toHaveBeenCalledWith('p-1', 'manual', {
      reason: 'autonomy_gate_fail',
    });
    h.dispose();
  });
});

describe('AutonomyGate — failure isolation', () => {
  // R12-C2 T10b: accept-path fixture 를 mode_transition(target=auto) 로 통일
  // (옛 consensus_decision+payload=null 의 자리를 채운다).
  const acceptItem = (): Parameters<typeof makeItem>[0] => ({
    kind: 'mode_transition',
    payload: { kind: 'mode_transition', currentMode: 'manual', targetMode: 'auto' },
  });

  it('decide throws → no rethrow, downstream side-effects still skipped safely', () => {
    const h = makeHarness({
      autonomyMode: 'auto_toggle',
      decideThrows: new Error('sqlite down'),
    });
    expect(() => h.emitCreated(makeItem(acceptItem()))).not.toThrow();
    // When decide fails we intentionally abort the trace + notification
    // — without a real decision the notification would be misleading.
    expect(h.appendSpy).not.toHaveBeenCalled();
    expect(h.notifySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    h.dispose();
  });

  it('setAutonomy throws → downgrade trace + error notification still run', () => {
    const h = makeHarness({
      autonomyMode: 'auto_toggle',
      setAutonomyThrows: new Error('db down'),
    });
    expect(() =>
      h.emitCreated(makeItem({ kind: 'cli_permission', payload: null })),
    ).not.toThrow();
    expect(h.appendSpy).toHaveBeenCalledTimes(1);
    expect(h.notifySpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    h.dispose();
  });

  it('notificationService.show throws → warn, no rethrow', () => {
    const h = makeHarness({
      autonomyMode: 'auto_toggle',
      notifyThrows: new Error('adapter down'),
    });
    expect(() => h.emitCreated(makeItem(acceptItem()))).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    h.dispose();
  });

  it('missing #회의록 channel → accept path still decides; minutes quietly skipped', () => {
    const h = makeHarness({
      autonomyMode: 'auto_toggle',
      minutesChannelId: null,
    });
    h.emitCreated(makeItem(acceptItem()));
    expect(h.decideSpy).toHaveBeenCalledTimes(1);
    expect(h.appendSpy).not.toHaveBeenCalled();
    expect(h.notifySpy).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('channelService.listByProject throws → gate continues without minutes', () => {
    const h = makeHarness({
      autonomyMode: 'auto_toggle',
      listByProjectThrows: new Error('repo down'),
    });
    expect(() => h.emitCreated(makeItem(acceptItem()))).not.toThrow();
    expect(h.decideSpy).toHaveBeenCalledTimes(1);
    expect(h.appendSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    h.dispose();
  });
});

describe('AutonomyGate — lifecycle', () => {
  it('dispose() removes the listener', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.dispose();
    h.emitCreated(
      makeItem({ kind: 'review_outcome', payload: null }),
    );
    expect(h.decideSpy).not.toHaveBeenCalled();
    expect(h.approvalService.listenerCount(APPROVAL_CREATED_EVENT)).toBe(0);
  });

  it('wire() is idempotent — second call does not double-subscribe', () => {
    const h = makeHarness({ autonomyMode: 'auto_toggle' });
    h.gate.wire();
    expect(h.approvalService.listenerCount(APPROVAL_CREATED_EVENT)).toBe(1);
    h.dispose();
  });
});

describe('evaluateDecision — pure policy table', () => {
  const cases: Array<{
    name: string;
    kind: ApprovalKind;
    payload: unknown;
    expected: 'accept' | 'downgrade';
  }> = [
    {
      name: 'mode_transition auto',
      kind: 'mode_transition',
      payload: { targetMode: 'auto' },
      expected: 'accept',
    },
    {
      name: 'mode_transition hybrid',
      kind: 'mode_transition',
      payload: { targetMode: 'hybrid' },
      expected: 'accept',
    },
    {
      name: 'mode_transition approval',
      kind: 'mode_transition',
      payload: { targetMode: 'approval' },
      expected: 'downgrade',
    },
    {
      name: 'review_outcome accepted',
      kind: 'review_outcome',
      payload: { outcome: 'accepted' },
      expected: 'accept',
    },
    {
      name: 'review_outcome missing',
      kind: 'review_outcome',
      payload: null,
      expected: 'downgrade',
    },
    {
      name: 'cli_permission',
      kind: 'cli_permission',
      payload: null,
      expected: 'downgrade',
    },
    {
      name: 'failure_report',
      kind: 'failure_report',
      payload: null,
      expected: 'downgrade',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const item = makeItem({ kind: c.kind, payload: c.payload });
      const result = evaluateDecision(item);
      expect(result.kind).toBe(c.expected);
    });
  }
});
