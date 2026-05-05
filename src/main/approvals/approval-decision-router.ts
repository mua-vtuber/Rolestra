/**
 * ApprovalDecisionRouter — R7-Task8.
 *
 * ApprovalService 의 `'decided'` 이벤트를 구독해 `item.kind` 에 맞는 실행기로
 * 라우팅한다. 현재 routing 대상:
 *   - decision ∈ {approve, conditional} + kind='mode_transition' →
 *     ProjectService.applyPermissionModeChange(id).
 *   - kind='circuit_breaker' (R10-Task4) — circuitBreaker.resetCounter +
 *     project.setAutonomy(previousMode).
 *   - decision='reject' 또는 다른 kind → no-op.
 *
 * R12-C2 T10b: 옛 consensus_decision 라우팅 placeholder 제거 — 새 phase loop
 * 모델은 SSM DONE sign-off approval 자체를 발사하지 않는다.
 *
 * ApprovalSystemMessageInjector(Task 6) 와 책임이 분리돼 있다:
 *   - Injector  : reject/conditional + comment → system 메시지 주입 (AI prompt).
 *   - Router    : approve/conditional + kind 별 도메인 apply (DB 상태 전이).
 * 두 리스너가 같은 'decided' 이벤트를 독립적으로 받아 각자의 관심사만
 * 수행한다 — Injector 의 실패가 Router 의 apply 를 막거나 그 반대가 되지
 * 않는다 (둘 다 자신의 try/catch 로 감싸 warn 로그만 남긴다).
 *
 * TOCTOU 재검증은 `applyPermissionModeChange` 안쪽에서 수행되며, gate 가
 * 걸리면 approval row 가 `superseded` 로 돌아가 렌더러 inbox 에서 즉시
 * 사라진다. Router 는 그저 apply 를 한 번 호출하고 예외를 warn 으로 흡수한다.
 */

import {
  APPROVAL_DECIDED_EVENT,
  type ApprovalDecidedPayload,
} from './approval-service';
import type { AutonomyMode } from '../../shared/project-types';
import {
  CIRCUIT_BREAKER_TRIPWIRES,
  type CircuitBreakerTripwire,
} from '../../shared/circuit-breaker-types';

/** ApprovalService 에서 필요한 surface 만 좁힌 view. */
export interface ApprovalDecisionRouterSource {
  on(
    event: typeof APPROVAL_DECIDED_EVENT,
    listener: (payload: ApprovalDecidedPayload) => void,
  ): this;
  off(
    event: typeof APPROVAL_DECIDED_EVENT,
    listener: (payload: ApprovalDecidedPayload) => void,
  ): this;
}

/**
 * ProjectService surface needed by the router.
 *
 * - `applyPermissionModeChange` for `mode_transition` (R7-Task8).
 * - `setAutonomy` for `circuit_breaker` resume (R10-Task4) — restores the
 *   project to the autonomy mode it held before the breaker downgrade.
 * - `setPendingAdvisory` for `mode_transition` conditional comments
 *   (R11-Task10) — saves the user's qualifying note so the next meeting
 *   on the same project prepends it as a system message.
 */
export interface ModeTransitionApplier {
  applyPermissionModeChange(approvalId: string): unknown;
  setAutonomy?(
    id: string,
    mode: AutonomyMode,
    opts?: { reason?: string },
  ): unknown;
  setPendingAdvisory?(projectId: string, advisory: string): void;
}

/**
 * R10-Task4: circuit-breaker reset surface. The router calls
 * `resetCounter(tripwire)` after the user approves a `circuit_breaker`
 * resume row so the breaker re-arms against the same tripwire without
 * forcing a process restart.
 */
export interface CircuitBreakerResetter {
  resetCounter(tripwire: CircuitBreakerTripwire): void;
}

export interface ApprovalDecisionRouterDeps {
  approvalService: ApprovalDecisionRouterSource;
  projectService: ModeTransitionApplier;
  /**
   * Optional — when omitted the `circuit_breaker` branch becomes a no-op
   * (legacy callers that only need mode_transition routing keep working).
   */
  circuitBreaker?: CircuitBreakerResetter;
}

/** Narrow runtime guard for the four tripwire literals. */
function isCircuitBreakerTripwire(value: unknown): value is CircuitBreakerTripwire {
  return (
    typeof value === 'string' &&
    (CIRCUIT_BREAKER_TRIPWIRES as readonly string[]).includes(value)
  );
}

/** Narrow runtime guard for the AutonomyMode literals. */
function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === 'manual' || value === 'auto_toggle' || value === 'queue';
}

export class ApprovalDecisionRouter {
  private readonly listener: (payload: ApprovalDecidedPayload) => void;
  private wired = false;

  constructor(private readonly deps: ApprovalDecisionRouterDeps) {
    this.listener = (payload) => this.route(payload);
  }

  /**
   * 한 번만 붙는 idempotent wire. 반환되는 disposer 로 언제든 떼낼 수 있다.
   */
  wire(): () => void {
    if (!this.wired) {
      this.deps.approvalService.on(APPROVAL_DECIDED_EVENT, this.listener);
      this.wired = true;
    }
    return (): void => {
      if (this.wired) {
        this.deps.approvalService.off(APPROVAL_DECIDED_EVENT, this.listener);
        this.wired = false;
      }
    };
  }

  private route(payload: ApprovalDecidedPayload): void {
    const { item, decision, comment } = payload;

    // Router 는 긍정 결정만 반응 — 거절 / 만료는 다른 side-effect 가 처리.
    if (decision !== 'approve' && decision !== 'conditional') {
      return;
    }

    if (item.kind === 'mode_transition') {
      // R11-Task10: conditional 결정의 comment 는 다음 회의에서 system
      // message 로 자동 prepend 되도록 ProjectService 의 in-memory
      // advisory slot 에 보관한다. apply 와 advisory 저장은 서로 다른
      // 책임이므로 try/catch 도 분리 — advisory 저장이 실패해도
      // applyPermissionModeChange 는 그대로 시도한다.
      if (
        decision === 'conditional' &&
        item.projectId !== null &&
        this.deps.projectService.setPendingAdvisory
      ) {
        const trimmed = comment?.trim() ?? '';
        if (trimmed.length > 0) {
          try {
            this.deps.projectService.setPendingAdvisory(
              item.projectId,
              trimmed,
            );
          } catch (err) {
            console.warn(
              '[rolestra.approvals.router] setPendingAdvisory failed:',
              {
                approvalId: item.id,
                projectId: item.projectId,
                name: err instanceof Error ? err.name : undefined,
                message: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }
      }

      try {
        this.deps.projectService.applyPermissionModeChange(item.id);
      } catch (err) {
        // TODO R2-log: swap for structured logger.
        console.warn(
          '[rolestra.approvals.router] applyPermissionModeChange failed:',
          {
            approvalId: item.id,
            name: err instanceof Error ? err.name : undefined,
            message: err instanceof Error ? err.message : String(err),
          },
        );
      }
      return;
    }

    if (item.kind === 'circuit_breaker') {
      this.routeCircuitBreaker(item);
      return;
    }

    // review_outcome / failure_report 는 R8+ 에서 정의.
  }

  /**
   * R10-Task4: Circuit Breaker resume routing.
   *
   * When the user approves a `kind='circuit_breaker'` row, two things
   * happen — both wrapped in their own try/catch so a single failure
   * (e.g. project deleted between fire and resume) cannot wedge the
   * other side-effect:
   *
   *   1. Reset the tripwire counter so the breaker re-arms.
   *   2. Restore the project to the autonomy mode it held before the
   *      downgrade (recorded in the approval payload as `previousMode`).
   *
   * The payload `{tripwire, previousMode, projectId, ...}` shape is
   * minted by `v3-side-effects.handleBreakerFired`. Missing/invalid
   * fields short-circuit the corresponding step rather than throwing —
   * the approval row is still marked decided by ApprovalService, and
   * the renderer still sees the row removed from the inbox.
   */
  private routeCircuitBreaker(item: ApprovalDecidedPayload['item']): void {
    const payload = item.payload;
    const meta =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;

    // (1) Reset the tripwire counter.
    if (this.deps.circuitBreaker && meta) {
      const tripwire = meta.tripwire;
      if (isCircuitBreakerTripwire(tripwire)) {
        try {
          this.deps.circuitBreaker.resetCounter(tripwire);
        } catch (err) {
          console.warn(
            '[rolestra.approvals.router] circuitBreaker.resetCounter failed:',
            {
              approvalId: item.id,
              tripwire,
              name: err instanceof Error ? err.name : undefined,
              message: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    }

    // (2) Restore the previous autonomy mode.
    const setAutonomy = this.deps.projectService.setAutonomy;
    if (setAutonomy && item.projectId && meta) {
      const previousMode = meta.previousMode;
      if (isAutonomyMode(previousMode)) {
        try {
          setAutonomy.call(
            this.deps.projectService,
            item.projectId,
            previousMode,
            { reason: 'user' },
          );
        } catch (err) {
          console.warn(
            '[rolestra.approvals.router] setAutonomy(previousMode) failed:',
            {
              approvalId: item.id,
              projectId: item.projectId,
              previousMode,
              name: err instanceof Error ? err.name : undefined,
              message: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    }
  }
}
