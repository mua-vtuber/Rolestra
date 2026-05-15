/**
 * audit-handoff-dispatch — R12-C2 P5 T25 land. spec §3 line 77 / §4 line 145 /
 * §11.18.6 / §11.22.4.
 *
 * 검토 (audit) 부서 회의 종결 직후 verdict 분기 wire:
 *
 *   verdict='ok'  → chain 종료 + 사용자 승인 게이트만 surface (회의 X). 추가
 *                   인계 X — 사무실 메타포로는 "검토 끝, 문제 없음, 출판 OK".
 *
 *   verdict='ng'  → 기획 (planning) 부서 자동 인계. T17 buildAuditHandoffPayload
 *                   결과 + T23 mission-card schema 의 'fix' payload 로 변환.
 *                   기획이 받은 회의에서 각 문제를 *처리 작업* 으로 분배 →
 *                   구현 부서로 chain 재진입 (구현 → 검토 → ...).
 *
 * 본 모듈은 *types + 순수 helper* 만 land — orchestrator wire X. T16a (design-
 * workflow) / T17 (audit / review) / T24 (implement) 와 같은 thin extension
 * 설계. 실제 dispatch 흐름 (handoff_dispatch row 영속 / planning 채널 회의
 * boot / Notification 발송) 은 P6 책임:
 *
 *   - T27   migration 021 — handoff_dispatch 테이블 + HandoffPackage schema
 *   - T28   HandoffApprovalModal + handoff_mode (check / auto) 분기 wire
 *   - T29   받는 부서 첫 화면 인계 패키지 표시 (HandoffPackageCard)
 *
 * 본 sub-task (T25) 의 스코프:
 *
 *   1. {@link AuditDispatchOutcome} discriminated union — 'end' (verdict='ok')
 *      | 'planning_handoff' (verdict='ng' + payload + missionCard 동봉).
 *   2. {@link planAuditDispatch} — single entry point. audit 회의 결과 +
 *      planning 채널 식별자 + assigned provider + id + epoch → outcome.
 *      classify / extract / buildPayload / buildMissionCard 합성.
 *   3. {@link buildFixMissionCardFromAuditPayload} — `AuditHandoffPayload` +
 *      planning 채널 identity → MissionCard kind='fix' (T23 schema 그대로).
 *   4. {@link composeFixMissionBody} — 기본 body 합성. caller 가 override 가능.
 *   5. {@link AuditDispatchInvariantError} — invariant 위반 (assignedProviderId
 *      비어 있음 / missionCardId 비어 있음 / 분류↔추출 결과 어긋남 / 등).
 *
 * **R12-C2 시점 wiring 상태:** orchestrator (MeetingOrchestrator) 가 audit
 * channel.role 분기 + compose_minutes 직후 본 모듈 호출 → outcome.kind 별로
 * 대응 (end → 사용자 승인 게이트만 surface / planning_handoff → handoff
 * dispatch row 영속 + 받는 부서 회의 boot). 단계별 wire 는 P6 의 다른 sub-task
 * 책임 — 본 모듈 자체는 *plan 만* 만든다 (실 dispatch X).
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 77        audit = 객관 + 목적 통합 / chain 끝 강제 / NG → 기획
 *  - §4 line 145       audit 매트릭스 row (OK / NG 분기 + 회의록 [합의]=문제)
 *  - §11.18.6          minutes.md 양식 ([합의] = 문제 / [제외] = 수용 가능)
 *  - §11.22.4          인계 패키지 = 회의록 본문 통째 + metadata
 *
 * plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  - line 247-255      T25 산출 (audit 종결 분류 + 기획 인계 분기 정식 wire)
 */

import type { ChannelRole } from '../../../shared/channel-role-types';
import type { Opinion } from '../../../shared/opinion-types';
import {
  buildMissionCard,
  type FixMissionPayload,
  type MissionCard,
} from '../../../shared/schema/mission-card';
import {
  AUDIT_NG_TARGET_ROLE,
  AuditHandoffPayloadInvariantError,
  buildAuditHandoffPayload,
  classifyAuditVerdict,
  extractAuditProblemList,
  type AuditHandoffPayload,
  type AuditProblem,
  type AuditVerdict,
} from './audit-workflow';

// ── outcome ─────────────────────────────────────────────────────────

/**
 * `planAuditDispatch` 결과 discriminated union — verdict 분기 별 caller 처리.
 *
 *   - `kind='end'`              audit verdict='ok'. 회의록 land + 사용자 승인
 *                               게이트만 surface. 추가 회의 / 인계 X. caller
 *                               (orchestrator) 는 chain 종료 처리.
 *
 *   - `kind='planning_handoff'` audit verdict='ng'. payload (회의록 통째 +
 *                               problemList) + missionCard (kind='fix') 가
 *                               완성되어 caller 가 handoff_dispatch row INSERT
 *                               + planning 채널 회의 boot + Notification
 *                               발송 처리. targetRole 는 항상 'planning'
 *                               (`AUDIT_NG_TARGET_ROLE` 상수와 동일).
 *
 * `verdict` 필드는 outcome.kind 와 *중복* 정보지만, caller 가 단일 필드 비교만
 * 으로 verdict 를 audit log / 분석 시 추출할 수 있도록 명시. JSON 직렬화 시
 * 데이터 자기설명 (self-describing) 강화.
 */
export type AuditDispatchOutcome =
  | {
      kind: 'end';
      verdict: 'ok';
      /** 종료 사유 — verdict_ok_no_problems_found 단일 값 (확장 여지). */
      reason: 'verdict_ok_no_problems_found';
    }
  | {
      kind: 'planning_handoff';
      verdict: 'ng';
      /** T17 buildAuditHandoffPayload 결과 — 회의록 통째 + problemList. */
      payload: AuditHandoffPayload;
      /** T23 mission-card schema 의 'fix' payload — 기획 부서 designated worker 입력. */
      missionCard: MissionCard;
      /** 인계 대상 부서 — 항상 'planning' (`AUDIT_NG_TARGET_ROLE` 와 동일). */
      targetRole: ChannelRole;
    };

// ── invariant error ────────────────────────────────────────────────

/**
 * `planAuditDispatch` / `buildFixMissionCardFromAuditPayload` /
 * `composeFixMissionBody` 의 invariant 위반 시 throw — caller (orchestrator)
 * 가 catch 후 회의 abort + 사용자 노출 에러 분기.
 *
 * `AuditHandoffPayloadInvariantError` (T17) 는 본 모듈이 wrap — caller 가 한
 * 종류의 에러 (`AuditDispatchInvariantError`) 만 catch 하면 됨. 원본 메시지는
 * `message` 안에 포함.
 */
export class AuditDispatchInvariantError extends Error {
  constructor(message: string) {
    super(`[AuditDispatch] ${message}`);
    this.name = 'AuditDispatchInvariantError';
  }
}

// ── default expected outputs ───────────────────────────────────────

/**
 * 'fix' mission card 의 `expectedOutputs` 기본값. caller 가 override 안 하면
 * 본 list 가 들어간다 — 기획 부서 designated worker 가 *재기획 산출물* 형식을
 * 자체 해석할 수 있도록 자유 텍스트 형태.
 *
 * caller 가 더 구체적 산출 형식 (예: "src/foo.ts 작업 카드 4 개")을 지시하고
 * 싶으면 `missionExpectedOutputs` 인자로 override.
 */
export const DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS: readonly string[] = [
  '각 문제별 처리 작업 분배 — 작업 할당안 또는 처리 절차 정형화',
  '재기획 회의록 — 처리 우선순위 + 의존 작업 명시',
] as const;

// ── default body composer ──────────────────────────────────────────

/**
 * mission card 'fix' payload 의 `body` 기본값 합성. mission card schema 가
 * `body` min(1) 을 강제하므로 caller 가 빈 body 를 넘기지 않도록 안전 기본값
 * 제공. caller (orchestrator) 가 더 풍부한 prompt 컨텍스트를 직접 작성하고
 * 싶으면 `body` 인자로 override.
 *
 * 본 합성은 problem list 를 1-line 요약 (opinionId + title) 만 노출 — 본문 전체
 * 는 mission card payload 의 `auditMinutesMarkdown` + `problemList` 에 그대로
 * 보존되므로 body 에서 truncate 위반 우려 없음. body 는 *받는 부서가 작업을
 * 시작할 시점의 컨텍스트 한 줄 요약* 역할.
 *
 * `problemList` 가 비어 있으면 invariant 위반 throw — 'fix' 카드는 항상 ≥1 개의
 * 문제를 가진다 (T17 buildAuditHandoffPayload 의 `problemList.length === 0`
 * 거부와 일관).
 *
 * `title` 이 빈 문자열이면 *(제목 없음)* 으로 normalize — audit 직원이 root
 * opinion 작성 시 title 누락 가능 (Opinion.title 이 NULL 가능 컬럼이라 T17
 * extractAuditProblemList 가 빈 문자열로 normalize 한 결과).
 */
export function composeFixMissionBody(input: {
  problemList: readonly AuditProblem[];
}): string {
  if (input.problemList.length === 0) {
    throw new AuditDispatchInvariantError(
      'composeFixMissionBody: problemList must be non-empty',
    );
  }
  const lines: string[] = [];
  lines.push(
    `검토 부서 NG 판정 — ${input.problemList.length} 건 문제 발견. ` +
      '기획 회의에서 각 문제를 처리할 작업으로 분배해 주세요.',
  );
  lines.push('');
  lines.push('[발견된 문제]');
  for (const [i, p] of input.problemList.entries()) {
    const title = p.title.trim().length > 0 ? p.title : '(제목 없음)';
    lines.push(`${i + 1}. (${p.opinionId}) ${title}`);
  }
  lines.push('');
  lines.push(
    '회의록 본문은 mission card 의 `auditMinutesMarkdown` 자리에 통째 보존. ' +
      '발견된 문제는 회의에서 agreed 처리된 root opinion 만 — excluded 는 ' +
      '처리 X (논의 결과 수용 가능 항목으로 분류).',
  );
  return lines.join('\n');
}

// ── mission card builder (audit payload → fix mission card) ────────

/**
 * `AuditHandoffPayload` (T17) → `MissionCard` kind='fix' (T23). 본 helper 는
 * payload 의 `targetPlanningChannelId` 를 mission card 의 `targetChannelId`
 * 자리로 매핑 + caller 가 resolve 한 `assignedProviderId` 를 합성.
 *
 * payload 의 `problemList` 는 audit-workflow 의 `AuditProblem` 형식 (rationale +
 * authorLabel 포함) — mission card schema 의 `problemList` 는 opinionId + title +
 * content 만 받음. 본 helper 가 변환 시 rationale + authorLabel *제거*. 이
 * 정보는 audit 회의록 본문 (`auditMinutesMarkdown`) 에 이미 보존되므로 손실
 * 없음 (planning designated worker 가 본문 + rationale 모두 활용 가능).
 *
 * caller 가 `body` / `inputFiles` / `expectedOutputs` 를 override 하지 않으면
 * 기본값 사용:
 *   - `body`            {@link composeFixMissionBody} 결과 (problem 1-line 요약)
 *   - `inputFiles`      `[]` 빈 배열 (재기획은 회의록 + problem list 만으로 충분)
 *   - `expectedOutputs` {@link DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS}
 *
 * Invariant:
 *   - `assignedProviderId` blank → throw
 *   - `missionCardId` blank → throw
 *   - `createdAt` NaN/음수 → throw
 *   - `MissionCardInvariantError` (T23 buildMissionCard 가 던지는 zod 위반)
 *     은 본 함수가 wrap 안 함 — caller 가 직접 처리 (mission card schema 위반은
 *     audit-dispatch invariant 가 아닌 별개 영속 boundary 에러).
 */
export function buildFixMissionCardFromAuditPayload(input: {
  payload: AuditHandoffPayload;
  assignedProviderId: string;
  missionCardId: string;
  createdAt: number;
  body?: string;
  inputFiles?: readonly string[];
  expectedOutputs?: readonly string[];
}): MissionCard {
  if (input.assignedProviderId.trim().length === 0) {
    throw new AuditDispatchInvariantError(
      'assignedProviderId must be non-empty',
    );
  }
  if (input.missionCardId.trim().length === 0) {
    throw new AuditDispatchInvariantError('missionCardId must be non-empty');
  }
  if (!Number.isFinite(input.createdAt) || input.createdAt < 0) {
    throw new AuditDispatchInvariantError(
      `createdAt must be a finite non-negative epoch (got ${input.createdAt})`,
    );
  }

  const body =
    input.body !== undefined
      ? input.body
      : composeFixMissionBody({ problemList: input.payload.problemList });

  const problemList = input.payload.problemList.map((p) => ({
    opinionId: p.opinionId,
    title: p.title,
    content: p.content,
  }));

  const fixPayload: FixMissionPayload = {
    kind: 'fix',
    body,
    inputFiles: input.inputFiles ?? [],
    expectedOutputs:
      input.expectedOutputs ?? DEFAULT_FIX_MISSION_EXPECTED_OUTPUTS,
    auditMinutesMarkdown: input.payload.auditMinutesMarkdown,
    problemList,
  };

  return buildMissionCard({
    id: input.missionCardId,
    payload: fixPayload,
    assignedProviderId: input.assignedProviderId,
    targetChannelId: input.payload.targetPlanningChannelId,
    createdAt: input.createdAt,
  });
}

// ── single entry: full plan ────────────────────────────────────────

/**
 * audit 회의 종결 시 호출되는 *single entry point*. T17 의 classify / extract /
 * buildPayload + T23 의 buildMissionCard 를 합성해 `AuditDispatchOutcome` 을
 * 반환.
 *
 * verdict='ok' branch 는 `targetPlanningChannelId` / `assignedPlanningProviderId`
 * / `missionCardId` / `mission*` 인자가 *사용되지 않음*. caller 가 dummy 값
 * (예: 빈 문자열) 을 넘겨도 OK — 본 함수가 verdict='ok' 면 즉시 'end' 반환.
 *
 * verdict='ng' branch 에서 invariant 검증:
 *   - `targetPlanningChannelId` blank → throw (planning 채널 resolve 실패)
 *   - 분류 결과는 'ng' 인데 problem 추출이 빈 list → throw (audit-workflow
 *     invariant 위반 — 같은 opinion 집합을 다른 결과로 봄)
 *   - `buildAuditHandoffPayload` 가 throw 하면 invariant 로 wrap 후 re-throw
 *   - `buildFixMissionCardFromAuditPayload` 의 invariant throw 는 그대로 전파
 *
 * caller 책임 (P6 wire 시점):
 *   - planning 채널 lookup — channel.role='planning' AND project_id 일치하는
 *     단일 row. 다중 / 미존재는 caller 의 에러 분기 (R12-C2 시점은 단일 가정,
 *     R13+ 다중 부서 인계 추후).
 *   - assigned provider resolve — designated-worker-resolver (T23 land) 가
 *     planning 채널의 capability='planning' 직원 1 명 선택.
 *   - missionCardId — `crypto.randomUUID()` (caller 에서 생성).
 *   - generatedAt — `Date.now()` (테스트 가능성 위해 외부 주입).
 */
export function planAuditDispatch(input: {
  /** audit 회의의 모든 opinion row — verdict 분류 + problemList 추출 입력. */
  opinions: readonly Opinion[];
  /** audit 회의록 markdown 본문 (compose_minutes 결과 통째). */
  auditMinutesMarkdown: string;
  /** audit 회의 ID — payload metadata. */
  sourceAuditMeetingId: string;
  /** audit 채널 ID — payload metadata. */
  sourceAuditChannelId: string;
  /**
   * 인계 대상 planning 채널 ID. verdict='ng' 시만 사용 — 'ok' 시는 무시.
   * caller 가 channel.role='planning' AND project_id 일치 단일 row resolve 후 전달.
   */
  targetPlanningChannelId: string;
  /**
   * 인계 받을 planning 부서 designated worker provider ID. verdict='ng' 시만
   * 사용 — 'ok' 시는 무시. caller 가 designated-worker-resolver 호출 후 전달.
   */
  assignedPlanningProviderId: string;
  /** mission card id (UUID). verdict='ng' 시만 사용 — 'ok' 시는 무시. */
  missionCardId: string;
  /** 생성 시점 Unix epoch ms. payload.generatedAt + missionCard.createdAt 동시 사용. */
  generatedAt: number;
  /** mission card body override (optional). 미지정 시 composeFixMissionBody 결과. */
  missionBody?: string;
  /** mission card inputFiles override (optional). 미지정 시 `[]`. */
  missionInputFiles?: readonly string[];
  /** mission card expectedOutputs override (optional). 미지정 시 DEFAULT 상수. */
  missionExpectedOutputs?: readonly string[];
}): AuditDispatchOutcome {
  const verdict: AuditVerdict = classifyAuditVerdict(input.opinions);

  if (verdict === 'ok') {
    return {
      kind: 'end',
      verdict: 'ok',
      reason: 'verdict_ok_no_problems_found',
    };
  }

  // verdict === 'ng' branch — planning 인계 path.
  const problemList = extractAuditProblemList(input.opinions);
  if (problemList.length === 0) {
    // verdict 분류와 problem 추출은 같은 opinion 집합을 본다 — 결과가 어긋나면
    // audit-workflow 의 분류 규칙 일관성이 깨졌다는 뜻. 본 모듈은 caller 가
    // 알아채도록 명시적 throw (silent skip 금지).
    throw new AuditDispatchInvariantError(
      "classifyAuditVerdict='ng' but extractAuditProblemList=[] — invariant violated " +
        '(audit-workflow.classify ↔ extract divergence)',
    );
  }
  if (input.targetPlanningChannelId.trim().length === 0) {
    throw new AuditDispatchInvariantError(
      'targetPlanningChannelId must be non-empty when verdict=ng',
    );
  }

  let payload: AuditHandoffPayload | null;
  try {
    payload = buildAuditHandoffPayload({
      verdict: 'ng',
      sourceAuditMeetingId: input.sourceAuditMeetingId,
      sourceAuditChannelId: input.sourceAuditChannelId,
      targetPlanningChannelId: input.targetPlanningChannelId,
      auditMinutesMarkdown: input.auditMinutesMarkdown,
      problemList,
      generatedAt: input.generatedAt,
    });
  } catch (err) {
    if (err instanceof AuditHandoffPayloadInvariantError) {
      throw new AuditDispatchInvariantError(
        `buildAuditHandoffPayload threw: ${err.message}`,
      );
    }
    throw err;
  }
  if (payload === null) {
    // verdict='ng' 일 때 buildAuditHandoffPayload 가 null 을 반환할 일은 T17
    // 구현상 없음 — 방어적 throw 로 type narrowing 보장 (이후 missionCard
    // build 시 payload 가 NonNull 이라는 invariant 컴파일러에 명시).
    throw new AuditDispatchInvariantError(
      "buildAuditHandoffPayload returned null for verdict='ng' — schema mismatch",
    );
  }

  const missionCard = buildFixMissionCardFromAuditPayload({
    payload,
    assignedProviderId: input.assignedPlanningProviderId,
    missionCardId: input.missionCardId,
    createdAt: input.generatedAt,
    body: input.missionBody,
    inputFiles: input.missionInputFiles,
    expectedOutputs: input.missionExpectedOutputs,
  });

  return {
    kind: 'planning_handoff',
    verdict: 'ng',
    payload,
    missionCard,
    targetRole: AUDIT_NG_TARGET_ROLE,
  };
}
