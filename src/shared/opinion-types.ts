/**
 * Opinion 도메인 타입 — migration 019-opinion-tables 컬럼과 1:1 camelCase 매핑.
 *
 * 새 회의 모델 (R12-C2) 의 토대. 모든 풀세트 부서 (planning / design.* /
 * review / audit) 가 공유한다. 일반 채널 [##본문] 카드도 같은 테이블 사용
 * (`kind='self-raised'` / `'user-raised'` + `meetingId` NULL 허용).
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5  데이터 모델 (opinion + opinion_vote)
 *  - §11.18  직원 응답 JSON schema (4 종)
 *
 * 화면 ID (ITEM_NNN / ITEM_NNN_NN / ITEM_NNN_NN_NN) 는 *DB 비저장*. 시스템이
 * parent chain depth-first 순회로 매번 재구성한다 — DB 진실원천 = `id`(UUID)
 * + `parentId`. 깊이 cap = 3 (§5).
 */

// ── 6 enum (DB CHECK 제약과 정합) ────────────────────────────────────────

/**
 * 의견 종류:
 * - `root`        회의 step 1 직원 의견 제시 (parent 없음)
 * - `revise`      자유 토론 수정안 (parent 있음)
 * - `block`       자유 토론 반대안 (parent 있음)
 * - `addition`    자유 토론 보강안 (parent 있음)
 * - `self-raised` 일반 채널 직원 발화 [##본문] (회의 X)
 * - `user-raised` 일반 채널 사용자 발화 [##본문] 또는 의견 게시 모달
 */
export type OpinionKind =
  | 'root'
  | 'revise'
  | 'block'
  | 'addition'
  | 'self-raised'
  | 'user-raised';

/**
 * 의견 status — 회의 진행 동안 시스템이 갱신:
 * - `pending`   초기값 (의견 제시 / 자유 토론 진입 시)
 * - `agreed`    합의 도달 (만장일치 quick_vote 또는 자유 토론 종결)
 * - `rejected`  명시적 반대 다수 → 회의록 [제외]
 * - `excluded`  논의 후 수용 가능 — 회의록 [제외] + 사용자 재발화 안내
 */
export type OpinionStatus = 'pending' | 'agreed' | 'rejected' | 'excluded';

/** 투표 값 — 직원 응답 schema 안 vote 필드. */
export type OpinionVoteValue = 'agree' | 'oppose' | 'abstain';

/**
 * 투표 라운드 종류 (`opinion_vote.round_kind` CHECK 제약):
 * - `quick_vote`       step 2.5 일괄 동의 투표 (의견 list 통째 한 번에)
 * - `free_discussion`  step 3 자유 토론 (의견 1 건씩 round-by-round)
 * - `light`            R12-C2 P4 T21 — 일반 채널 가벼운 동의/반대 (회의 X)
 *                      voter_provider_id NULL (사용자 1 인) / round 0 / comment NULL
 */
export type OpinionRoundKind = 'quick_vote' | 'free_discussion' | 'light';

// ── DB row 매핑 ─────────────────────────────────────────────────────────

/** opinion 테이블 row 의 camelCase 매핑. */
export interface Opinion {
  id: string;
  parentId: string | null;
  /** NULL = 일반 채널 [##] 카드 (회의 없이 등록). */
  meetingId: string | null;
  channelId: string;
  kind: OpinionKind;
  /** NULL = 직원 삭제 후에도 의견 보존 (author_label 로 식별). */
  authorProviderId: string | null;
  /** 회의 단위 발화 카운터 — 형식 `<provider>_<n>` (예 `codex_1`). */
  authorLabel: string;
  title: string | null;
  content: string | null;
  rationale: string | null;
  status: OpinionStatus;
  /** status='rejected'/'excluded' 시 회의록 제외 사유 (모더레이터 작성). */
  exclusionReason: string | null;
  round: number;
  createdAt: number;
  updatedAt: number;
}

/** opinion_vote 테이블 row 의 camelCase 매핑. */
export interface OpinionVote {
  id: string;
  /** 투표 대상 의견 UUID. opinion.id FK. */
  targetId: string;
  /** NULL = 직원 삭제 후에도 투표 row 보존. */
  voterProviderId: string | null;
  vote: OpinionVoteValue;
  comment: string | null;
  round: number;
  roundKind: OpinionRoundKind;
  createdAt: number;
}

// ── 직원 응답 JSON schema (§11.18.2 / .4 / .5) ──────────────────────────

/**
 * §11.18.2 — step 1 의견 제시. 직원이 회의 첫 발화 때 제출하는 응답 양식.
 *
 * 한 응답 안에 여러 opinions 배열 가능 (모두 같은 `label` 공유). 시스템이
 * 받으면 `kind='root'` `parentId=null` `status='pending'` opinion row N 개
 * 생성.
 */
export interface Step1OpinionGatherResponse {
  /** 직원 표시명 (예 "Codex"). 시스템이 author_provider_id 와 매칭해 검증. */
  name: string;
  /** 회의 단위 발화 ID — 형식 `<provider>_<n>`. */
  label: string;
  opinions: Array<{
    /** 의견 제목 (≤ 80 글자 권장). DB title 에 그대로 저장. */
    title: string;
    /** 의견 본문. truncate 금지 — DB content 에 그대로 저장. */
    content: string;
    /** 근거 / 이유. DB rationale 에 그대로 저장. */
    rationale: string;
  }>;
}

/**
 * §11.18.4 — step 2.5 일괄 동의 투표. 직원이 의견 list 통째 받고 한 번에 투표.
 *
 * `target_id` 는 *화면 ID* (`ITEM_NNN`). 시스템이 screen→UUID 매핑 후
 * `opinion_vote` row 생성 (`roundKind='quick_vote'`). 모든 voter agree → 만장일치
 * → opinion.status='agreed' 즉시 반영 + 자유 토론 skip.
 */
export interface Step25QuickVoteResponse {
  name: string;
  label: string;
  quick_votes: Array<{
    /** 화면 ID (예 "ITEM_001"). 시스템이 UUID 로 매핑. */
    target_id: string;
    vote: OpinionVoteValue;
    /** Optional — agree 하면서도 코멘트 가능 (회의록에 보존). */
    comment?: string;
  }>;
}

/**
 * §11.18.5 — step 3 자유 토론 round. 의견 1 건씩 진행.
 *
 * 직원이 한 턴에 (a) 기존 의견 / 자식에 vote, (b) 새 자식 의견 추가 둘 다
 * 가능. 시스템이 votes → opinion_vote row, additions → opinion row (kind 따라
 * 분기, screen ID 새로 부여).
 *
 * 깊이 cap 3 — additions.parent_id 가 depth 3 의견을 가리키면 시스템이 throw
 * (silent fallback X — spec §11.18.7 + CLAUDE.md mock/fallback 금지 rule).
 */
export interface Step3FreeDiscussionResponse {
  name: string;
  label: string;
  votes: Array<{
    target_id: string;
    vote: OpinionVoteValue;
    comment?: string;
  }>;
  additions: Array<{
    /** 자식이 매달릴 부모 화면 ID (예 "ITEM_002"). 시스템이 UUID 로 매핑. */
    parent_id: string;
    /** 'revise' / 'block' / 'addition' — root 는 step 1 에서만 생성. */
    kind: 'revise' | 'block' | 'addition';
    title: string;
    /** truncate 금지. */
    content: string;
    rationale: string;
  }>;
}

// ── service / IPC 결과 타입 ─────────────────────────────────────────────

/** OpinionService.gather 결과 — 새로 insert 된 의견 row N 개. */
export interface OpinionGatherResult {
  meetingId: string;
  inserted: Opinion[];
}

/**
 * tally 결과 트리 노드. 화면 ID (`screenId`) 는 매번 재구성 — DB 미저장.
 */
export interface OpinionTreeNode {
  opinion: Opinion;
  /** 화면 ID — `ITEM_NNN` / `ITEM_NNN_NN` / `ITEM_NNN_NN_NN`. */
  screenId: string;
  /** 0 = root, 1 = 자식, 2 = 손자 (cap 3 → max 2). */
  depth: number;
  children: OpinionTreeNode[];
}

/** OpinionService.tally 결과. */
export interface OpinionTallyResult {
  meetingId: string;
  rootCount: number;
  totalCount: number;
  tree: OpinionTreeNode[];
  /** screen ID → UUID 매핑 (caller 가 step 2.5/3 응답 파싱 시 활용). */
  screenToUuid: Record<string, string>;
  /** UUID → screen ID 역매핑 (UI 표시용). */
  uuidToScreen: Record<string, string>;
}

/** OpinionService.quickVote 결과. */
export interface OpinionQuickVoteResult {
  meetingId: string;
  /** 만장일치로 status='agreed' 갱신된 의견 UUID list. */
  agreed: string[];
  /** 만장일치 못 받아 step 3 으로 넘어가는 의견 UUID list (status='pending' 그대로). */
  unresolved: string[];
  /** 이번 round 에 insert 된 opinion_vote row 개수. */
  votesInserted: number;
}

/** OpinionService.freeDiscussionRound 결과. */
export interface OpinionFreeDiscussionResult {
  meetingId: string;
  /** 이번 round 에서 자유 토론 대상이었던 의견 UUID. */
  opinionId: string;
  /** 이번 round 종결 시 만장일치 도달 여부 (true → opinion.status='agreed'). */
  agreed: boolean;
  /** 새로 insert 된 자식 의견 row N 개. */
  additions: Opinion[];
  /** 이번 round 에 insert 된 opinion_vote row 개수. */
  votesInserted: number;
}

// ── 일반 채널 [##본문] 카드 (T20 land — spec §4 일반 부서 새 정의) ─────

/**
 * 일반 채널 (`channel.kind === 'system_general'` 또는
 * `channel.kind === 'user' && channel.role === 'general'`) 안에서 의견
 * 카드 1+ 건을 등록하는 입력. caller (general-channel-opinion-flow 의 [##]
 * 자동 파싱, PostOpinionModal 의 사용자 입력 모달 두 가지) 가 동일한
 * surface 를 통해 호출.
 *
 * 룰 (T20, 2026-05-06):
 *   - `parts.length === 0` → ValidationError throw (caller 가 파서 결과
 *     0 건이면 호출 자체를 skip 해야 한다)
 *   - 각 part 는 opinion row 1 건이 된다 — kind 는 authorProviderId 로 결정:
 *     `null` = `'user-raised'`, 아니면 `'self-raised'`
 *   - parentId=null, meetingId=null, status='pending', round=0
 *   - authorLabel 자동 부여 — `${author}_${n}` (n = 채널 안 같은 author 의
 *     기존 카드 수 + 1, batch 안 incremental)
 *   - title null = service 가 content 첫 줄 / 80 자 cut 으로 derive
 */
export interface PostFromGeneralChannelInput {
  channelId: string;
  /** `null` = 사용자 발화. 아니면 직원 providerId. */
  authorProviderId: string | null;
  parts: Array<{
    /** `null` 이면 service 가 content 에서 derive. 아니면 그대로 저장. */
    title: string | null;
    /** 의견 본문 (parser 결과 body 또는 모달 본문). 빈 문자열 throw. */
    content: string;
  }>;
}

/** OpinionService.postFromGeneralChannel 결과. */
export interface PostFromGeneralChannelResult {
  channelId: string;
  /** 등장 순서대로 insert 된 opinion row N 개. */
  inserted: Opinion[];
}

// ── idea-workflow USER_PICK (T15 land — spec §5.1) ─────────────────────

/**
 * `meetings:idea-finalize-selection` IPC 입력 — 사용자가 awaiting_user_pick
 * phase 안 카드 선택 + 자유 코멘트 commit. spec §5.1.
 *
 * 입력 검증 룰 (사용자 결정 2026-05-05, T15):
 *   - `selectedScreenIds.length === 0 && (userComment ?? '').trim().length === 0`
 *     → IdeaPickValidationError throw (UI 측 [기획 부서로 보내기] 버튼 비활성화로 차단)
 *   - 화면 ID 1 개라도 선택했거나 코멘트 ≥ 1 char 면 통과
 */
export interface IdeaFinalizeSelectionInput {
  /** 회의 UUID. */
  meetingId: string;
  /** 선택된 카드의 *화면 ID* list (예: ['ITEM_001', 'ITEM_003']). UUID X. 빈 배열 허용. */
  selectedScreenIds: string[];
  /** 사용자 자유 코멘트 (예: "ITEM_002 는 다음 분기에 다시 검토"). 빈 문자열 / undefined 허용. */
  userComment?: string;
}

/**
 * `stream:idea-pick-snapshot` 의 카드 row — orchestrator 가 awaiting_user_pick
 * phase 진입 시 UI 측에 push. SsmBox idea variant (T18) 가 카드 list 표시.
 *
 * `title` / `content` / `rationale` 은 Opinion row 와 달리 non-null 보장 —
 * gather 단계에서 직원이 schema (Step1OpinionGatherSchema) min(1) 검증 통과
 * 한 데이터만 들어오므로. 본 snapshot 은 UI 가 카드 헤더 / 본문 / 근거 모두
 * 표시하므로 null 은 의미 없음 (gather 성공 = 모두 ≥ 1 char).
 */
export interface IdeaPickCard {
  screenId: string;
  uuid: string;
  title: string;
  content: string;
  rationale: string;
  authorLabel: string;
  authorProviderId: string | null;
}

/**
 * `OpinionService.finalizeIdeaSelection` 결과 — orchestrator 가 awaiting_user_pick
 * phase 안 사용자 commit 후 다음 phase (compose_minutes) 진입 시 활용.
 */
export interface IdeaFinalizeSelectionResult {
  meetingId: string;
  /** status='agreed' 로 갱신된 카드 UUID list (사용자 선택 결과). */
  agreedIds: string[];
  /** status='excluded' 로 갱신된 카드 UUID list (사용자 미선택). exclusionReason='user_not_picked'. */
  excludedIds: string[];
  /** 사용자 자유 코멘트로 insert 된 신규 opinion row (kind='user-raised'). 코멘트 0 자 면 null. */
  userOpinion: Opinion | null;
}

/**
 * `meeting:idea-request-more` IPC 입력 — 사용자가 선택한 아이디어 방향은
 * 유지하면서 직원들에게 추가 아이디어를 더 모으라고 지시한다.
 */
export type IdeaRequestMoreInput = IdeaFinalizeSelectionInput;

/** `OpinionService.requestMoreIdeas` 결과. */
export interface IdeaRequestMoreResult {
  meetingId: string;
  /** status='agreed' 로 유지된 카드 UUID list. */
  selectedIds: string[];
  /** 사용자 추가 수집 지시로 insert 된 신규 opinion row. 코멘트 0 자 면 null. */
  userOpinion: Opinion | null;
}

// ── 일반 채널 가벼운 투표 (T21 land — spec §11.13 general row) ──────────

/**
 * 일반 채널 SsmBox (GeneralVariant) 의 카드 1 건. T20 에서 영속된
 * `kind='self-raised' | 'user-raised'` opinion row 에 light vote 집계
 * (`agreeCount`/`opposeCount`) + 사용자 현재 투표 (`userVote`) 를 덧붙인
 * read-only projection. 회의 X — meetingId NULL row 만 대상.
 *
 * 정렬: `Opinion.createdAt` 오름차순 (등록 순서). 화면에서 최신을 위에
 * 두고 싶으면 renderer 가 reverse 한다 — backend 는 안정 정렬만 보장.
 */
export interface GeneralOpinionCard {
  /** opinion 도메인 row 통째 (kind/title/content/authorLabel 등). */
  opinion: Opinion;
  /** light round 의 'agree' 표 누적 — voter 통합 (사용자 + 직원). */
  agreeCount: number;
  /** light round 의 'oppose' 표 누적. */
  opposeCount: number;
  /**
   * 사용자 (voter_provider_id NULL) 의 현재 light 투표 — `null` = 미투표.
   * 사용자는 카드별 0 또는 1 row 만 유지 (service 가 toggle/replace 로 강제).
   */
  userVote: OpinionVoteValue | null;
}

/**
 * `opinion:listGeneralCards` IPC 결과 — 일반 채널의 카드 N 건 + 카운터
 * 묶음. SsmBox GeneralVariant 가 한 번 호출 후 토글 시마다 refetch.
 */
export interface ListGeneralCardsResult {
  channelId: string;
  cards: GeneralOpinionCard[];
}

/**
 * `opinion:toggleLightVote` IPC 입력 — 사용자가 카드의 동의/반대 버튼
 * 토글. caller 는 같은 vote 재요청 (취소) / 다른 vote (대체) 둘 다
 * 같은 채널로 호출. backend 가 DELETE-or-REPLACE 로 1 row 미만 유지.
 *
 * `vote` semantics:
 *   - `'agree'` / `'oppose'` — 해당 vote 토글 (없으면 INSERT, 있으면 DELETE,
 *     반대 vote 가 있으면 REPLACE)
 *   - `'abstain'` 은 일반 채널 light round 에서 사용 X (UI 미노출).
 *     IPC 측에서 zod 가 `'agree'` / `'oppose'` 만 허용.
 */
export interface ToggleLightVoteInput {
  /** 투표 대상 카드 UUID. opinion.id. meetingId 가 NULL 인 카드만 허용. */
  opinionId: string;
  /** 사용자가 클릭한 버튼 — 'agree' 또는 'oppose'. */
  vote: 'agree' | 'oppose';
}

/**
 * `OpinionService.toggleLightVote` / `opinion:toggleLightVote` 결과.
 *
 * 동작 결과 effect:
 *   - `'inserted'`  사용자가 처음 vote (이전 row 0 건)
 *   - `'removed'`   같은 vote 재클릭 (취소)
 *   - `'replaced'`  반대 vote 가 있어 교체 (이전 DELETE + 신규 INSERT)
 */
export type ToggleLightVoteEffect = 'inserted' | 'removed' | 'replaced';

export interface ToggleLightVoteResult {
  opinionId: string;
  effect: ToggleLightVoteEffect;
  /** 토글 후 사용자 vote — `'removed'` 면 `null`, 나머지는 input.vote 와 동일. */
  userVote: OpinionVoteValue | null;
  /** 토글 후 light round 의 카드 누적 카운터 (agree). */
  agreeCount: number;
  /** 토글 후 light round 의 카드 누적 카운터 (oppose). */
  opposeCount: number;
}
