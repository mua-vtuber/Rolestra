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
  projectService: { applyPermissionModeChange: ReturnType<typeof vi.fn> };
  router: ApprovalDecisionRouter;
  dispose: () => void;
  emitDecided(payload: ApprovalDecidedPayload): void;
}

function makeHarness(options: { applyThrows?: Error } = {}): Harness {
  const approvalService = new EventEmitter();
  const applyPermissionModeChange = vi.fn((id: string) => {
    if (options.applyThrows) throw options.applyThrows;
    return { id, permissionMode: 'approval' };
  });
  const projectService = { applyPermissionModeChange };
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
