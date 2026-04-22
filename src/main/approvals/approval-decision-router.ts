/**
 * ApprovalDecisionRouter — R7-Task8 + R7-Task9 대상.
 *
 * ApprovalService 의 `'decided'` 이벤트를 구독해 `item.kind` 에 맞는 실행기로
 * 라우팅한다. Task 8 에서는 `mode_transition` 1 종만 처리:
 *   - decision ∈ {approve, conditional} + kind='mode_transition' →
 *     ProjectService.applyPermissionModeChange(id).
 *   - decision='reject' 또는 다른 kind → no-op (Task 9 에서 consensus_decision
 *     핸들러를 추가할 때 같은 파일을 확장).
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

/** ProjectService.applyPermissionModeChange 만 필요 — 테스트용 fake 친화적. */
export interface ModeTransitionApplier {
  applyPermissionModeChange(approvalId: string): unknown;
}

export interface ApprovalDecisionRouterDeps {
  approvalService: ApprovalDecisionRouterSource;
  projectService: ModeTransitionApplier;
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
    const { item, decision } = payload;

    // Router 는 긍정 결정만 반응 — 거절 / 만료는 다른 side-effect 가 처리.
    if (decision !== 'approve' && decision !== 'conditional') {
      return;
    }

    if (item.kind === 'mode_transition') {
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

    // consensus_decision 은 R7-Task9 에서 이 switch 에 붙는다.
    // review_outcome / failure_report 는 R8+ 에서 정의.
  }
}
