/**
 * MeetingFlow types — R12-C2 T10a 회의 진행 phase + 직원 응답 zod schema.
 *
 * 옛 12 단계 SSM 모델 (`OPINION_GATHERING` / `OPINION_TALLY` / `AGREEMENT_VOTE`
 * / `REVISION_NEGOTIATION` / `WORK_DISCUSSING` / `EXECUTING` / ...) 폐기. 새
 * 5 + 2.5 단계 모델 (spec §5):
 *
 *   1.  gather             직원 의견 제시
 *   2.  tally              시스템 취합 + 화면 ID 부여 (no-network)
 *   2.5 quick_vote         일괄 동의 투표 — 만장일치 시 자유 토론 skip
 *   3.  free_discussion    자유 토론 (의견 1 건씩 라운드 누적)
 *   5.  compose_minutes    모더레이터 회의록 작성
 *   6.  handoff            인계 — handoff_mode='auto' 즉시 / 'check' Notification
 *
 * `aborted` / `done` 은 종료 상태 — orchestrator 가 phase loop 종결 시 진입.
 *
 * 모든 풀세트 부서 (planning / design.* / review / audit) 가 같은 phase loop
 * 공유. 부서별 차이는 prompt template + handoff target 분기로만. 아이디어
 * 부서 (D-B-Light) 는 `gather` → `tally` → `handoff` 3 phase 만 사용.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5    D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *  - §11.14 channels.max_rounds (회의 종료 조건)
 *  - §11.18 직원 응답 JSON schema 4 종
 */

import { z } from 'zod';

// ── Phase enum ───────────────────────────────────────────────────────────

/**
 * 새 5+2.5 phase + 종료 2 phase. 8 종.
 *
 * `meetings.state` 컬럼에 phase 문자열 그대로 저장 — 옛 SSM state 문자열
 * (`OPINION_GATHERING` 등) 자리에 phase 가 들어감 (migration 019 의 정식
 * — 컬럼 자체는 유지, 값만 교체).
 */
export type MeetingPhase =
  | 'gather'
  | 'tally'
  | 'quick_vote'
  | 'free_discussion'
  | 'compose_minutes'
  | 'handoff'
  | 'aborted'
  | 'done';

/** 진행 중 phase 4 종 (gather / tally / quick_vote / free_discussion / compose_minutes / handoff). */
export const ACTIVE_MEETING_PHASES: ReadonlyArray<MeetingPhase> = [
  'gather',
  'tally',
  'quick_vote',
  'free_discussion',
  'compose_minutes',
  'handoff',
];

/** 종료 phase 2 종. */
export const TERMINAL_MEETING_PHASES: ReadonlyArray<MeetingPhase> = [
  'aborted',
  'done',
];

/**
 * Phase 진행 순서 — 진행도 게이지 (0..N) 산출용. quick_vote 만장일치 시
 * free_discussion skip 가능, 아이디어 부서는 quick_vote / free_discussion /
 * compose_minutes 모두 skip — 본 배열은 "정상 풀세트 흐름" 의 ordinal 표현
 * 일 뿐이라 실제 phase 진입은 orchestrator 분기에 따른다.
 */
export const MEETING_PHASE_ORDER: ReadonlyArray<MeetingPhase> = [
  'gather',
  'tally',
  'quick_vote',
  'free_discussion',
  'compose_minutes',
  'handoff',
  'done',
];

/** Type guard. */
export function isMeetingPhase(value: string): value is MeetingPhase {
  return (
    value === 'gather' ||
    value === 'tally' ||
    value === 'quick_vote' ||
    value === 'free_discussion' ||
    value === 'compose_minutes' ||
    value === 'handoff' ||
    value === 'aborted' ||
    value === 'done'
  );
}

// ── max_rounds 디폴트 ─────────────────────────────────────────────────────

/**
 * 사용자 결정 (2026-05-04): channels.max_rounds 컬럼이 NULL 이면 5 라운드
 * fallback. 사용자가 채널 설정에서 명시적으로 무제한 (NULL) 또는 다른 정수
 * 입력 가능 — 본 상수는 *코드 fallback* 일 뿐.
 *
 * 라운드 1 회 = step 3 (자유 토론) 안에서 진행 의견 1 개에 대해 직원 N 명이
 * 한 바퀴 돌며 동의/반대/수정 응답한 묶음. 의견 1 개 합의되면 다음 의견으로
 * 넘어가고 라운드 카운터 리셋.
 */
export const MEETING_DEFAULT_MAX_ROUNDS = 5;

/**
 * 의견 트리 깊이 cap — `ITEM_001` (depth 0) → `ITEM_001_01` (depth 1) →
 * `ITEM_001_01_01` (depth 2) 까지 3 레벨. 본 상수는 spec §5 + OpinionService
 * (이미 land) 의 `OPINION_DEPTH_CAP` 과 정합 — 본 파일에서는 참조용.
 */
export const MEETING_OPINION_DEPTH_CAP = 3;

// ── StreamBridge phase 신호 페이로드 (R12-C2 T10a 신규) ─────────────────

/**
 * `stream:meeting-phase-changed` 신호 페이로드.
 *
 * 사용자 결정 (2026-05-04, ① 결정): 새 신호 추가 + 옛 `stream:meeting-state-
 * changed` 도 *값만* 새 phase 문자열로 dispatch (schema 호환). 새 신호는 prev
 * phase + round 정보를 풍부하게 — P3 SsmBox 가 본 신호 구독으로 마이그레이션.
 *
 * 옛 `stream:meeting-state-changed` (StreamMeetingStateChangedPayload) 는
 * `state: string` 만 들어 있어 prev / round 정보 X — 본 신호로 대체된다.
 * 옛 신호 자체 통째 삭제는 P3 종결 시점 (T10b 책임 X — subscriber 가 새
 * 신호로 마이그레이션 끝나야 가능).
 */
export interface StreamMeetingPhaseChangedPayload {
  meetingId: string;
  channelId: string;
  /** 직전 phase. 회의 시작 직후 첫 emit 은 null. */
  prevPhase: MeetingPhase | null;
  phase: MeetingPhase;
  /**
   * free_discussion phase 안 라운드 카운터. 다른 phase 에서는 0. 의견 1 개
   * 합의되면 다음 의견 진입 시 0 으로 리셋 (라운드 cap 은 의견별).
   */
  round: number;
  /**
   * free_discussion phase 안 진행 중 의견의 *화면 ID* (예 `ITEM_002`). 다른
   * phase 에서는 null. P3 SsmBox 가 어떤 카드 highlight 할지 결정.
   */
  currentOpinionScreenId: string | null;
}

// ── 직원 응답 zod schema (§11.18.2 / .4 / .5 — 4 종 중 자유 markdown 모더레이터 응답 제외) ─────

/**
 * §11.18.2 — step 1 의견 제시.
 *
 * 한 응답 안에 여러 opinions 가능 (모두 같은 label 공유). 빈 배열 허용
 * (직원이 "의견 없음" 응답 — orchestrator 가 0 row insert 하고 계속).
 *
 * truncate 금지 — schema 자체에 길이 제약 X. 모더레이터 회의록의 truncate
 * 검사는 MeetingMinutesService 책임.
 */
export const Step1OpinionGatherSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  opinions: z.array(
    z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
});

export type Step1OpinionGatherSchemaType = z.infer<
  typeof Step1OpinionGatherSchema
>;

/**
 * §11.18.4 — step 2.5 일괄 동의 투표.
 *
 * `target_id` 는 화면 ID (`ITEM_NNN`). 시스템이 screen→UUID 매핑 후 vote row
 * 생성. 빈 배열은 허용 X — 투표 단계인데 0 표 응답은 직원 오류로 보고 caller
 * 가 1 회 재요청 + 2 회 실패 시 skip.
 */
export const Step25QuickVoteSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  quick_votes: z
    .array(
      z.object({
        target_id: z.string().min(1),
        vote: z.enum(['agree', 'oppose', 'abstain']),
        comment: z.string().optional(),
      }),
    )
    .min(1, 'quick_votes must have at least 1 entry'),
});

export type Step25QuickVoteSchemaType = z.infer<typeof Step25QuickVoteSchema>;

/**
 * §11.18.5 — step 3 자유 토론.
 *
 * 한 턴에 votes (기존 의견 / 자식 투표) + additions (새 자식 의견) 동시 가능.
 * 둘 다 빈 배열은 허용 X — 자유 토론 단계인데 vote 0 + addition 0 은 무응답
 * 으로 caller 가 1 회 재요청 + 2 회 실패 시 skip.
 *
 * 깊이 cap 검증은 OpinionService.freeDiscussionRound 가 throw — schema 자체
 * 는 parent_id 형식만 검증.
 */
export const Step3FreeDiscussionSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    votes: z.array(
      z.object({
        target_id: z.string().min(1),
        vote: z.enum(['agree', 'oppose', 'abstain']),
        comment: z.string().optional(),
      }),
    ),
    additions: z.array(
      z.object({
        parent_id: z.string().min(1),
        kind: z.enum(['revise', 'block', 'addition']),
        title: z.string().min(1),
        content: z.string().min(1),
        rationale: z.string().min(1),
      }),
    ),
  })
  .refine(
    (data) => data.votes.length + data.additions.length > 0,
    {
      message: 'Step3FreeDiscussion: votes + additions must total ≥ 1',
    },
  );

export type Step3FreeDiscussionSchemaType = z.infer<
  typeof Step3FreeDiscussionSchema
>;

// ── Phase 별 직원 응답 schema 매핑 ────────────────────────────────────

/**
 * Phase ↔ schema 매핑. turn-executor 가 `requestTurn(phase)` 시 어느 schema
 * 로 검증할지 결정. compose_minutes / handoff / tally / aborted / done 은
 * 직원 응답 X — schema 없음 (null).
 */
export const PHASE_RESPONSE_SCHEMAS = {
  gather: Step1OpinionGatherSchema,
  quick_vote: Step25QuickVoteSchema,
  free_discussion: Step3FreeDiscussionSchema,
} as const;

// ── 응답 검증 결과 ──────────────────────────────────────────────────────

/**
 * turn-executor 가 1 회 호출당 반환하는 결과. caller (orchestrator) 가 모든
 * participant 응답 모은 후 OpinionService 호출.
 *
 * `skipped: true` 는 spec §11.18.7 의 "2 회 실패 시 직원 응답 skip + 다음
 * 직원 진행" 분기 — 회의 자체는 멈추지 않는다. caller 는 skipped 응답을
 * OpinionService 호출 입력에서 제외.
 */
export type MeetingTurnResult<T> =
  | {
      kind: 'ok';
      providerId: string;
      payload: T;
      messageId: string;
    }
  | {
      kind: 'skipped';
      providerId: string;
      reason: 'invalid-schema' | 'provider-error' | 'work-status-gate' | 'aborted';
    };
