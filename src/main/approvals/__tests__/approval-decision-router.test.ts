/**
 * Unit tests for ApprovalDecisionRouter (R7-Task8).
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../shared/approval-types';
import { APPROVAL_DECIDED_EVENT } from '../approval-service';
import type { ApprovalDecidedPayload } from '../approval-service';
import { ApprovalDecisionRouter } from '../approval-decision-router';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'appr-1',
    kind: 'mode_transition',
    projectId: 'p-1',
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: {
      kind: 'mode_transition',
      currentMode: 'hybrid',
      targetMode: 'approval',
    },
    status: 'approved',
    decisionComment: null,
    createdAt: 1_700_000_000_000,
    decidedAt: 1_700_000_001_000,
    ...overrides,
  };
}

interface Harness {
  approvalService: EventEmitter;
  projectService: {
    applyPermissionModeChange: ReturnType<typeof vi.fn>;
    setPendingAdvisory: ReturnType<typeof vi.fn>;
  };
  router: ApprovalDecisionRouter;
  dispose: () => void;
  emitDecided(payload: ApprovalDecidedPayload): void;
}

function makeHarness(
  options: { applyThrows?: Error; advisoryThrows?: Error } = {},
): Harness {
  const approvalService = new EventEmitter();
  const applyPermissionModeChange = vi.fn((id: string) => {
    if (options.applyThrows) throw options.applyThrows;
    return { id, permissionMode: 'approval' };
  });
  const setPendingAdvisory = vi.fn((_projectId: string, _advisory: string) => {
    if (options.advisoryThrows) throw options.advisoryThrows;
  });
  const projectService = { applyPermissionModeChange, setPendingAdvisory };
  const router = new ApprovalDecisionRouter({
    approvalService,
    projectService,
  });
  const dispose = router.wire();
  return {
    approvalService,
    projectService,
    router,
    dispose,
    emitDecided(payload) {
      approvalService.emit(APPROVAL_DECIDED_EVENT, payload);
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

describe('ApprovalDecisionRouter — mode_transition routing', () => {
  it('approve + mode_transition → applyPermissionModeChange called with approval id', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.applyPermissionModeChange).toHaveBeenCalledWith(
      'appr-1',
    );
    h.dispose();
  });

  it('conditional + mode_transition → applyPermissionModeChange called', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'conditional',
      comment: '읽기 전용 경로만',
    });
    expect(h.projectService.applyPermissionModeChange).toHaveBeenCalledWith(
      'appr-1',
    );
    h.dispose();
  });

  it('reject + mode_transition → no apply call', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem(),
      decision: 'reject',
      comment: '거절',
    });
    expect(h.projectService.applyPermissionModeChange).not.toHaveBeenCalled();
    h.dispose();
  });
});

describe('ApprovalDecisionRouter — other kinds are skipped (Task 9 handles consensus_decision)', () => {
  it('cli_permission → no apply call', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ kind: 'cli_permission' }),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.applyPermissionModeChange).not.toHaveBeenCalled();
    h.dispose();
  });

  it('consensus_decision → no apply call (R7-Task9 will wire this kind)', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ kind: 'consensus_decision' }),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.applyPermissionModeChange).not.toHaveBeenCalled();
    h.dispose();
  });
});

describe('ApprovalDecisionRouter — failure isolation', () => {
  it('apply throws → warn logged, no rethrow', () => {
    const h = makeHarness({ applyThrows: new Error('TOCTOU') });
    expect(() =>
      h.emitDecided({
        item: makeItem(),
        decision: 'approve',
        comment: null,
      }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      '[rolestra.approvals.router]',
    );
    h.dispose();
  });
});

describe('ApprovalDecisionRouter — lifecycle', () => {
  it('wire() disposer removes listener (no leak)', () => {
    const h = makeHarness();
    h.dispose();
    h.emitDecided({
      item: makeItem(),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.applyPermissionModeChange).not.toHaveBeenCalled();
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(0);
  });

  it('wire() called twice attaches only once', () => {
    const h = makeHarness();
    h.router.wire(); // idempotent
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(1);
    h.dispose();
    expect(h.approvalService.listenerCount(APPROVAL_DECIDED_EVENT)).toBe(0);
  });
});

// ── R11-Task10: mode_transition conditional → setPendingAdvisory ─────────

describe('ApprovalDecisionRouter — R11-Task10 mode_transition advisory', () => {
  it('conditional + comment → setPendingAdvisory called with trimmed comment', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ projectId: 'proj-A' }),
      decision: 'conditional',
      comment: '  src/external/ 만 read-only 로  ',
    });
    expect(h.projectService.setPendingAdvisory).toHaveBeenCalledWith(
      'proj-A',
      'src/external/ 만 read-only 로',
    );
    // apply 도 같이 호출돼야 한다 — advisory 와 apply 는 독립적인 책임.
    expect(h.projectService.applyPermissionModeChange).toHaveBeenCalledWith(
      'appr-1',
    );
    h.dispose();
  });

  it('approve → setPendingAdvisory NOT called (apply만 진행)', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ projectId: 'proj-B' }),
      decision: 'approve',
      comment: 'unused on approve',
    });
    expect(h.projectService.setPendingAdvisory).not.toHaveBeenCalled();
    expect(h.projectService.applyPermissionModeChange).toHaveBeenCalled();
    h.dispose();
  });

  it('conditional + null comment → setPendingAdvisory NOT called', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ projectId: 'proj-C' }),
      decision: 'conditional',
      comment: null,
    });
    expect(h.projectService.setPendingAdvisory).not.toHaveBeenCalled();
    h.dispose();
  });

  it('conditional + whitespace-only comment → setPendingAdvisory NOT called', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ projectId: 'proj-D' }),
      decision: 'conditional',
      comment: '   \n\t   ',
    });
    expect(h.projectService.setPendingAdvisory).not.toHaveBeenCalled();
    h.dispose();
  });

  it('conditional + projectId=null → setPendingAdvisory NOT called', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeItem({ projectId: null }),
      decision: 'conditional',
      comment: 'orphan comment',
    });
    expect(h.projectService.setPendingAdvisory).not.toHaveBeenCalled();
    // orphan mode_transition row 자체는 비정상 — apply 는 시도되지만
    // applyPermissionModeChange 가 자체 검증으로 throw 후 warn 처리.
    h.dispose();
  });

  it('conditional + advisory throws → warn logged, apply still called', () => {
    const h = makeHarness({ advisoryThrows: new Error('slot full') });
    h.emitDecided({
      item: makeItem({ projectId: 'proj-E' }),
      decision: 'conditional',
      comment: 'still apply',
    });
    expect(h.projectService.setPendingAdvisory).toHaveBeenCalled();
    // advisory 저장 실패는 apply 를 막지 않는다.
    expect(h.projectService.applyPermissionModeChange).toHaveBeenCalledWith(
      'appr-1',
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      '[rolestra.approvals.router] setPendingAdvisory failed',
    );
    h.dispose();
  });
});
