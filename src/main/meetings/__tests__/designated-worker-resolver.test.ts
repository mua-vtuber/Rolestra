/**
 * designated-worker-resolver 단위 테스트 — R12-C2 P5 T23 land. spec
 * docs/specs/2026-05-01-rolestra-channel-roles-design.md line 670-676 +
 * docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 418-431.
 *
 * 검증 (순수 함수 — 3-tier 알고리즘):
 *
 *   Step 1 capability filter
 *     - capability 보유 후보 0 명 → DesignatedWorkerNotFoundError
 *     - 빈 후보 list → DesignatedWorkerNotFoundError
 *
 *   Step 2 부서장 핀 (department-head-pin)
 *     - 핀 보유 직원 1 명 → source='department-head-pin'
 *     - 핀 보유 직원이 capability 없는 경우 → step 3/4 fallback
 *     - 핀 보유 직원이 다수 있을 경우 → 입력 배열 첫 핀 직원 (defensive)
 *     - 핀이 다른 capability 에 대해서만 true → 본 capability 에는 false
 *       취급 (해당 capability 의 step 2 가 트리거되지 않음)
 *
 *   Step 3 drag_order (drag-order)
 *     - dragOrder=0 직원이 capability 보유 → source='drag-order'
 *     - dragOrder 다수 분포 시 최소값 직원 → 'drag-order'
 *     - dragOrder=null 만 있는 capability 보유 후보들 → step 4 fallback
 *
 *   Step 4 capability fallback (capability-fallback)
 *     - 모든 후보가 핀 X + dragOrder=null → 입력 배열 첫 capability 보유 직원
 *
 *   Combination
 *     - 핀 직원 + dragOrder=0 직원 동시 존재 → 핀 우선
 *     - dragOrder=0 직원 + dragOrder=1 직원 → dragOrder=0 우선
 *     - 핀 X + dragOrder=null + capability 보유 1 명 → fallback 동작
 *
 * 본 테스트는 caller (orchestrator) wiring 과 무관 — pure function 단위.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES,
  DesignatedWorkerNotFoundError,
  resolveDesignatedWorker,
  type DesignatedWorkerCandidate,
} from '../designated-worker-resolver';
import type { RoleId } from '../../../shared/role-types';

// ── fixtures ────────────────────────────────────────────────────────

function candidate(
  providerId: string,
  roles: readonly RoleId[],
  options: {
    isDepartmentHead?: Partial<Record<RoleId, boolean>>;
    dragOrder?: number | null;
    displayName?: string;
  } = {},
): DesignatedWorkerCandidate {
  return {
    providerId,
    displayName: options.displayName ?? providerId,
    roles,
    isDepartmentHead: options.isDepartmentHead ?? {},
    dragOrder: options.dragOrder ?? null,
  };
}

// ── ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES ────────────────────────

describe('ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES', () => {
  it('exactly 3 sources — pin / drag / fallback', () => {
    expect([...ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES]).toEqual([
      'department-head-pin',
      'drag-order',
      'capability-fallback',
    ]);
  });
});

// ── Step 1 capability filter ────────────────────────────────────────

describe('resolveDesignatedWorker — step 1 capability filter', () => {
  it('빈 후보 list → DesignatedWorkerNotFoundError', () => {
    expect(() => resolveDesignatedWorker([], 'design.ux')).toThrow(
      DesignatedWorkerNotFoundError,
    );
  });

  it('capability 매칭 0 명 → DesignatedWorkerNotFoundError', () => {
    const cands = [
      candidate('p1', ['design.ui']),
      candidate('p2', ['planning']),
    ];
    expect(() => resolveDesignatedWorker(cands, 'design.ux')).toThrow(
      DesignatedWorkerNotFoundError,
    );
  });

  it('error.capability 필드 보존', () => {
    try {
      resolveDesignatedWorker([], 'design.ux');
      expect.unreachable('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DesignatedWorkerNotFoundError);
      expect((err as DesignatedWorkerNotFoundError).capability).toBe(
        'design.ux',
      );
    }
  });
});

// ── Step 2 부서장 핀 ────────────────────────────────────────────────

describe('resolveDesignatedWorker — step 2 department-head-pin', () => {
  it('핀 1 명 → source=department-head-pin', () => {
    const head = candidate('p1', ['design.ux'], {
      isDepartmentHead: { 'design.ux': true },
    });
    const other = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([other, head], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('department-head-pin');
  });

  it('핀 보유 직원이 capability 없으면 step 2 발동 X (fallback 으로 진입)', () => {
    // p1 은 design.ui 의 head 지만 design.ux capability 가 없다.
    const wrongHead = candidate('p1', ['design.ui'], {
      isDepartmentHead: { 'design.ui': true },
    });
    const ux = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([wrongHead, ux], 'design.ux');
    expect(result.candidate.providerId).toBe('p2');
    expect(result.source).toBe('capability-fallback');
  });

  it('핀 다수 (UI invariant 위반 — defensive) → 입력 배열 첫 핀', () => {
    const head1 = candidate('p1', ['design.ux'], {
      isDepartmentHead: { 'design.ux': true },
    });
    const head2 = candidate('p2', ['design.ux'], {
      isDepartmentHead: { 'design.ux': true },
    });
    const result = resolveDesignatedWorker([head2, head1], 'design.ux');
    expect(result.candidate.providerId).toBe('p2');
    expect(result.source).toBe('department-head-pin');
  });

  it('핀이 다른 capability 에만 true → 본 capability 의 step 2 트리거 X', () => {
    const head = candidate('p1', ['design.ux', 'design.ui'], {
      isDepartmentHead: { 'design.ui': true }, // design.ux 에는 핀 X
    });
    const ux = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([head, ux], 'design.ux');
    // p1 도 design.ux capability 보유 → capability fallback 으로 첫 등장 = p1
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('capability-fallback');
  });

  it('핀 값이 false 인 경우 (명시적 unpinned) → step 2 발동 X', () => {
    const explicit = candidate('p1', ['design.ux'], {
      isDepartmentHead: { 'design.ux': false },
    });
    const result = resolveDesignatedWorker([explicit], 'design.ux');
    expect(result.source).toBe('capability-fallback');
  });
});

// ── Step 3 drag_order ──────────────────────────────────────────────

describe('resolveDesignatedWorker — step 3 drag-order', () => {
  it('dragOrder=0 직원 → source=drag-order', () => {
    const dragged = candidate('p1', ['design.ux'], { dragOrder: 0 });
    const other = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([other, dragged], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('drag-order');
  });

  it('dragOrder 다수 분포 → 최소값 직원', () => {
    const order2 = candidate('p1', ['design.ux'], { dragOrder: 2 });
    const order0 = candidate('p2', ['design.ux'], { dragOrder: 0 });
    const order1 = candidate('p3', ['design.ux'], { dragOrder: 1 });
    const result = resolveDesignatedWorker(
      [order2, order1, order0],
      'design.ux',
    );
    expect(result.candidate.providerId).toBe('p2');
    expect(result.source).toBe('drag-order');
  });

  it('dragOrder=null 만 있는 capability 보유 후보들 → step 4 fallback', () => {
    const a = candidate('p1', ['design.ux'], { dragOrder: null });
    const b = candidate('p2', ['design.ux'], { dragOrder: null });
    const result = resolveDesignatedWorker([a, b], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('capability-fallback');
  });

  it('dragOrder 직원이 capability 없으면 step 3 발동 X', () => {
    // p1 은 dragOrder=0 이지만 design.ux capability 없음 → step 1 filter 에서 제외
    const wrongDrag = candidate('p1', ['design.ui'], { dragOrder: 0 });
    const ux = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([wrongDrag, ux], 'design.ux');
    expect(result.candidate.providerId).toBe('p2');
    expect(result.source).toBe('capability-fallback');
  });

  it('dragOrder 동률 (UI invariant 위반 — defensive) → 입력 배열 첫 직원', () => {
    const a = candidate('p1', ['design.ux'], { dragOrder: 0 });
    const b = candidate('p2', ['design.ux'], { dragOrder: 0 });
    const result = resolveDesignatedWorker([a, b], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('drag-order');
  });
});

// ── Step 4 capability fallback ──────────────────────────────────────

describe('resolveDesignatedWorker — step 4 capability fallback', () => {
  it('핀 X + dragOrder=null + capability 보유 1 명 → 그 직원 반환', () => {
    const only = candidate('p1', ['design.ux']);
    const result = resolveDesignatedWorker([only], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('capability-fallback');
  });

  it('핀 X + dragOrder=null + capability 보유 다수 → 입력 배열 첫 직원', () => {
    const a = candidate('p1', ['design.ux']);
    const b = candidate('p2', ['design.ux']);
    const c = candidate('p3', ['design.ux']);
    expect(resolveDesignatedWorker([a, b, c], 'design.ux').candidate.providerId).toBe(
      'p1',
    );
    expect(resolveDesignatedWorker([c, b, a], 'design.ux').candidate.providerId).toBe(
      'p3',
    );
  });

  it('non-capability 후보가 입력 첫 자리에 있어도 fallback 은 capable 첫 직원', () => {
    const noCap = candidate('p1', ['planning']);
    const ux = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([noCap, ux], 'design.ux');
    expect(result.candidate.providerId).toBe('p2');
    expect(result.source).toBe('capability-fallback');
  });
});

// ── Combination — priority 검증 ────────────────────────────────────

describe('resolveDesignatedWorker — priority combinations', () => {
  it('핀 + dragOrder=0 동시 존재 → 핀 우선 (step 2 > step 3)', () => {
    const head = candidate('p1', ['design.ux'], {
      isDepartmentHead: { 'design.ux': true },
    });
    const dragged = candidate('p2', ['design.ux'], { dragOrder: 0 });
    const result = resolveDesignatedWorker([dragged, head], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('department-head-pin');
  });

  it('핀 X + dragOrder=0 → drag 우선 (step 3 > step 4)', () => {
    const dragged = candidate('p1', ['design.ux'], { dragOrder: 0 });
    const plain = candidate('p2', ['design.ux']);
    const result = resolveDesignatedWorker([plain, dragged], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('drag-order');
  });

  it('R12-C2 wiring (모든 후보 핀={} + dragOrder=null) → fallback 만 동작', () => {
    // T36/T37 land 전 R12-C2 시점 caller 동작과 동일.
    const ux = candidate('p1', ['design.ux']);
    const ui = candidate('p2', ['design.ui']);
    const result = resolveDesignatedWorker([ux, ui], 'design.ux');
    expect(result.candidate.providerId).toBe('p1');
    expect(result.source).toBe('capability-fallback');
  });
});
