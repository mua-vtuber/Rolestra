/**
 * audit-workflow — R12-C2 P3 T17 land. spec §3 line 77 / §4 line 145 /
 * §11.12.1 line 955 + 957 + 959 / §11.22.4.
 *
 * 검토 부서 (channel.role === 'audit') 는 풀세트 5+2.5 phase loop (planning /
 * design / review 와 동일 backend) 위에 얹는 *handoff routing 분기*만 다른 부서:
 *
 *   - 표준 chain *끝* 강제 — 구현 (implement) 완료 직후 자동 진입.
 *   - 회의록 verdict 분기 (spec line 145):
 *       OK → 사용자 승인 게이트 + chain 종료. 추가 회의 X.
 *       NG → **기획 (planning) 부서 자동 인계**. 검토는 문제 발견만, 처리는
 *            기획에 위임 (spec line 77).
 *   - 회의록 형식: [합의] = 문제 / [제외] = 논의 후 수용 가능
 *     (즉 audit 맥락에서 *agreed root opinion* = 확정된 문제, *excluded* =
 *     논의 결과 문제 아니라 확정된 항목).
 *
 * 본 모듈은 *types + 순수 helper* 만 land — design-workflow.ts (T16a) / idea-
 * workflow.ts (T15) 와 같은 thin extension 설계. orchestrator wire (NG → 기획
 * 인계 dispatch + Notification + handoff_dispatch row) 는 T25 책임. 본
 * sub-task 의 스코프:
 *
 *   1. AuditVerdict union 정의 ('ok' | 'ng')
 *   2. classifyAuditVerdict — 회의록 agreed root opinion 수 기반 결정적 분류
 *   3. AuditHandoffPayload 인터페이스 — NG case 인계 패키지 형식
 *   4. buildAuditHandoffPayload — verdict='ok' → null / 'ng' → 패키지 builder
 *   5. AUDIT_NG_TARGET_ROLE 상수 — NG 인계 대상 부서 ('planning')
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §3 line 77        audit = 객관 + 목적 통합 / chain 끝 강제
 *  - §4 line 145       audit 매트릭스 row (OK / NG 분기 + 회의록 [합의]=문제)
 *  - §11.12.1 line 955+957+959  audit lock 모델 (NG 인계 시점에 풀림)
 *  - §11.22.4          인계 패키지 = 회의록 본문 통째 + metadata
 */

import type { ChannelRole } from '../../../shared/channel-role-types';
import type {
  Opinion,
  OpinionKind,
  OpinionStatus,
} from '../../../shared/opinion-types';

// ── verdict ─────────────────────────────────────────────────────────

/**
 * 검토 부서 회의 종결 시 verdict — spec line 145 카논:
 *
 *   - `'ok'`  agreed root opinion 0 건 (= 문제 발견 0). 사용자 승인 게이트
 *             + chain 종료. 추가 회의 X.
 *   - `'ng'`  agreed root opinion ≥ 1 건 (= 문제 발견 ≥ 1). 기획 부서 자동
 *             인계. 검토는 문제 발견만, 처리는 기획에 위임.
 *
 * 본 verdict 는 *결정적* — 회의록 markdown / fallback 여부 / 직원 발화 turn
 * 수 / 모더레이터 응답과 *무관*. 오직 opinion 테이블의 (kind='root',
 * status='agreed') row 수만 본다. 이 invariant 가 OpinionService /
 * MeetingMinutesService 의 동작과 정합 — agreed = 만장일치 quick_vote 통과
 * 또는 자유 토론 종결 시 합의 도달.
 */
export type AuditVerdict = 'ok' | 'ng';

/**
 * `classifyAuditVerdict` 의 입력 — Opinion row 의 최소 부분집합. caller 가
 * `Opinion[]` 그대로 넘겨도 호환 (TypeScript structural subtyping).
 *
 * caller 는 *해당 audit 회의의 모든 opinion row* 를 한 번에 넘겨야 함 — root
 * 만 필터링하지 말 것. 본 함수가 root 필터를 책임진다 (call-site 누락 방지).
 */
export interface AuditVerdictOpinionView {
  kind: OpinionKind;
  status: OpinionStatus;
}

/**
 * audit 회의 verdict 결정. spec line 145 + line 949 — agreed root opinion
 * 0 건이면 OK / ≥ 1 건이면 NG.
 *
 * `kind === 'root'` 필터 이유: 자유 토론 수정안 / 반대안 / 보강안 (revise /
 * block / addition) 도 status='agreed' 가 될 수 있지만, 회의록 [합의] 단락은
 * *root opinion* 단위로 구성되므로 (자식 의견은 root 의 합의 처리에 흡수)
 * verdict 도 root 만 본다.
 *
 * `self-raised` / `user-raised` (일반 채널 [##] 카드) 는 audit 회의에서 발생
 * X — 본 함수가 만나면 silent ignore (kind !== 'root' 라 자연스럽게 제외).
 */
export function classifyAuditVerdict(
  opinions: readonly AuditVerdictOpinionView[],
): AuditVerdict {
  for (const op of opinions) {
    if (op.kind === 'root' && op.status === 'agreed') {
      return 'ng';
    }
  }
  return 'ok';
}

/**
 * verdict 가 'ng' 일 때 회의록 [합의] 단락에 들어갈 root opinion 본문 추출.
 * spec §11.18.6 회의록 양식 — 각 [합의] item = title + content + rationale.
 *
 * caller 는 `AuditHandoffPayload.problemList` 에 본 결과를 넣어 받는 부서
 * (planning) 가 *문제별 분류 + 처리 분배* 에 사용 (T25 orchestrator wire).
 */
export function extractAuditProblemList(
  opinions: readonly Opinion[],
): readonly AuditProblem[] {
  const problems: AuditProblem[] = [];
  for (const op of opinions) {
    if (op.kind !== 'root') continue;
    if (op.status !== 'agreed') continue;
    problems.push({
      opinionId: op.id,
      title: op.title ?? '',
      content: op.content ?? '',
      rationale: op.rationale ?? '',
      authorLabel: op.authorLabel,
    });
  }
  return problems;
}

/**
 * 검토 회의에서 발견된 문제 1 건 — root opinion content + metadata.
 *
 * `title` / `content` / `rationale` 는 audit 직원이 step 1 (gather) 발화 시
 * 작성. NULL 가능 컬럼이지만 본 view 에서는 빈 문자열로 normalize — 받는
 * 부서 (planning) prompt 가 NULL 대비 분기를 가질 필요 없도록.
 */
export interface AuditProblem {
  /** opinion.id (UUID) — handoff_dispatch payload 안 reference. */
  opinionId: string;
  title: string;
  content: string;
  rationale: string;
  /** 발화자 식별 (예: `claude_1`) — planning 채널 prompt 안 출처 표시. */
  authorLabel: string;
}

// ── 인계 패키지 (NG case) ───────────────────────────────────────────

/**
 * audit → planning 자동 인계 패키지 (verdict='ng' 시만 생성). spec §11.22.4
 * 카논 — *minutes.md 본문 통째* + metadata + 추출된 문제 list. 받는 부서
 * (planning) 의 step 1 prompt 가 본 markdown 을 컨텍스트로 prepend + 문제
 * list 를 *처리 작업* 으로 분배.
 *
 * T25 (handoff_dispatch row 영속 + planning 채널 회의 소집) 가 본 객체 받아
 * DB row + 받는 부서 회의 boot + step 1 컨텍스트 wire. 본 sub-task (T17) 는
 * builder 정의까지만.
 */
export interface AuditHandoffPayload {
  /** audit 회의 ID — handoff_dispatch.from_meeting_id 자리. */
  sourceAuditMeetingId: string;
  /** audit 채널 ID — handoff_dispatch.from_channel_id 자리. */
  sourceAuditChannelId: string;
  /** 받는 planning 채널 ID — handoff_dispatch.to_channel_id 자리. */
  targetPlanningChannelId: string;
  /** audit 회의록 markdown 본문 (§11.18.6 minutes.md 통째). truncate 금지. */
  auditMinutesMarkdown: string;
  /** 회의에서 발견된 문제 list — extractAuditProblemList 결과. */
  problemList: readonly AuditProblem[];
  /** Unix epoch ms — handoff_dispatch.dispatched_at 자리 (생성 시점). */
  generatedAt: number;
}

/**
 * verdict + audit 회의 결과 → planning 인계 payload. verdict='ok' → null
 * (인계 X) / 'ng' → AuditHandoffPayload. caller (T25 orchestrator wire) 가
 * null 받으면 chain 종료 + 사용자 승인 게이트만 surface.
 *
 * 입력 invariant:
 *   - verdict='ng' 인데 problemList 가 비어 있으면 invariant 위반 throw —
 *     verdict 분류와 problem 추출은 같은 opinion 집합을 봐야 정합.
 *   - auditMinutesMarkdown 이 비어 있으면 throw (compose_minutes invariant).
 *   - generatedAt 이 NaN/음수 면 throw.
 */
export function buildAuditHandoffPayload(input: {
  verdict: AuditVerdict;
  sourceAuditMeetingId: string;
  sourceAuditChannelId: string;
  targetPlanningChannelId: string;
  auditMinutesMarkdown: string;
  problemList: readonly AuditProblem[];
  generatedAt: number;
}): AuditHandoffPayload | null {
  if (input.verdict === 'ok') {
    return null;
  }
  if (input.problemList.length === 0) {
    throw new AuditHandoffPayloadInvariantError(
      "verdict='ng' but problemList is empty — extract/classify mismatch",
    );
  }
  if (input.auditMinutesMarkdown.trim().length === 0) {
    throw new AuditHandoffPayloadInvariantError(
      'audit minutes markdown is empty — compose_minutes invariant violated',
    );
  }
  if (!Number.isFinite(input.generatedAt) || input.generatedAt < 0) {
    throw new AuditHandoffPayloadInvariantError(
      `generatedAt must be a finite non-negative epoch (got ${input.generatedAt})`,
    );
  }
  return {
    sourceAuditMeetingId: input.sourceAuditMeetingId,
    sourceAuditChannelId: input.sourceAuditChannelId,
    targetPlanningChannelId: input.targetPlanningChannelId,
    auditMinutesMarkdown: input.auditMinutesMarkdown,
    problemList: input.problemList,
    generatedAt: input.generatedAt,
  };
}

/**
 * `buildAuditHandoffPayload` invariant 위반 시 throw — caller (orchestrator)
 * 가 catch 후 회의 abort + 사용자 노출 에러 분기.
 */
export class AuditHandoffPayloadInvariantError extends Error {
  constructor(message: string) {
    super(`[AuditHandoffPayload] ${message}`);
    this.name = 'AuditHandoffPayloadInvariantError';
  }
}

// ── 인계 대상 부서 ──────────────────────────────────────────────────

/**
 * audit verdict='ng' 시 자동 인계 대상 부서 — *항상 기획 (planning)*. spec
 * line 77 ("NG → 항상 기획 부서로 인계"). 본 상수가 단일 진실 원천 — 향후
 * 정책 변경 시 한 곳만 수정 (call-site 흩어짐 방지).
 *
 * RoleId 자리는 'planning' (R12-S 카탈로그 line 87 안 부서 10 종 중 하나).
 */
export const AUDIT_NG_TARGET_ROLE: ChannelRole = 'planning';

// ── role guard ──────────────────────────────────────────────────────

/**
 * 채널이 검토 부서인지 확인. orchestrator 가 channel.role 분기 시 사용 —
 * design 부서의 `isDesignDepartmentRole` 패턴 그대로.
 */
export function isAuditDepartmentRole(role: ChannelRole): boolean {
  return role === 'audit';
}
