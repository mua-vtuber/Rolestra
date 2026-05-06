/**
 * designated-worker-resolver — R12-C2 P5 T23 land. spec
 * docs/specs/2026-05-01-rolestra-channel-roles-design.md line 670-676 +
 * docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 418-431 (E. designated-worker-
 * resolver) + line 605-623 (T36 부서장 핀 / T37 드래그 순서 wire scope).
 *
 * 사무실 메타포: 부서 안 *지정 작업자 (designated worker)* 결정 알고리즘. 회의
 * 중 시스템→1 인 단일 turn 지시 phase (`assigning_designated_task`) 또는 mission
 * card 분배 시 *누가 그 작업을 받을지* 한 명을 결정한다. 다른 AI 는 옵저버.
 *
 * 결정 우선순위 (spec line 674-676 카논):
 *
 *   1. **부서장 핀**           providers.is_department_head[role] === true 인
 *                              직원이 capability 보유 시 1순위. 사용자가 직원
 *                              편집 모달에서 명시적으로 "부서장" 으로 핀
 *                              지정한 결정.
 *
 *   2. **drag_order 1 번**     channel_members.drag_order ASC 순으로 가장 위에
 *                              있는 직원이 capability 보유 시 2순위. 사용자가
 *                              참여 멤버 panel 에서 드래그로 결정한 순서.
 *
 *   3. **자율 모드 default**   capability 보유 직원 list 안 *처음* 등장하는
 *                              직원 (caller 가 결정한 순서). T16b 임시
 *                              capability-first-match 와 동일 — pin / drag_order
 *                              둘 다 미설정 시 fallback path.
 *
 * 만약 capability 보유 직원이 0 명이면 {@link DesignatedWorkerNotFoundError}
 * throw — orchestrator 가 catch 후 회의 abort + outcome='aborted' +
 * abortReason='designated_task_failed' 매핑.
 *
 * **R12-C2 시점 wiring 상태:** 부서장 핀 (T36) + 드래그 순서 (T37) UI 가 P7
 * phase 에 진입하므로, T23 시점에는 caller (orchestrator) 가 `isDepartmentHead:
 * {}` + `dragOrder: null` 을 모든 candidate 에 전달 → 자연스럽게 step 3
 * (자율 모드 default) 만 동작. 알고리즘 자체는 3-tier 통째 land — T36 / T37
 * 진입 시 caller wiring 만 갱신하면 즉시 우선순위 발동.
 *
 * 본 모듈은 *순수 함수 + 타입* 만 land — IO / DB / IPC 의존 X. caller
 * (meeting-orchestrator) 가 ChannelRepository.listMembers 와 ProviderRegistry
 * 를 join 해서 후보 배열 생성 후 본 resolver 호출.
 *
 * spec / plan reference:
 *   - docs/specs/2026-05-01-rolestra-channel-roles-design.md line 253-254 +
 *     line 670-676 (3-tier 알고리즘 카논 / drag_order / is_department_head 컬럼)
 *   - docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 418-431 (T23 산출)
 *   - docs/plans/2026-05-04-rolestra-phase-r12-c2.md line 605-623 (T36 / T37
 *     P7 phase wire scope — 본 resolver caller 갱신만)
 */

import type { RoleId } from '../../shared/role-types';

// ── candidate type ──────────────────────────────────────────────────

/**
 * Resolver 입력 1 건 — 채널 참가 1 명 + provider metadata join.
 *
 * caller (meeting-orchestrator.collectDesignedWorkerCandidates) 가
 * ChannelRepository.listMembers + ProviderRegistry.get 결과를 본 형태로 변환.
 * 배열 순서는 caller 가 결정 — drag_order ASC NULLS LAST + provider_id ASC 가
 * 자연스럽지만 본 resolver 는 순서 중립 (필요 시 자체 정렬).
 *
 * Provider 가 registry 에 없는 직원은 caller 가 silent skip — 본 resolver 는
 * candidates 안에 들어온 항목만 본다.
 */
export interface DesignatedWorkerCandidate {
  /** Participant.id (= providerId for AI). */
  readonly providerId: string;

  /** UI 표시 / prompt 안 발화자 이름. */
  readonly displayName: string;

  /**
   * 직원에게 부여된 능력 (R12-S 카탈로그 RoleId list). capability 매칭 시 본
   * 배열에 `includes` 검사.
   */
  readonly roles: readonly RoleId[];

  /**
   * 부서장 핀 — providers.is_department_head JSON 컬럼 (migration 018 land)
   * 의 디코드 결과. 키가 없거나 값이 false 면 핀 X. 본 resolver 는
   * `isDepartmentHead[capability] === true` 1 회 검사.
   *
   * R12-C2 시점에는 caller 가 모든 후보에 대해 빈 객체 `{}` 전달 (UI 미존재).
   * T36 진입 시 caller 가 provider-repository 통해 실 컬럼 읽어 전달.
   */
  readonly isDepartmentHead: Readonly<Partial<Record<RoleId, boolean>>>;

  /**
   * channel_members.drag_order — 회의 채널 안 발화 순서. NULL = 미설정 (사용자
   * 드래그 X). 작은 값일수록 위 (1 번 = 0).
   *
   * R12-C2 시점에는 caller 가 모든 후보에 대해 `null` 전달 (UI 미존재). T37
   * 진입 시 caller 가 channel-repository 통해 실 컬럼 읽어 전달.
   */
  readonly dragOrder: number | null;
}

// ── resolution result ───────────────────────────────────────────────

/**
 * Resolver 결과 — 결정된 직원 + *어느 path 로 결정되었는지* 라벨.
 *
 * `source` 필드는 telemetry / 사용자 알림 / 디버그 용도 — UI 가 "🔧 부서장 핀
 * 으로 선택" / "📋 드래그 순서 1 번" / "🎲 자율 모드 default" 같은 안내 분기에
 * 활용 가능. 회의 동작 자체는 path 와 무관 (어느 경로든 1 명 선택은 동일).
 */
export interface ResolvedDesignatedWorker {
  readonly candidate: DesignatedWorkerCandidate;
  readonly source: DesignatedWorkerResolutionSource;
}

/** 결정 경로 라벨. */
export type DesignatedWorkerResolutionSource =
  | 'department-head-pin'
  | 'drag-order'
  | 'capability-fallback';

/** {@link DesignatedWorkerResolutionSource} 의 readonly array — UI / log enum. */
export const ALL_DESIGNATED_WORKER_RESOLUTION_SOURCES: readonly DesignatedWorkerResolutionSource[] =
  ['department-head-pin', 'drag-order', 'capability-fallback'] as const;

// ── error ───────────────────────────────────────────────────────────

/**
 * `resolveDesignatedWorker` 가 capability 매칭 직원 0 명 시 throw.
 * orchestrator 는 즉시 회의 abort + outcome='aborted' +
 * abortReason='designated_task_failed' 매핑.
 *
 * `capability` 필드는 사용자 알림 / 디버그 메시지에 활용. abortReason 은
 * orchestrator 가 별도 분기 처리.
 */
export class DesignatedWorkerNotFoundError extends Error {
  readonly capability: RoleId;

  constructor(capability: RoleId) {
    super(
      `[DesignatedWorker] no candidate matched capability '${capability}' — workflow cannot proceed`,
    );
    this.name = 'DesignatedWorkerNotFoundError';
    this.capability = capability;
  }
}

// ── resolver ────────────────────────────────────────────────────────

/**
 * 3-tier designated-worker resolver. spec line 670-676 카논 그대로.
 *
 * 알고리즘 (결정적):
 *
 *   1. capability 보유 후보 filter (`roles.includes(capability)`).
 *      → 결과 0 명 → {@link DesignatedWorkerNotFoundError} throw.
 *
 *   2. **부서장 핀** — capability 보유 후보 중 `isDepartmentHead[capability]
 *      === true` 인 첫 직원 (입력 배열 순서). 발견 시 즉시 반환
 *      (source='department-head-pin').
 *
 *   3. **drag_order** — capability 보유 후보 중 `dragOrder !== null` 인 직원
 *      들에서 *최소 dragOrder* 인 1 명. 동률 시 입력 배열 순서. 발견 시 즉시
 *      반환 (source='drag-order').
 *
 *   4. **fallback** — capability 보유 후보 중 *입력 배열 첫* 직원
 *      (source='capability-fallback'). step 1 결과 ≥ 1 명 보장하므로 항상
 *      반환 가능.
 *
 * caller 결정 사항:
 *   - 입력 배열 순서. T16b 의 orchestrator 는 `session.aiParticipants` 순서
 *     사용 (= 회의 소집 시 멤버 순서). T23 이후는 ChannelRepository.listMembers
 *     의 정렬 (drag_order ASC NULLS LAST + provider_id ASC) 권장 — drag_order
 *     fallback path 와 정합.
 *   - 후보의 `isDepartmentHead` / `dragOrder` 값. R12-C2 시점에는 모든 후보에
 *     대해 `{}` / `null` 전달 → fallback path 만 동작 (step 4).
 *
 * 반환 객체 `source` 는 결정 path 라벨 — UI / log / 사용자 알림 분기에 활용.
 * 회의 동작 자체는 path 와 무관.
 */
export function resolveDesignatedWorker(
  candidates: readonly DesignatedWorkerCandidate[],
  capability: RoleId,
): ResolvedDesignatedWorker {
  // step 1: capability 보유 후보 filter
  const capable: DesignatedWorkerCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.roles.includes(capability)) {
      capable.push(candidate);
    }
  }
  if (capable.length === 0) {
    throw new DesignatedWorkerNotFoundError(capability);
  }

  // step 2: 부서장 핀 (capability 보유 후보 중 첫 핀)
  for (const candidate of capable) {
    if (candidate.isDepartmentHead[capability] === true) {
      return { candidate, source: 'department-head-pin' };
    }
  }

  // step 3: drag_order (capability 보유 후보 중 최소 dragOrder)
  let dragChoice: DesignatedWorkerCandidate | null = null;
  for (const candidate of capable) {
    if (candidate.dragOrder === null) continue;
    if (dragChoice === null) {
      dragChoice = candidate;
      continue;
    }
    // dragChoice.dragOrder !== null 보장 (위 if 분기에서 진입).
    const incumbent = dragChoice.dragOrder as number;
    const challenger = candidate.dragOrder;
    if (challenger < incumbent) {
      dragChoice = candidate;
    }
  }
  if (dragChoice !== null) {
    return { candidate: dragChoice, source: 'drag-order' };
  }

  // step 4: fallback — capability 보유 후보 첫 직원
  return { candidate: capable[0], source: 'capability-fallback' };
}
