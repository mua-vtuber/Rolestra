/**
 * Unit tests for ApprovalDecisionRouter (R10-Task4 — circuit_breaker branch).
 *
 * Closes R9 Known Concern #6: when the user approves a
 * `kind='circuit_breaker'` row, the router resets the matching tripwire
 * counter and restores the project's previous autonomy mode.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from '../../../shared/approval-types';
import type { ApprovalDecidedPayload } from '../approval-service';
import { APPROVAL_DECIDED_EVENT } from '../approval-service';
import { ApprovalDecisionRouter } from '../approval-decision-router';

function makeBreakerItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'cb-1',
    kind: 'circuit_breaker',
    projectId: 'p-1',
    channelId: null,
    meetingId: null,
    requesterId: null,
    payload: {
      source: 'circuit_breaker',
      tripwire: 'queue_streak',
      detail: { count: 6 },
      previousMode: 'queue',
    },
    status: 'approved',
    decisionComment: null,
    createdAt: 1,
    decidedAt: 2,
    ...overrides,
  };
}

interface Harness {
  approvalService: EventEmitter;
  projectService: {
    applyPermissionModeChange: ReturnType<typeof vi.fn>;
    setAutonomy: ReturnType<typeof vi.fn>;
  };
  circuitBreaker: { resetCounter: ReturnType<typeof vi.fn> };
  dispose: () => void;
  emitDecided(payload: ApprovalDecidedPayload): void;
}

function makeHarness(opts: {
  setAutonomyThrows?: Error;
  resetThrows?: Error;
  withBreaker?: boolean;
} = {}): Harness {
  const approvalService = new EventEmitter();
  const projectService = {
    applyPermissionModeChange: vi.fn(),
    setAutonomy: vi.fn((id: string, mode: string) => {
      if (opts.setAutonomyThrows) throw opts.setAutonomyThrows;
      return { id, autonomyMode: mode };
    }),
  };
  const circuitBreaker = {
    resetCounter: vi.fn((tripwire: string) => {
      if (opts.resetThrows) throw opts.resetThrows;
      return tripwire;
    }),
  };
  const router = new ApprovalDecisionRouter({
    approvalService,
    projectService,
    circuitBreaker: opts.withBreaker === false ? undefined : circuitBreaker,
  });
  const dispose = router.wire();
  return {
    approvalService,
    projectService,
    circuitBreaker,
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

describe('ApprovalDecisionRouter — circuit_breaker routing', () => {
  it('approve → resetCounter + setAutonomy(previousMode) called', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem(),
      decision: 'approve',
      comment: null,
    });

    expect(h.circuitBreaker.resetCounter).toHaveBeenCalledWith('queue_streak');
    expect(h.projectService.setAutonomy).toHaveBeenCalledWith(
      'p-1',
      'queue',
      expect.objectContaining({ reason: 'user' }),
    );
    h.dispose();
  });

  it('reject → no reset, no setAutonomy', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem(),
      decision: 'reject',
      comment: null,
    });
    expect(h.circuitBreaker.resetCounter).not.toHaveBeenCalled();
    expect(h.projectService.setAutonomy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('conditional → also runs the resume path (positive decision)', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem(),
      decision: 'conditional',
      comment: 'limit cli to 5 minutes',
    });
    expect(h.circuitBreaker.resetCounter).toHaveBeenCalledWith('queue_streak');
    expect(h.projectService.setAutonomy).toHaveBeenCalled();
    h.dispose();
  });

  it.each([
    'files_per_turn',
    'cumulative_cli_ms',
    'queue_streak',
    'same_error',
  ])('routes tripwire literal "%s" to resetCounter', (tripwire) => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem({
        payload: {
          source: 'circuit_breaker',
          tripwire,
          detail: {},
          previousMode: 'auto_toggle',
        },
      }),
      decision: 'approve',
      comment: null,
    });
    expect(h.circuitBreaker.resetCounter).toHaveBeenCalledWith(tripwire);
    h.dispose();
  });

  it('skips reset when payload.tripwire is unknown but still mode-restores', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem({
        payload: {
          source: 'circuit_breaker',
          tripwire: 'unknown_tripwire',
          previousMode: 'queue',
        },
      }),
      decision: 'approve',
      comment: null,
    });
    expect(h.circuitBreaker.resetCounter).not.toHaveBeenCalled();
    expect(h.projectService.setAutonomy).toHaveBeenCalledWith(
      'p-1',
      'queue',
      expect.any(Object),
    );
    h.dispose();
  });

  it('skips setAutonomy when payload.previousMode is missing', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem({
        payload: {
          source: 'circuit_breaker',
          tripwire: 'queue_streak',
        },
      }),
      decision: 'approve',
      comment: null,
    });
    expect(h.circuitBreaker.resetCounter).toHaveBeenCalled();
    expect(h.projectService.setAutonomy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('skips setAutonomy when projectId is null on the approval row', () => {
    const h = makeHarness();
    h.emitDecided({
      item: makeBreakerItem({ projectId: null }),
      decision: 'approve',
      comment: null,
    });
    expect(h.circuitBreaker.resetCounter).toHaveBeenCalled();
    expect(h.projectService.setAutonomy).not.toHaveBeenCalled();
    h.dispose();
  });

  it('with no circuitBreaker dep, only the autonomy restore runs', () => {
    const h = makeHarness({ withBreaker: false });
    h.emitDecided({
      item: makeBreakerItem(),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.setAutonomy).toHaveBeenCalledWith(
      'p-1',
      'queue',
      expect.any(Object),
    );
    h.dispose();
  });

  it('reset throws → warn logged, setAutonomy still runs', () => {
    const h = makeHarness({ resetThrows: new Error('reset boom') });
    h.emitDecided({
      item: makeBreakerItem(),
      decision: 'approve',
      comment: null,
    });
    expect(h.projectService.setAutonomy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      '[rolestra.approvals.router]',
    );
    h.dispose();
  });

  it('setAutonomy throws → warn logged, no rethrow', () => {
    const h = makeHarness({ setAutonomyThrows: new Error('TOCTOU') });
    expect(() =>
      h.emitDecided({
        item: makeBreakerItem(),
        decision: 'approve',
        comment: null,
      }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    h.dispose();
  });
});
