/**
 * MeetingFlow types — R12-C2 T10a 회의 진행 phase + 직원 응답 zod schema.
 *
 * 옛 12 단계 SSM 모델 (`OPINION_GATHERING` / `OPINION_TALLY` / `AGREEMENT_VOTE`
 * / `REVISION_NEGOTIATION` / `WORK_DISCUSSING` / `EXECUTING` / ...) 폐기. 새
 * 5 + 2.5 단계 모델 (spec §5):
 *
 *   1.  gather                    직원 의견 제시
 *   2.  tally                     시스템 취합 + 화면 ID 부여 (no-network)
 *   2'. awaiting_user_pick        사용자 카드 선택 + 자유 코멘트 입력 대기 (idea, §5.1)
 *   2.5 quick_vote                일괄 동의 투표 — 만장일치 시 자유 토론 skip (풀세트)
 *   3.  free_discussion           자유 토론 (의견 1 건씩 라운드 누적, 풀세트)
 *   5.  compose_minutes           모더레이터 회의록 작성
 *   6.  handoff                   인계 — handoff_mode='auto' 즉시 / 'check' Notification
 *
 * 디자인 부서 (R12-C2 T16) 추가 phase 2 종 — 풀세트 회의 사이/후 단계:
 *   *.  assigning_designated_task 시스템→지정 직원 단일 turn 지시 (개별 task)
 *                                 step 1 (UX 와이어프레임 작성) /
 *                                 step 5 (UI 와이어프레임 수정) /
 *                                 step 6 (UI HTML/CSS 작성) 진입 시
 *   *.  generating_snapshot       Playwright PNG 생성 (desktop + mobile)
 *                                 step 7 풀세트 회의 합의 후, handoff 직전
 *
 * `aborted` / `done` 은 종료 상태 — orchestrator 가 phase loop 종결 시 진입.
 *
 * 모든 풀세트 부서 (planning / design.* / review / audit) 가 같은 phase loop
 * 공유. 부서별 차이는 prompt template + handoff target 분기로만. 아이디어
 * 부서 (D-B-Light, T15 land) 는 `gather → tally → awaiting_user_pick →
 * compose_minutes → handoff` 5 phase 만 사용 — quick_vote / free_discussion
 * surface X. 디자인 부서 (T16) 는 `(assigning_designated_task → gather →
 * tally → quick_vote → free_discussion → compose_minutes) × 2 →
 * generating_snapshot → handoff` 흐름 — 풀세트 회의를 두 번 거친다.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5    D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *  - §5.1  아이디어 부서 D-B-Light + USER_PICK (T15)
 *  - §5.2  디자인 부서 7 단계 — 와이어프레임 5 + 디자인 2 (T16, R12-C2)
 *  - §11.14 channels.max_rounds (회의 종료 조건)
 *  - §11.18 직원 응답 JSON schema 4 종
 *  - §11.18.7 awaiting_user_pick 은 직원 응답 X (사용자 IPC 입력만)
 *  - §11.18.9 assigning_designated_task / generating_snapshot 직원 응답 분기 (T16)
 */

import { z } from 'zod';

// ── Phase enum ───────────────────────────────────────────────────────────

/**
 * 새 5+2.5 phase + idea-workflow USER_PICK + design-workflow 추가 2 phase
 * + 종료 2 phase. 11 종.
 *
 * `meetings.state` 컬럼에 phase 문자열 그대로 저장 — 옛 SSM state 문자열
 * (`OPINION_GATHERING` 등) 자리에 phase 가 들어감 (migration 019 의 정식
 * — 컬럼 자체는 유지, 값만 교체).
 *
 * `awaiting_user_pick` (T15 land) 은 idea-workflow 만 진입하는 사용자 입력
 * 대기 phase — 직원 응답 X (PHASE_RESPONSE_SCHEMAS 미매핑) / 사용자 IPC
 * `meetings:idea-finalize-selection` 응답 시 compose_minutes 로 전이.
 *
 * `assigning_designated_task` (T16 land) 는 design-workflow 의 시스템→지정
 * 직원 단일 turn 지시 phase — 풀세트 회의 사이의 step 1/5/6. 직원 응답 1 회
 * 받아 root opinion 으로 등록 후 다음 phase 진입. spec §11.18.9 별도 schema.
 *
 * `generating_snapshot` (T16 land) 는 design-workflow step 7 (UI HTML/CSS)
 * 풀세트 회의 합의 직후, handoff 직전 Playwright PNG 생성 phase. 직원 응답
 * X — 시스템 내부 작업 (Electron BrowserWindow off-screen render).
 */
export type MeetingPhase =
  | 'gather'
  | 'tally'
  | 'awaiting_user_pick'
  | 'quick_vote'
  | 'free_discussion'
  | 'assigning_designated_task'
  | 'compose_minutes'
  | 'generating_snapshot'
  | 'handoff'
  | 'aborted'
  | 'done';

/**
 * 진행 중 phase 9 종 (gather / tally / awaiting_user_pick / quick_vote /
 * free_discussion / assigning_designated_task / compose_minutes /
 * generating_snapshot / handoff).
 */
export const ACTIVE_MEETING_PHASES: ReadonlyArray<MeetingPhase> = [
  'gather',
  'tally',
  'awaiting_user_pick',
  'quick_vote',
  'free_discussion',
  'assigning_designated_task',
  'compose_minutes',
  'generating_snapshot',
  'handoff',
];

/** 종료 phase 2 종. */
export const TERMINAL_MEETING_PHASES: ReadonlyArray<MeetingPhase> = [
  'aborted',
  'done',
];

/**
 * Phase 진행 순서 — 진행도 게이지 (0..N) 산출용. quick_vote 만장일치 시
 * free_discussion skip 가능, 아이디어 부서는 quick_vote / free_discussion 대신
 * awaiting_user_pick 거침, 디자인 부서는 풀세트 phase 전에 assigning_designated_task
 * 가 반복 진입하고 compose_minutes 후 generating_snapshot 거침 — 본 배열은 모든
 * 흐름의 ordinal 표현일 뿐이라 실제 phase 진입은 orchestrator + workflow
 * 분기에 따른다.
 */
export const MEETING_PHASE_ORDER: ReadonlyArray<MeetingPhase> = [
  'gather',
  'tally',
  'awaiting_user_pick',
  'quick_vote',
  'free_discussion',
  'assigning_designated_task',
  'compose_minutes',
  'generating_snapshot',
  'handoff',
  'done',
];

/** Type guard. */
export function isMeetingPhase(value: string): value is MeetingPhase {
  return (
    value === 'gather' ||
    value === 'tally' ||
    value === 'awaiting_user_pick' ||
    value === 'quick_vote' ||
    value === 'free_discussion' ||
    value === 'assigning_designated_task' ||
    value === 'compose_minutes' ||
    value === 'generating_snapshot' ||
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

// ── §11.18.9 — assigning_designated_task (T16, design-workflow) ─────────

/**
 * §11.18.9 — design-workflow 의 시스템→지정 직원 단일 turn 지시 응답.
 *
 * 응답 구조는 §11.18.2 (step 1 의견 제시) 와 *동일* — `opinions` 배열에 단일
 * root 의견 1 건. 시스템이 단일 직원 (designated worker) 에게 단일 prompt 로
 * 지시 → 그 직원의 단일 turn 응답을 root opinion 으로 등록. 따라서 schema 본체
 * 도 `Step1OpinionGatherSchema` 와 동일 — alias 로 export 해 spec 참조 명확화
 * + 향후 분기 필요 시 (예: 와이어프레임용 `wireframe_text` 필드 추가) 본 alias
 * 만 교체하면 됨.
 *
 * 빈 opinions 배열 허용 (직원 "거부" 응답 — orchestrator 가 1 회 재요청 +
 * 2 회 실패 시 회의 abort, idea/full-set 의 의견-없음 분기와 다름).
 */
export const Step6DesignedTaskSchema = Step1OpinionGatherSchema;

export type Step6DesignedTaskSchemaType = z.infer<
  typeof Step6DesignedTaskSchema
>;

/**
 * design-workflow assigning_designated_task phase 의 sub-kind.
 *
 *   - `wireframe_drafting`     step 1 — UX 직원이 와이어프레임 초안 작성
 *   - `wireframe_revision`     step 5 — UI 직원이 와이어프레임 합의 반영 수정
 *   - `design_implementation`  step 6 — UI 직원이 HTML/CSS 작성
 *
 * orchestrator (T16b land 시) 가 phase 진입 시 sub-kind 별 prompt template
 * 분기 + designated worker capability (`design.ux` / `design.ui`) 분기에 사용.
 */
export type DesignedTaskKind =
  | 'wireframe_drafting'
  | 'wireframe_revision'
  | 'design_implementation';

export const DESIGNED_TASK_KINDS: ReadonlyArray<DesignedTaskKind> = [
  'wireframe_drafting',
  'wireframe_revision',
  'design_implementation',
];

/** Type guard. */
export function isDesignedTaskKind(value: string): value is DesignedTaskKind {
  return (
    value === 'wireframe_drafting' ||
    value === 'wireframe_revision' ||
    value === 'design_implementation'
  );
}

// ── Phase 별 직원 응답 schema 매핑 ────────────────────────────────────

/**
 * Phase ↔ schema 매핑. turn-executor 가 `requestTurn(phase)` 시 어느 schema
 * 로 검증할지 결정. compose_minutes / handoff / tally / generating_snapshot /
 * awaiting_user_pick / aborted / done 은 직원 응답 X — schema 없음 (null).
 *
 * `assigning_designated_task` 는 Step6DesignedTaskSchema (= Step1과 alias) 로
 * 검증 — 시스템→직원 단일 지시 응답이 의견 #N root 형태로 들어옴.
 */
export const PHASE_RESPONSE_SCHEMAS = {
  gather: Step1OpinionGatherSchema,
  quick_vote: Step25QuickVoteSchema,
  free_discussion: Step3FreeDiscussionSchema,
  assigning_designated_task: Step6DesignedTaskSchema,
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
