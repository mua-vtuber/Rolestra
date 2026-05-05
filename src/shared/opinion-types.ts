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
 */
export type OpinionRoundKind = 'quick_vote' | 'free_discussion';

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
