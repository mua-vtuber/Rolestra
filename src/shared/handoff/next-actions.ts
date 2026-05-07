/**
 * handoff/next-actions — R12-C2 P6 T29. spec §11.22.3.
 *
 * 받는 부서 H2 카드의 *"받는 부서가 처리할 작업"* 목록을 mission card payload
 * 에서 derive 하는 단일 entry. 회의록 markdown 자동 추출은 spec §11.18.6 양식
 * 에 "## 다음 단계" 섹션이 들어가지 않으므로 구현 X (사용자 결정 2026-05-07).
 *
 * 매핑 정책:
 *   - `kind='spec'`              → payload.expectedOutputs 그대로 (planning →
 *                                  implement chain. designated worker 산출 형식)
 *   - `kind='fix'`               → payload.problemList 의 1-line summary
 *                                  (opinionId + title) + payload.expectedOutputs
 *                                  병합 (audit NG → planning 재기획 chain)
 *   - `kind='change-request'`    → payload.expectedOutputs 그대로 (사용자
 *                                  변경 요청. body 는 카드 본문 자리이므로 별도)
 *
 * 본 모듈은 *순수 함수* 만 — main / renderer / preload 모두 import 가능. shared/
 * 위치 선택은 renderer 의 HandoffPackageCard 가 빠른 경로로 호출 가능하도록.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §11.22.2  H2 카드 표시 항목 — "받는 부서가 처리할 작업"
 *  - §11.22.3  데이터 source — mission card payload (사용자 결정 따라)
 */

import type {
  ChangeRequestMissionPayload,
  FixMissionPayload,
  MissionCardPayload,
  SpecMissionPayload,
} from '../schema/mission-card';

// ── single entry ─────────────────────────────────────────────────────

/**
 * mission card payload → 받는 부서 작업 list. UI 표시 용도이므로 빈 배열 허용
 * (caller 가 별 표시 — "(작업 list 없음)" 라벨 가능).
 *
 * 본 함수는 *순수* — 같은 payload 입력 시 항상 같은 결과. 실제 작업 분배는
 * 받는 부서 designated worker 의 회의 응답이 결정 — 본 list 는 *사용자에게
 * 노출되는 헤드라인* 일 뿐.
 */
export function extractNextActions(
  payload: MissionCardPayload,
): readonly string[] {
  switch (payload.kind) {
    case 'spec':
      return extractSpecNextActions(payload);
    case 'fix':
      return extractFixNextActions(payload);
    case 'change-request':
      return extractChangeRequestNextActions(payload);
    default: {
      const _exhaustive: never = payload;
      void _exhaustive;
      return [];
    }
  }
}

// ── kind 별 helpers ──────────────────────────────────────────────────

/**
 * 'spec' payload — planning → implement chain. expectedOutputs 가 designated
 * worker 의 *산출물 형식* 이므로 그대로 작업 list 에 노출.
 */
function extractSpecNextActions(
  payload: SpecMissionPayload,
): readonly string[] {
  return payload.expectedOutputs;
}

/**
 * 'fix' payload — audit NG → planning 재인계. problem list 가 *수정해야 할 항목*
 * 이고, expectedOutputs 가 *재기획 산출 형식*. 두 데이터 모두 받는 부서가 처리할
 * 작업의 일부 — *문제 list* 가 먼저 (사용자가 NG 항목 한눈에 파악) + 산출 형식
 * 이 그 뒤.
 *
 * problem 1-line summary = `(opinionId) title` — title 이 빈 문자열이면 *(제목 없음)*
 * 으로 normalize (audit-handoff-dispatch composeFixMissionBody 와 정합).
 */
function extractFixNextActions(
  payload: FixMissionPayload,
): readonly string[] {
  const result: string[] = [];

  for (const problem of payload.problemList) {
    const title =
      problem.title.trim().length > 0 ? problem.title : '(제목 없음)';
    result.push(`문제 처리: (${problem.opinionId}) ${title}`);
  }

  for (const expected of payload.expectedOutputs) {
    result.push(`산출: ${expected}`);
  }

  return result;
}

/**
 * 'change-request' payload — 사용자 free-form 요청. expectedOutputs 만 (body 는
 * 카드 본문 자리). 사용자 변경 요청은 보통 expectedOutputs 가 비어 있을 수 있음
 * (사용자가 산출 형식 미지정) — 그 경우 빈 배열 그대로.
 */
function extractChangeRequestNextActions(
  payload: ChangeRequestMissionPayload,
): readonly string[] {
  return payload.expectedOutputs;
}
