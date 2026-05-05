/**
 * RunStep 도메인 타입 — migration 020-run-step 컬럼과 1:1 camelCase 매핑.
 *
 * 회의 안 모든 turn 의 진행 일지. 회의록 (`minutes.md` — 모더레이터 작성,
 * 의견 단위) 과 별개 — RunStep 은 *시스템 단계 단위* 누적.
 *
 * 활용:
 *  - B (NextStep 분류, T13)   `stepKind='next_step_classify'` row 가 분류 결과 영속
 *  - F (검사관, T11)          `stepKind='inspector_check'` row 가 위반 검출 영속
 *  - H (진행률, T31~T34)      부서별 RunStep count + stepKind 분포 → 진행률 산출
 *  - 회의 재현 (디버깅)       `meetingId` 기준 turn-by-turn replay
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19  A. RunStep 영속 기록부 (cross-cutting)
 *
 * 저장 정책 (spec §11.19.4):
 *  - 모든 turn 1 row 이상   caller (T13 orchestrator) 책임
 *  - truncate 금지            inputJson / outputJson 통째 보존
 *  - atomic write             한 turn row 들 transaction 묶음
 *  - append-only              update / delete X (서비스가 메서드 미노출로 강제)
 */

// ── enum (DB CHECK 제약과 정합) ─────────────────────────────────────────

/**
 * RunStep 행위 주체:
 * - `system`     migrator / orchestrator / inspector 자동 동작
 * - `employee`   직원 (provider) 발화 / 분류
 * - `moderator`  회의록 모더레이터 동작
 * - `user`       사용자 직접 동작 (메시지 / 결재 / 트리거)
 */
export type RunStepActorKind = 'system' | 'employee' | 'moderator' | 'user';

/**
 * RunStep 단계 종류 (10 enum, spec §11.19.2):
 * - `opinion_gather`         step 1 — 직원 의견 제시
 * - `opinion_tally`          step 2 — 시스템 취합
 * - `quick_vote`             step 2.5 — 일괄 동의 투표
 * - `free_discussion`        step 3 — 자유 토론
 * - `minutes_compose`        step 5 — 모더레이터 회의록 작성
 * - `next_step_classify`     B1 분류기 결정 (T13)
 * - `handoff_dispatch`       인계 실행
 * - `tool_invoke`            도구 호출 (ExecutionService 경유)
 * - `approval_request`       결재 요청
 * - `inspector_check`        F 검사관 결과 (T11+)
 */
export type RunStepKind =
  | 'opinion_gather'
  | 'opinion_tally'
  | 'quick_vote'
  | 'free_discussion'
  | 'minutes_compose'
  | 'next_step_classify'
  | 'handoff_dispatch'
  | 'tool_invoke'
  | 'approval_request'
  | 'inspector_check';

/**
 * NextStep 분류 결과 7 카드 (spec §11.18.8):
 * - `continue`  계속 발언 (자동 진행)
 * - `wait`      대기 (자동 진행 — 안전군 fallback)
 * - `approve`   결재 (사용자 확인 모달)
 * - `tool`      도구 호출 (사용자 확인 모달)
 * - `handoff`   인계 (사용자 확인 모달)
 * - `minutes`   회의록 정리 (사용자 확인 모달)
 * - `end`       회의 종료 (사용자 확인 모달)
 *
 * `null` = `stepKind !== 'next_step_classify'` 인 RunStep 의 기본값.
 */
export type NextStepCard =
  | 'continue'
  | 'wait'
  | 'approve'
  | 'tool'
  | 'handoff'
  | 'minutes'
  | 'end';

// ── DB row 매핑 ─────────────────────────────────────────────────────────

/** run_step 테이블 row 의 camelCase 매핑. */
export interface RunStep {
  /** UUID v4. */
  id: string;
  /** FK meetings.id (CASCADE — 회의 삭제 시 일지도 사라짐). */
  meetingId: string;
  /** FK channels.id (CASCADE — 채널 삭제 시 일지도 사라짐). */
  channelId: string;
  /** 회의 라운드 카운터 (max_rounds 와 정렬). */
  round: number;
  /** 회의 안 turn 순서 (0 부터, 같은 turn = 같은 index). */
  turnIndex: number;
  actorKind: RunStepActorKind;
  /**
   * NULL = system / moderator / user (provider 와 무관) 또는 직원 삭제 후
   * 보존된 일지. 직원 진실원천이 사라져도 row 는 살아남는다 (감사 무결성).
   */
  actorId: string | null;
  stepKind: RunStepKind;
  /** JSON 문자열 — step 입력 (prompt / schema / 컨텍스트). truncate 금지. */
  inputJson: string;
  /** JSON 문자열 — step 출력 (응답 / 분류 결과 / 영향 범위). truncate 금지. */
  outputJson: string;
  /**
   * B1 분류 결과. `stepKind='next_step_classify'` 만 채움 — 다른 step 은 NULL.
   */
  nextStepCard: NextStepCard | null;
  /**
   * 1-line 사이드이펙트 요약 (예: "opinion_vote 3 row 작성" / "handoff →
   * audit 채널"). 사이드이펙트 없는 step (분류 결과만 등) 은 NULL.
   */
  sideEffectSummary: string | null;
  /** step 소요 시간 (ms). */
  durationMs: number;
  /** Unix epoch ms (opinion 등 다른 테이블과 일관). */
  createdAt: number;
}

/**
 * 신규 RunStep — `id` / `createdAt` 는 RunStepService 가 자동 생성.
 * caller 는 도메인 정보만 채워 service.appendForTurn 에 넘긴다.
 */
export type NewRunStep = Omit<RunStep, 'id' | 'createdAt'>;
