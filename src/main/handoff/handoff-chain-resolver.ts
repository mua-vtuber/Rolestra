/**
 * handoff-chain-resolver — R12-C2 P6 T28. spec §11.18.8c (handoff_mode 우회 룰)
 * + §11.16 (부서 lock 사이클) + §11.22 (H2 받는 부서 첫 화면 인계 패키지).
 *
 * 회의 종결 직후 (compose_minutes phase 직후 + NextStep 카드='handoff' 분기)
 * 시스템이 *어느 부서로 인계할지* 결정하는 단일 entry point. 본 모듈의 책임은
 * "다음 chain target 이 있는가, 있다면 어떤 HandoffPackage 가 합성되는가" 까지 만 —
 * dispatch 자체 (handoff_dispatch row 영속), 모달 / 자동 분기, Notification 발송은
 * caller (orchestrator + handoff-pending-state + IPC handler) 책임.
 *
 * 본 모듈은 *types + 순수 helper* 만 — DB 접근 / 시간 lookup / channel resolve
 * 모두 caller 가 inject. 단위 테스트로 audit chain 의 ok / ng 분기 + 다른
 * workflow placeholder + invariant 통째 검증.
 *
 * R12-C2 시점 wiring 상태:
 *
 *   - audit chain     ✅ verdict 분기 wire (planAuditDispatch 재사용 — T25 land)
 *   - implement chain ⏳ 'no_chain' placeholder (auto chain to audit 는 P6 후속
 *                       sub-task / R12-W 책임)
 *   - design chain    ⏳ 'no_chain' placeholder (HTML/CSS 결과 → planning chain
 *                       매핑은 design-workflow 의 후속 wire)
 *   - idea chain      ⏳ 'no_chain' placeholder (idea → design.ux 매핑은 P3 wire)
 *   - planning chain  ⏳ 'no_chain' placeholder (planning → implement 분담은 R12-W)
 *   - review          ✅ chain 외 — 'no_chain' 명시 (spec §3 line 76)
 *   - general         ✅ chain 외 — 'no_chain' 명시 (spec §3 line 78)
 *
 * placeholder 들은 의도적으로 'no_chain' 반환 — silent fallback 이 아닌 *명시
 * unhandled* 표현. caller (orchestrator) 가 받는 reason 으로 ⏳ 상태를 사용자/
 * 감사 trail 에 노출 가능. 후속 sub-task land 시 본 모듈의 placeholder branch 만
 * 실 chain 로직으로 교체.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 76        review = chain 외
 *  - §3 line 78        일반 채널 = chain 외 (잡담 / `[##]` 의견)
 *  - §11.16            부서 lock 사이클 (인계 시점 = 보낸 부서 lock 풀림)
 *  - §11.18.8c         handoff_mode 우회 룰 (B1 「인계」 카드 → 채널 정책 적용)
 *  - §11.22            H2. 받는 부서 첫 화면 인계 패키지
 *
 * plan docs/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  - line 484-499      T28 산출 (HandoffApprovalModal + B handoff_mode 우회 wire)
 */

import type { ChannelRole, HandoffMode } from '../../shared/channel-role-types';
import type { Opinion } from '../../shared/opinion-types';
import {
  buildHandoffPackage,
  type HandoffPackage,
  type HandoffSender,
} from '../../shared/schema/handoff-package';
import { planAuditDispatch } from '../meetings/workflows/audit-handoff-dispatch';
import { classifyAuditVerdict } from '../meetings/workflows/audit-workflow';

// ── workflow kind ────────────────────────────────────────────────────

/**
 * 회의 종결 시점에 chain resolver 가 분기하는 workflow 종류. 본 union 은
 * orchestrator 가 채널 role + workflow 분기 결과를 chain resolver 입력으로
 * 압축할 때 사용 — channel.role 자체와 다른 점은 'general' 채널이 별 분기를
 * 갖는다는 것 (system_general / system_ro 채널 범주).
 *
 * 'review' 와 'general' 만 *명시 chain 외*. 나머지는 chain 내 — placeholder 든
 * 실 wire 든.
 */
export type WorkflowChainKind =
  | 'idea'
  | 'planning'
  | 'design'
  | 'implement'
  | 'audit'
  | 'review'
  | 'general';

// ── outcome ──────────────────────────────────────────────────────────

/**
 * `resolveHandoffChain` 결과 discriminated union — chain 진행 여부 + 합성된
 * HandoffPackage 또는 unhandled reason.
 *
 *   - `kind='no_chain'`        다음 부서로 인계 X. caller (orchestrator) 는
 *                              'handoff' phase 를 종결 phase ('done') 로 transition.
 *                              `reason` 으로 사용자/감사 trail 에 *왜* chain 끝
 *                              인지 명시 노출 (chain 외 / verdict ok / ⏳ unhandled).
 *
 *   - `kind='chain_resolved'`  HandoffPackage 합성 완료. caller 는 *받는 채널의*
 *                              `channel.handoff_mode` 따라 분기:
 *                                - 'check' → HandoffPendingState.put + stream
 *                                  emit → 사용자 결재 모달 surface
 *                                - 'auto'  → HandoffDispatchService.dispatch 즉시
 *                                  + stream emit + Notification (T30 책임)
 */
export type ChainResolverOutcome =
  | { kind: 'no_chain'; reason: ChainNoChainReason }
  | { kind: 'chain_resolved'; package: HandoffPackage };

/**
 * 'no_chain' 결과의 사유. caller 가 사용자/감사 trail 에 노출하거나, 후속 sub-
 * task 가 placeholder 분기를 실 wire 로 교체할 때 인덱스 역할.
 *
 *   - `'review_outside_chain'`         리뷰 부서 — chain 외 (§3 line 76)
 *   - `'general_outside_chain'`        일반 채널 — chain 외 (§3 line 78)
 *   - `'audit_verdict_ok'`             audit verdict='ok' (T25 planAuditDispatch
 *                                       outcome.kind='end')
 *   - `'idea_chain_unhandled'`         idea → design.ux 매핑 미구현 (P3 wire)
 *   - `'planning_chain_unhandled'`     planning → implement 분담 미구현 (R12-W)
 *   - `'design_chain_unhandled'`       design → planning 인계 미구현 (P3 wire)
 *   - `'implement_chain_unhandled'`    implement → audit auto-chain 미구현 (R12-W)
 *
 * 본 union 에 새 reason 추가 시 caller (orchestrator) 의 분기에도 새 case 가
 * 필요 — discriminated union exhaustive 체크 강제.
 */
export type ChainNoChainReason =
  | 'review_outside_chain'
  | 'general_outside_chain'
  | 'audit_verdict_ok'
  | 'idea_chain_unhandled'
  | 'planning_chain_unhandled'
  | 'design_chain_unhandled'
  | 'implement_chain_unhandled';

// ── invariant error ──────────────────────────────────────────────────

/**
 * `resolveHandoffChain` 의 invariant 위반 시 throw — caller (orchestrator) 가
 * catch 후 회의 abort + 사용자 노출 에러 분기. silent fallback 금지 (CLAUDE.md).
 *
 * `AuditDispatchInvariantError` / `HandoffPackageInvariantError` 는 본 모듈이
 * *wrap 하지 않고 그대로 전파* — caller 가 세 종류의 에러를 구분해 처리.
 * (T26 RunStepBridge / T27 HandoffDispatchService 와 동일 정책.)
 */
export class HandoffChainResolverInvariantError extends Error {
  constructor(message: string) {
    super(`[HandoffChainResolver] ${message}`);
    this.name = 'HandoffChainResolverInvariantError';
  }
}

// ── caller injection types ───────────────────────────────────────────

/**
 * caller 가 chain resolver 에 주입하는 *받는 채널 lookup* 결과. role 별로 동일
 * project 안 단일 채널 resolve 후 본 객체로 압축. multiple 채널 (R13+ 분담) 은
 * R12-C2 시점 가정 X — caller 가 단일 row 가정 위반 시 명시적 throw 로 처리.
 *
 *   - `channelId`     받는 채널 UUID (handoff_dispatch.to_channel_id 자리)
 *   - `handoffMode`   받는 채널의 channel.handoff_mode 값. caller 분기 입력.
 *                     본 mode 가 HandoffPackage.mode 자리에 들어가 row 영속 시
 *                     보존된다.
 *   - `assignedProviderId`  받는 부서 designated worker provider ID. mission card
 *                           의 assignedProviderId 자리. caller 가 designated-
 *                           worker-resolver (T23 land) 호출 결과를 넘긴다.
 */
export interface ResolvedReceiverChannel {
  channelId: string;
  handoffMode: HandoffMode;
  assignedProviderId: string;
}

/**
 * audit chain 전용 입력. verdict 분류 + problem 추출에 필요한 minimum.
 * 다른 workflow chain 은 본 인터페이스 사용 X (각자 별 인터페이스 또는
 * placeholder 단계라 입력 자체 없음).
 */
export interface AuditChainInput {
  /** audit 회의의 모든 opinion row (T17 classifyAuditVerdict / extractAuditProblemList 입력). */
  opinions: readonly Opinion[];
  /** audit 회의록 markdown 본문 (compose_minutes 결과 통째). */
  auditMinutesMarkdown: string;
}

/**
 * `resolveHandoffChain` 의 입력. workflow kind 별로 *추가 필드* 가 다르지만,
 * 본 인터페이스는 모든 분기의 *교집합* 만 강제 — workflow-specific 필드는 분기
 * 별 helper 의 인자로 받는다 (audit 만 land, 나머지 placeholder).
 *
 *   - `workflowKind`            chain 분기의 단일 entry. 본 union 에 새 kind 추가
 *                                시 resolveHandoffChain 의 switch 도 case 추가.
 *   - `sender`                  보낸 부서 식별 (회의 종결 시점 컨텍스트)
 *   - `auditInput`              workflowKind='audit' 일 때만 필수. 다른 kind 일
 *                                때는 무시.
 *   - `resolveReceiverChannel`  caller injection — chain target role → channel
 *                                lookup 결과. null 반환 시 chain unhandled (또는
 *                                invariant 위반 — workflow 별 분기 책임).
 *   - `missionCardIdFactory`    mission card UUID 생성 helper. caller 가
 *                                `crypto.randomUUID` 또는 테스트 stub 주입.
 *   - `generatedAt`             현재 epoch ms. dispatchedAt + missionCard.createdAt
 *                                동시 사용. 테스트 가능성 위해 외부 주입 (caller
 *                                보통 `Date.now()`).
 */
export interface ChainResolverInput {
  workflowKind: WorkflowChainKind;
  sender: HandoffSender & { projectId: string };
  /** workflowKind='audit' 일 때만 채워야 함. 다른 kind 시 undefined OK. */
  auditInput?: AuditChainInput;
  resolveReceiverChannel: (role: ChannelRole) => ResolvedReceiverChannel | null;
  missionCardIdFactory: () => string;
  generatedAt: number;
}

// ── single entry: workflowKind 분기 ──────────────────────────────────

/**
 * 회의 종결 직후 단일 entry. workflowKind 별로 audit chain 만 actual wire,
 * 나머지는 placeholder 'no_chain' 반환. caller (orchestrator) 가 outcome 받아
 * handoff_mode 분기 + dispatch / 모달 / 회의 phase transition 처리.
 *
 * Invariant:
 *   - `workflowKind='audit'` 인데 `auditInput` 미지정 → throw
 *   - `auditInput.opinions` / `auditMinutesMarkdown` 의 직접 검증은 planAuditDispatch
 *     가 책임 (T25 land) — 본 함수가 wrap 한 번 더 검사하지 않음
 *   - `generatedAt` 음수/NaN → throw
 *   - `sender.projectId` blank → throw (chain target lookup 시 project scope 필수)
 *
 * @throws {HandoffChainResolverInvariantError}      입력 invariant 위반
 * @throws {AuditDispatchInvariantError}             audit chain 의 T25 분류↔추출 어긋남
 * @throws {HandoffPackageInvariantError}            합성된 HandoffPackage zod 위반
 *                                                   (보통 audit chain 의 build 단계)
 */
export function resolveHandoffChain(
  input: ChainResolverInput,
): ChainResolverOutcome {
  if (!Number.isFinite(input.generatedAt) || input.generatedAt < 0) {
    throw new HandoffChainResolverInvariantError(
      `generatedAt must be a finite non-negative epoch (got ${input.generatedAt})`,
    );
  }
  if (input.sender.projectId.trim().length === 0) {
    throw new HandoffChainResolverInvariantError(
      'sender.projectId must not be empty',
    );
  }

  switch (input.workflowKind) {
    case 'review':
      return { kind: 'no_chain', reason: 'review_outside_chain' };
    case 'general':
      return { kind: 'no_chain', reason: 'general_outside_chain' };
    case 'audit':
      return resolveAuditChain(input);
    case 'idea':
      // P3 후속 wire — idea → design.ux 매핑. T28 시점 미구현.
      return { kind: 'no_chain', reason: 'idea_chain_unhandled' };
    case 'planning':
      // R12-W 책임 — planning → implement 분담 (R12-C2 시점 simple 1 명).
      return { kind: 'no_chain', reason: 'planning_chain_unhandled' };
    case 'design':
      // P3 후속 wire — design → planning 인계 (HTML/CSS 결과 + Playwright PNG).
      return { kind: 'no_chain', reason: 'design_chain_unhandled' };
    case 'implement':
      // R12-W 책임 — implement → audit 자동 chain.
      return { kind: 'no_chain', reason: 'implement_chain_unhandled' };
    default: {
      // exhaustive 가드 — 새 WorkflowChainKind 추가 시 컴파일 에러로 case 누락 검출.
      const _exhaustive: never = input.workflowKind;
      throw new HandoffChainResolverInvariantError(
        `unknown workflowKind: ${String(_exhaustive)}`,
      );
    }
  }
}

// ── audit chain ──────────────────────────────────────────────────────

/**
 * audit verdict 분기 → planning chain 인계 또는 chain 종료. T25 planAuditDispatch
 * 결과를 받아 HandoffPackage 까지 합성. T25 가 이미 mission card 까지 만들어
 * 주므로 본 함수는 *receiver lookup + HandoffPackage build* 만 담당.
 *
 * 분기:
 *   - verdict='ok'            → no_chain (reason='audit_verdict_ok')
 *   - verdict='ng' + planning channel 미존재 → throw (caller 가 catch 후 회의 abort)
 *   - verdict='ng' + planning channel 존재   → chain_resolved (HandoffPackage 합성)
 *
 * Invariant:
 *   - audit chain 호출에 `auditInput` 미지정 → throw
 *   - sender.channelRole !== 'audit' → throw (workflow kind 와 sender role 일관성)
 *   - resolveReceiverChannel('planning') === null + verdict='ng' → throw
 *     (audit NG 인데 planning 부서 채널 0 건은 사용자 환경 invariant 위반)
 */
function resolveAuditChain(input: ChainResolverInput): ChainResolverOutcome {
  if (input.auditInput === undefined) {
    throw new HandoffChainResolverInvariantError(
      "workflowKind='audit' requires auditInput (opinions + minutesMarkdown)",
    );
  }
  if (input.sender.channelRole !== 'audit') {
    throw new HandoffChainResolverInvariantError(
      `workflowKind='audit' requires sender.channelRole='audit' (got ${String(
        input.sender.channelRole,
      )})`,
    );
  }

  // 1) verdict 미리 분류 — 'ng' + receiver 미존재 시 *명시 invariant error* (T25
  //    planAuditDispatch 의 lower-level error 보다 chain resolver 의 의미를 caller
  //    에게 명확하게 surface).
  const verdict = classifyAuditVerdict(input.auditInput.opinions);
  const planningReceiver = input.resolveReceiverChannel('planning');
  if (verdict === 'ng' && planningReceiver === null) {
    throw new HandoffChainResolverInvariantError(
      "audit verdict='ng' but no planning channel resolved — invariant violated " +
        '(every project must have at least one planning department channel)',
    );
  }

  // 2) T25 planAuditDispatch 호출. verdict='ok' 면 'end' outcome → no_chain.
  //    verdict='ng' 면 'planning_handoff' outcome → HandoffPackage 합성.
  //    verdict='ok' branch 는 receiver lookup 자체가 의미 없음 — dummy 값 (빈 문자열) 을
  //    넘겨도 'end' branch 로 즉시 반환 (T25 spec).
  const outcome = planAuditDispatch({
    opinions: input.auditInput.opinions,
    auditMinutesMarkdown: input.auditInput.auditMinutesMarkdown,
    sourceAuditMeetingId: input.sender.meetingId,
    sourceAuditChannelId: input.sender.channelId,
    targetPlanningChannelId: planningReceiver?.channelId ?? '',
    assignedPlanningProviderId: planningReceiver?.assignedProviderId ?? '',
    missionCardId: input.missionCardIdFactory(),
    generatedAt: input.generatedAt,
  });

  if (outcome.kind === 'end') {
    return { kind: 'no_chain', reason: 'audit_verdict_ok' };
  }

  // verdict='ng' branch — 위 1) 단계에서 receiver === null 미리 차단했으므로
  // 본 시점에 planningReceiver 는 NonNull (TypeScript narrowing 보조).
  if (planningReceiver === null) {
    throw new HandoffChainResolverInvariantError(
      "internal: planningReceiver became null after planAuditDispatch — invariant lost",
    );
  }

  // HandoffPackage 합성. T25 outcome 의 missionCard + planning receiver 의
  // channel id + handoff_mode + audit 회의 metadata 통합.
  const pkg: HandoffPackage = buildHandoffPackage({
    sender: {
      meetingId: input.sender.meetingId,
      channelId: input.sender.channelId,
      channelRole: input.sender.channelRole,
    },
    target: {
      channelId: planningReceiver.channelId,
      channelRole: 'planning',
    },
    reason: composeAuditNgHandoffReason(outcome.payload.problemList.length),
    minutesMeetingId: input.sender.meetingId,
    nextActions: [],
    missionCard: outcome.missionCard,
    mode: planningReceiver.handoffMode,
    dispatchedAt: input.generatedAt,
  });

  return { kind: 'chain_resolved', package: pkg };
}

/**
 * audit NG 인계 사유 한 줄 합성. 받는 부서 (planning) 모달의 "인계 사유" 라벨에
 * 노출되며, problem 갯수만 명시 — 본문은 회의록 (`auditMinutesMarkdown`) 에 통째
 * 보존되므로 본 reason 은 *가벼운 헤드라인* 만.
 *
 * caller 가 더 풍부한 reason 을 만들고 싶으면 본 helper 호출 전에 자체 작성 후
 * `buildHandoffPackage` 호출 — 본 helper 는 default 합성 path.
 */
function composeAuditNgHandoffReason(problemCount: number): string {
  return `검토 부서 NG 판정 — ${problemCount} 건 문제 발견. 기획 회의에서 처리 작업으로 분배 필요.`;
}
