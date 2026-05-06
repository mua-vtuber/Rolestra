/**
 * OpinionService — R12-C2 P2-2 회의 backend 본체.
 *
 * 모든 풀세트 부서 (planning / design.* / review / audit) 가 공유하는
 * 의견 트리 + 투표 service. 옛 12 단계 SSM 합의 모델 폐기 후 새 5 단계
 * + 2.5 모델의 토대.
 *
 * 4 method (spec §11.18.2~§11.18.5):
 *   - {@link gather}              step 1 — 직원 의견 제시 → opinion row N 개
 *   - {@link tally}               step 2 — 시스템 취합 + 화면 ID 부여
 *   - {@link quickVote}           step 2.5 — 일괄 동의 투표 + 만장일치 즉시 agreed
 *   - {@link freeDiscussionRound} step 3 — 자유 토론 round (의견 1 건씩)
 *
 * 부수 헬퍼:
 *   - {@link nextLabelHint}  발화 ID 다음 카운터 추정 (회의 단위 리셋)
 *   - {@link screenToUuid}   화면 ID → UUID 매핑 (caller 가 재호출 시 재사용)
 *
 * 깊이 cap 3 강제 (§5):
 *   `freeDiscussionRound` 의 additions 안 parent_id 가 depth 2 (손자) 의견을
 *   가리키면 service 가 throw — silent fallback X (CLAUDE.md mock/fallback
 *   금지). caller (T10 orchestrator) 가 직원에게 더 깊은 트리 만들지 못하게
 *   prompt 시점부터 알려야 한다.
 *
 * 만장일치 판정:
 *   step 2.5 = 한 의견에 들어온 vote 가 모두 'agree' (≥ 1 voter, oppose/abstain
 *   0) → status='agreed' 즉시 반영 + 자유 토론 skip. step 3 = 같은 규칙으로
 *   round 종결 시 판정. spec 발췌 — "만장일치 (모두 agree) 의견 = agreed".
 *
 * 응답 schema 검증 fallback (§11.18.7):
 *   본 service 는 *이미 zod 검증 통과* 한 payload 를 받는다고 가정한다.
 *   "1 회 재요청 + 2 회 실패 시 skip" 은 caller (T10 orchestrator) 가 provider
 *   호출 단계에서 처리. 본 service 는 schema 부합 안 하는 입력은 throw.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5 D-B 흐름 (의견 트리 + 깊이 cap 3 + 발화 ID 카운터)
 *  - §11.18 직원 응답 JSON schema 4 종
 */

import { randomUUID } from 'node:crypto';
import type {
  GeneralOpinionCard,
  IdeaFinalizeSelectionInput,
  IdeaFinalizeSelectionResult,
  ListGeneralCardsResult,
  Opinion,
  OpinionFreeDiscussionResult,
  OpinionGatherResult,
  OpinionQuickVoteResult,
  OpinionTallyResult,
  OpinionVote,
  OpinionVoteValue,
  PostFromGeneralChannelInput,
  PostFromGeneralChannelResult,
  Step1OpinionGatherResponse,
  Step25QuickVoteResponse,
  Step3FreeDiscussionResponse,
  ToggleLightVoteInput,
  ToggleLightVoteResult,
} from '../../shared/opinion-types';
import type { OpinionRepository } from './opinion-repository';
import { OPINION_DEPTH_CAP, buildScreenIdMap, mapToRecord } from './screen-id';

// ── idea-workflow USER_PICK 상수 (T15 land — spec §5.1) ────────────────

/**
 * 사용자가 카드 0 개 선택 + 자유 코멘트 0 자 입력 시 IPC 측에서 throw 되는
 * exclusionReason 은 *미선택* 만 의미. 사용자가 명시 거부 (rejected) 와
 * 구분 — UI 가 해당 카드 색상 / 회의록 분기 처리에 활용.
 */
export const IDEA_USER_NOT_PICKED_REASON = 'user_not_picked';

/**
 * 사용자 자유 코멘트로 insert 되는 opinion row 의 authorLabel — 회의 단위
 * 카운터 1 회만 발급 (사용자가 한 번만 commit 하므로). 발화 ID 형식은
 * `<author>_<n>` (§11.18.1) — 사용자 = `user`.
 */
export const IDEA_USER_OPINION_AUTHOR_LABEL = 'user_1';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base — caller 가 `e instanceof OpinionError` 로 도메인 분기. */
export class OpinionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpinionError';
  }
}

/**
 * 화면 ID (`ITEM_NNN_*`) 가 현재 회의의 의견 트리에 없을 때. provider 가
 * 잘못된 ID 를 보냈거나 (회의 도중 의견이 사라지는 일은 cascade FK 가
 * 없으므로 정상 흐름에서는 발생 X), 시스템이 매핑 stale 상태에서 호출.
 */
export class UnknownScreenIdError extends OpinionError {
  constructor(meetingId: string, screenId: string) {
    super(
      `OpinionService: screen ID "${screenId}" is unknown in meeting ` +
        `"${meetingId}" — caller must call tally() to refresh ` +
        `screen↔UUID mapping`,
    );
    this.name = 'UnknownScreenIdError';
  }
}

/**
 * `freeDiscussionRound` additions 안 parent 가 cap 도달 의견을 가리킬 때.
 * silent skip 금지 — caller 가 prompt 단계에서 cap 안내해야 한다.
 */
export class OpinionDepthCapError extends OpinionError {
  constructor(parentScreenId: string, parentDepth: number) {
    super(
      `OpinionService: cannot add child to "${parentScreenId}" ` +
        `(depth=${parentDepth}, cap=${OPINION_DEPTH_CAP - 1}) — ` +
        `tree depth limited to ${OPINION_DEPTH_CAP} levels (root + 2 descendants)`,
    );
    this.name = 'OpinionDepthCapError';
  }
}

/** 필수 의견이 누락 (caller 의 잘못된 meetingId / opinionId). */
export class OpinionNotFoundError extends OpinionError {
  constructor(opinionId: string) {
    super(`OpinionService: opinion not found: ${opinionId}`);
    this.name = 'OpinionNotFoundError';
  }
}

/**
 * idea-workflow USER_PICK commit 시 0 카드 + 0 코멘트 입력은 거부 (T15,
 * 사용자 결정 2026-05-05). UI 측에서 [기획 부서로 보내기] 버튼이 비활성화
 * 되지만 IPC 호출이 직접 들어와도 backend 에서 추가 차단.
 */
export class IdeaPickValidationError extends OpinionError {
  constructor(meetingId: string) {
    super(
      `OpinionService.finalizeIdeaSelection: meeting "${meetingId}" — ` +
        `must pick at least 1 card or write a non-empty user comment ` +
        `(0 picks + 0 comment is rejected — UI must keep the handoff ` +
        `button disabled in this state)`,
    );
    this.name = 'IdeaPickValidationError';
  }
}

/**
 * `postFromGeneralChannel` 입력 검증 실패 (T20). caller 가 파싱 결과 0 건
 * 또는 빈 content 로 호출 시 throw — silent fallback 금지 (사용자 입력
 * 흐름이 명백히 잘못된 상태이므로 에러로 surface 해 디버깅 가능하게).
 */
export class PostFromGeneralValidationError extends OpinionError {
  constructor(reason: string) {
    super(`OpinionService.postFromGeneralChannel: ${reason}`);
    this.name = 'PostFromGeneralValidationError';
  }
}

/**
 * `toggleLightVote` 호출 대상이 light vote 적용 불가능한 카드일 때 throw
 * (T21). 일반 채널 카드 (kind='self-raised'/'user-raised', meeting_id NULL)
 * 만 light vote 허용. caller (UI) 가 회의 중 카드를 light vote 토글 시
 * 즉시 surface — silent fallback 금지.
 */
export class LightVoteTargetError extends OpinionError {
  constructor(opinionId: string, reason: string) {
    super(
      `OpinionService.toggleLightVote: opinion "${opinionId}" — ${reason}`,
    );
    this.name = 'LightVoteTargetError';
  }
}

// ── Input shapes ───────────────────────────────────────────────────────

/**
 * gather 입력 — 한 round 의 모든 직원 응답. providerId 는 system 이 알고
 * 있는 author 의 진짜 ID (response.name 은 표시용 — 검증은 caller 책임).
 */
export interface GatherInput {
  meetingId: string;
  channelId: string;
  /** 회의 안 라운드 인덱스 (0 = step 1, 이후 step 3 round 마다 증가). */
  round: number;
  responses: Array<{
    providerId: string;
    payload: Step1OpinionGatherResponse;
  }>;
}

export interface QuickVoteInput {
  meetingId: string;
  round: number;
  responses: Array<{
    providerId: string;
    payload: Step25QuickVoteResponse;
  }>;
}

export interface FreeDiscussionInput {
  meetingId: string;
  /** 이번 round 자유 토론 대상 의견 UUID. */
  opinionId: string;
  round: number;
  responses: Array<{
    providerId: string;
    payload: Step3FreeDiscussionResponse;
  }>;
}

// ── Service ────────────────────────────────────────────────────────────

export class OpinionService {
  constructor(private readonly repo: OpinionRepository) {}

  /**
   * step 1 — 직원 의견 제시. 각 응답의 opinions 배열을 그대로 opinion row
   * (kind='root', parentId=null, status='pending') 로 insert.
   *
   * 빈 opinions 배열 (직원이 의견 0 건 제출) 은 허용 — 0 row insert.
   * caller (orchestrator) 가 모든 직원 응답을 모아 한 번에 호출.
   */
  gather(input: GatherInput): OpinionGatherResult {
    const inserted: Opinion[] = [];
    const baseNow = Date.now();
    let ordinal = 0;

    // 응답 순서 = 화면 ID 부여 순서. created_at 동률 시 UUID tiebreaker 가
    // 응답 순서와 일치한다는 보장이 없으므로 ordinal 만큼 created_at 을
    // 증가시켜 순서를 강제한다 (ms 단위 — 동일 gather 안 충돌 X).
    for (const response of input.responses) {
      const { providerId, payload } = response;
      for (const item of payload.opinions) {
        const ts = baseNow + ordinal;
        ordinal += 1;
        const opinion: Opinion = {
          id: randomUUID(),
          parentId: null,
          meetingId: input.meetingId,
          channelId: input.channelId,
          kind: 'root',
          authorProviderId: providerId,
          authorLabel: payload.label,
          title: item.title,
          content: item.content,
          rationale: item.rationale,
          status: 'pending',
          exclusionReason: null,
          round: input.round,
          createdAt: ts,
          updatedAt: ts,
        };
        this.repo.insert(opinion);
        inserted.push(opinion);
      }
    }

    return { meetingId: input.meetingId, inserted };
  }

  /**
   * step 2 — 시스템 취합. DB 에서 의견 통째 읽어 화면 ID 부여 + 트리 빌드.
   * 순수 projection — DB 쓰기 없음. 호출 시점마다 같은 입력으로 같은
   * 화면 ID 가 나온다 (created_at + UUID tiebreaker 안정 정렬).
   */
  tally(meetingId: string): OpinionTallyResult {
    const opinions = this.repo.listByMeeting(meetingId);
    const map = buildScreenIdMap(opinions);
    return {
      meetingId,
      rootCount: map.tree.length,
      totalCount: opinions.length,
      tree: map.tree,
      screenToUuid: mapToRecord(map.screenToUuid),
      uuidToScreen: mapToRecord(map.uuidToScreen),
    };
  }

  /**
   * step 2.5 — 일괄 동의 투표. 모든 직원 응답을 받아 opinion_vote row
   * 생성 (`roundKind='quick_vote'`) + 의견별 만장일치 판정.
   *
   * 만장일치 = 해당 의견에 들어온 vote 가 모두 'agree' (≥ 1 voter). 만장일치
   * 의견은 status='agreed' 즉시 갱신 + agreed[] 에 UUID 포함. 그 외 의견
   * (oppose/abstain ≥ 1 또는 vote 0) 은 status='pending' 유지 + unresolved[]
   * 에 UUID 포함 — caller 가 step 3 진입 시 사용.
   *
   * `unresolved` 는 *이번 round 에 한 표라도 들어온* 의견 + *root 의견 중
   * 한 표도 못 받은 의견* 모두 포함 — orchestrator 가 step 3 진입 시 root
   * 모두 순회하므로. 즉 root 의견은 모두 agreed[] 또는 unresolved[] 둘 중
   * 한 곳에만.
   */
  quickVote(input: QuickVoteInput): OpinionQuickVoteResult {
    const opinions = this.repo.listByMeeting(input.meetingId);
    const map = buildScreenIdMap(opinions);

    // root 의견만 quick_vote 대상 (자유 토론 자식은 step 3 에서 생성).
    const rootIds = opinions.filter((o) => o.parentId === null).map((o) => o.id);

    // 의견별 vote 누적 (이번 round 만 — 이전 quick_vote round 는 분리 카운트).
    const votesByOpinion = new Map<string, OpinionVote['vote'][]>();
    let votesInserted = 0;
    const now = Date.now();

    for (const response of input.responses) {
      const { providerId, payload } = response;
      for (const v of payload.quick_votes) {
        const uuid = map.screenToUuid.get(v.target_id);
        if (!uuid) {
          throw new UnknownScreenIdError(input.meetingId, v.target_id);
        }
        const vote: OpinionVote = {
          id: randomUUID(),
          targetId: uuid,
          voterProviderId: providerId,
          vote: v.vote,
          comment: v.comment ?? null,
          round: input.round,
          roundKind: 'quick_vote',
          createdAt: now,
        };
        this.repo.insertVote(vote);
        votesInserted += 1;

        const arr = votesByOpinion.get(uuid);
        if (arr) arr.push(v.vote);
        else votesByOpinion.set(uuid, [v.vote]);
      }
    }

    const agreed: string[] = [];
    const unresolved: string[] = [];

    for (const id of rootIds) {
      const votes = votesByOpinion.get(id) ?? [];
      if (votes.length > 0 && votes.every((vv) => vv === 'agree')) {
        const ok = this.repo.updateStatus(id, 'agreed', null, now);
        if (!ok) throw new OpinionNotFoundError(id);
        agreed.push(id);
      } else {
        unresolved.push(id);
      }
    }

    return {
      meetingId: input.meetingId,
      agreed,
      unresolved,
      votesInserted,
    };
  }

  /**
   * step 3 — 자유 토론 round (의견 1 건씩). 직원 응답에서 votes / additions
   * 동시 처리. 깊이 cap 3 강제 — additions.parent_id 가 depth 2 (손자) 를
   * 가리키면 throw.
   *
   * round 종결 시 `opinionId` 에 들어온 *이번 round* 의 vote 가 모두 'agree'
   * (≥ 1 voter, oppose/abstain 0) 면 status='agreed' 갱신 + agreed=true.
   * 자식이 있어도 부모 단독 만장일치만 본다 — 자식은 다음 round 의 별도
   * 토론 대상이 된다.
   */
  freeDiscussionRound(
    input: FreeDiscussionInput,
  ): OpinionFreeDiscussionResult {
    const target = this.repo.get(input.opinionId);
    if (!target || target.meetingId !== input.meetingId) {
      throw new OpinionNotFoundError(input.opinionId);
    }

    const opinions = this.repo.listByMeeting(input.meetingId);
    const map = buildScreenIdMap(opinions);

    const additions: Opinion[] = [];
    const votesThisRound: OpinionVote['vote'][] = [];
    let votesInserted = 0;
    const baseNow = Date.now();
    let ordinal = 0;

    for (const response of input.responses) {
      const { providerId, payload } = response;

      // (a) votes — opinion_vote row insert (roundKind='free_discussion').
      for (const v of payload.votes) {
        const uuid = map.screenToUuid.get(v.target_id);
        if (!uuid) {
          throw new UnknownScreenIdError(input.meetingId, v.target_id);
        }
        const ts = baseNow + ordinal;
        ordinal += 1;
        const vote: OpinionVote = {
          id: randomUUID(),
          targetId: uuid,
          voterProviderId: providerId,
          vote: v.vote,
          comment: v.comment ?? null,
          round: input.round,
          roundKind: 'free_discussion',
          createdAt: ts,
        };
        this.repo.insertVote(vote);
        votesInserted += 1;
        if (uuid === input.opinionId) votesThisRound.push(v.vote);
      }

      // (b) additions — 자식 opinion row insert. 깊이 cap 3 강제.
      for (const add of payload.additions) {
        const parentUuid = map.screenToUuid.get(add.parent_id);
        if (!parentUuid) {
          throw new UnknownScreenIdError(input.meetingId, add.parent_id);
        }
        const parentDepth = map.uuidToDepth.get(parentUuid);
        if (parentDepth === undefined) {
          throw new UnknownScreenIdError(input.meetingId, add.parent_id);
        }
        // depth 0 = root, 1 = 자식, 2 = 손자. 손자에 자식 추가 = cap 위반.
        if (parentDepth >= OPINION_DEPTH_CAP - 1) {
          throw new OpinionDepthCapError(add.parent_id, parentDepth);
        }
        const ts = baseNow + ordinal;
        ordinal += 1;
        const child: Opinion = {
          id: randomUUID(),
          parentId: parentUuid,
          meetingId: input.meetingId,
          channelId: target.channelId,
          kind: add.kind,
          authorProviderId: providerId,
          authorLabel: payload.label,
          title: add.title,
          content: add.content,
          rationale: add.rationale,
          status: 'pending',
          exclusionReason: null,
          round: input.round,
          createdAt: ts,
          updatedAt: ts,
        };
        this.repo.insert(child);
        additions.push(child);
      }
    }

    // round 종결 — opinionId 단독 만장일치 판정.
    const agreed =
      votesThisRound.length > 0 &&
      votesThisRound.every((vv) => vv === 'agree');
    if (agreed) {
      const ok = this.repo.updateStatus(
        input.opinionId,
        'agreed',
        null,
        baseNow + ordinal,
      );
      if (!ok) throw new OpinionNotFoundError(input.opinionId);
    }

    return {
      meetingId: input.meetingId,
      opinionId: input.opinionId,
      agreed,
      additions,
      votesInserted,
    };
  }

  // ── idea-workflow USER_PICK (T15 land — spec §5.1) ─────────────────

  /**
   * 사용자가 awaiting_user_pick phase 안 카드 선택 + 자유 코멘트 commit 시
   * 호출. 4 작업을 단일 단계로 처리:
   *
   *   1. 화면 ID list → UUID 매핑 (UnknownScreenIdError on miss)
   *   2. 선택된 카드 → status='agreed' (이미 root 만 awaiting_user_pick 대상)
   *   3. 미선택 root 카드 → status='excluded' + exclusionReason='user_not_picked'
   *   4. 자유 코멘트 ≥ 1 char → 새 opinion (kind='user-raised',
   *      authorProviderId=null, authorLabel='user_1', status='agreed') insert
   *
   * 0 pick + 0 comment 입력 시 IdeaPickValidationError throw — UI 측
   * [기획 부서로 보내기] 버튼 비활성화 invariant 정합 (사용자 결정
   * 2026-05-05).
   *
   * caller (orchestrator idea-workflow helper) 가 본 호출 후 다음 phase
   * (compose_minutes) 진입. 본 service 는 phase 전환 X / DB 영속만 책임.
   *
   * 깊이 cap / parent_id 검사는 root 카드 (parent_id=null) 만 대상이라
   * 적용 X — 사용자 코멘트 opinion 도 root 로 insert.
   */
  finalizeIdeaSelection(
    input: IdeaFinalizeSelectionInput,
  ): IdeaFinalizeSelectionResult {
    const { meetingId, selectedScreenIds, userComment } = input;
    const trimmedComment = (userComment ?? '').trim();
    if (selectedScreenIds.length === 0 && trimmedComment.length === 0) {
      throw new IdeaPickValidationError(meetingId);
    }

    const opinions = this.repo.listByMeeting(meetingId);
    const map = buildScreenIdMap(opinions);

    // 화면 ID → UUID 매핑 검증 (alien ID 가 들어오면 즉시 throw — silent
    // skip 금지).
    const selectedUuids: string[] = [];
    for (const screenId of selectedScreenIds) {
      const uuid = map.screenToUuid.get(screenId);
      if (!uuid) {
        throw new UnknownScreenIdError(meetingId, screenId);
      }
      selectedUuids.push(uuid);
    }

    const selectedSet = new Set(selectedUuids);
    const rootIds = opinions
      .filter((o) => o.parentId === null)
      .map((o) => o.id);

    const baseNow = Date.now();
    let ordinal = 0;

    // 선택된 root → status='agreed'.
    const agreedIds: string[] = [];
    for (const uuid of selectedUuids) {
      const ts = baseNow + ordinal;
      ordinal += 1;
      const ok = this.repo.updateStatus(uuid, 'agreed', null, ts);
      if (!ok) throw new OpinionNotFoundError(uuid);
      agreedIds.push(uuid);
    }

    // 미선택 root → status='excluded' + exclusionReason.
    const excludedIds: string[] = [];
    for (const id of rootIds) {
      if (selectedSet.has(id)) continue;
      const ts = baseNow + ordinal;
      ordinal += 1;
      const ok = this.repo.updateStatus(
        id,
        'excluded',
        IDEA_USER_NOT_PICKED_REASON,
        ts,
      );
      if (!ok) throw new OpinionNotFoundError(id);
      excludedIds.push(id);
    }

    // 자유 코멘트 ≥ 1 char → user-raised opinion insert.
    let userOpinion: Opinion | null = null;
    if (trimmedComment.length > 0) {
      // channelId 추정 — 모든 opinion 이 같은 회의에 속하므로 첫 row 의
      // channel_id 사용. 빈 회의 (의견 0 건 + 코멘트만 1 건) 에서는 caller
      // 가 channelId 를 IPC 입력에 추가해야 하지만, awaiting_user_pick 진입
      // 자체가 gather 후라 의견 ≥ 0 보장. 0 인 케이스는 향후 IPC schema
      // 측에서 channelId 추가하는 선택지 — 본 sub-task 는 회의에 root 의견
      // 1 건 이상 보장 가정.
      const channelId =
        opinions.length > 0
          ? opinions[0]!.channelId
          : null;
      if (channelId === null) {
        throw new OpinionError(
          `OpinionService.finalizeIdeaSelection: meeting "${meetingId}" ` +
            `has 0 opinion rows — cannot derive channelId for user comment. ` +
            `idea-workflow must run gather phase before awaiting_user_pick.`,
        );
      }
      const ts = baseNow + ordinal;
      ordinal += 1;
      userOpinion = {
        id: randomUUID(),
        parentId: null,
        meetingId,
        channelId,
        kind: 'user-raised',
        authorProviderId: null,
        authorLabel: IDEA_USER_OPINION_AUTHOR_LABEL,
        title: this.deriveUserCommentTitle(trimmedComment),
        content: trimmedComment,
        rationale: '',
        status: 'agreed',
        exclusionReason: null,
        round: 0,
        createdAt: ts,
        updatedAt: ts,
      };
      this.repo.insert(userOpinion);
    }

    return { meetingId, agreedIds, excludedIds, userOpinion };
  }

  /**
   * 사용자 자유 코멘트 본문에서 제목 derive — 첫 줄 또는 80 자 cut. 사용자가
   * 별도 제목 입력 안 하므로 카드 헤더용으로 자동 생성.
   */
  private deriveUserCommentTitle(comment: string): string {
    const firstLine = comment.split(/\r?\n/, 1)[0] ?? comment;
    if (firstLine.length <= 80) return firstLine;
    return firstLine.slice(0, 77) + '...';
  }

  // ── 일반 채널 [##본문] 카드 (T20 land — spec §4 일반 부서 새 정의) ──

  /**
   * 일반 채널 (잡담 정체성) 안 의견 카드 1+ 건 등록.
   *
   * 두 호출자가 같은 method 공유:
   *   1. general-channel-opinion-flow — 메시지 안 [##본문] segment 자동 파싱
   *   2. PostOpinionModal IPC — 사용자가 별 entry 모달로 직접 등록
   *
   * 동작:
   *   - parts.length === 0 → PostFromGeneralValidationError (caller 책임)
   *   - 빈 content / whitespace-only content → PostFromGeneralValidationError
   *   - kind = authorProviderId === null ? 'user-raised' : 'self-raised'
   *   - meetingId=null, parentId=null, status='pending', round=0
   *   - authorLabel = `${author}_${n}` (n = 채널 안 같은 author 의 기존 카드
   *     수 + 1, batch 안 incremental)
   *   - title null → service 가 content 첫 줄 / 80 자 cut 으로 derive
   *
   * 회의 X — 합의 / 회의록 / 인계 surface 모두 일으키지 않는다 (잡담
   * 정체성 유지). orchestrator 진입 X.
   */
  postFromGeneralChannel(
    input: PostFromGeneralChannelInput,
  ): PostFromGeneralChannelResult {
    if (input.parts.length === 0) {
      throw new PostFromGeneralValidationError(
        `channelId "${input.channelId}" — parts is empty (caller must skip ` +
          `when [##] parser yields 0 matches and modal must guard against ` +
          `empty submissions)`,
      );
    }

    // 빈 content fast-fail — 모달 / 파서 어느 caller 도 빈 content 를
    // 보내선 안 됨 (파서는 trim 후 빈 본문 자체를 skip, 모달은 disabled
    // 처리). 들어오면 silent fallback 금지 — 즉시 throw.
    for (const [i, part] of input.parts.entries()) {
      if (part.content.trim().length === 0) {
        throw new PostFromGeneralValidationError(
          `channelId "${input.channelId}" parts[${i}] — content is empty ` +
            `or whitespace-only`,
        );
      }
    }

    const kind: Opinion['kind'] =
      input.authorProviderId === null ? 'user-raised' : 'self-raised';
    const authorIdentifier = input.authorProviderId ?? 'user';

    // 같은 채널 + 같은 author 의 기존 카드 수 → label 카운터 base.
    // listByChannel 은 회의 카드 + 일반 카드 통합 — 회의 안 카드도 같은
    // authorProviderId 이면 카운터에 포함된다. label 은 진실원천이 아니라
    // 표시용 식별자 (user_1 / codex_3 등) 라 회의 카드와 구분 X 가 의도
    // 동작.
    const existing = this.repo.listByChannel(input.channelId);
    const baseCount = existing.filter((o) => {
      if (kind === 'user-raised') return o.authorProviderId === null;
      return o.authorProviderId === input.authorProviderId;
    }).length;

    const inserted: Opinion[] = [];
    const baseNow = Date.now();

    for (let i = 0; i < input.parts.length; i += 1) {
      const part = input.parts[i]!;
      const content = part.content.trim();
      const title =
        part.title !== null
          ? part.title.trim()
          : this.deriveUserCommentTitle(content);
      const ts = baseNow + i;
      const opinion: Opinion = {
        id: randomUUID(),
        parentId: null,
        meetingId: null,
        channelId: input.channelId,
        kind,
        authorProviderId: input.authorProviderId,
        authorLabel: `${authorIdentifier}_${baseCount + i + 1}`,
        title,
        content,
        rationale: null,
        status: 'pending',
        exclusionReason: null,
        round: 0,
        createdAt: ts,
        updatedAt: ts,
      };
      this.repo.insert(opinion);
      inserted.push(opinion);
    }

    return { channelId: input.channelId, inserted };
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────

  /**
   * 회의 안 다음 발화 ID 카운터 추정 — orchestrator 의 in-memory 카운터가
   * 진실원천이지만, 회의 재시작 / DB 직접 조회 시 best-effort fallback 으로
   * 사용. opinion 테이블 안 distinct authorLabel 개수 + 1.
   *
   * vote-only 라운드 (step 2.5) 는 opinion 을 insert 하지 않으므로 본
   * 헬퍼만으로는 정확한 카운터를 복원할 수 없다 — orchestrator 가 in-memory
   * 카운터를 유지해야 한다.
   */
  nextLabelHint(meetingId: string, providerId: string): number {
    return this.repo.countDistinctLabelsByAuthor(meetingId, providerId) + 1;
  }

  /** tally 결과의 screenToUuid 만 별도로 조회 — caller 의 round 진입 헬퍼. */
  screenToUuid(meetingId: string): Record<string, string> {
    const opinions = this.repo.listByMeeting(meetingId);
    const map = buildScreenIdMap(opinions);
    return mapToRecord(map.screenToUuid);
  }

  // ── 일반 채널 가벼운 투표 (T21 land — spec §11.13 general row) ─────

  /**
   * 일반 채널의 카드 list + light vote 카운터 + 사용자 현재 투표 묶음.
   * SsmBox GeneralVariant (T21) 의 단일 read source.
   *
   * 필터:
   *   - 채널 안 모든 opinion row 중 kind ∈ {'self-raised', 'user-raised'}
   *     만 (root/revise/block/addition 회의 카드는 제외 — 일반 채널은 회의
   *     X 라 정상 흐름에서는 들어오지 않지만 방어적 필터)
   *   - 카드 정렬 = createdAt 오름차순 (등록 순서). renderer 가 reverse
   *     원하면 거기서 처리 — backend 는 안정 정렬만 보장.
   *
   * 카운터 산정:
   *   - light round 의 모든 voter (사용자 NULL + 직원) 통합 — UI 가 "직원
   *     + 사용자 모두 합산" 표시
   *   - `userVote` = voter_provider_id IS NULL 의 vote (없으면 null)
   *   - 'abstain' light vote 는 현재 IPC 에서 차단되지만, 미래 확장 대비
   *     카운터에는 포함 X (agree/oppose 만 누적)
   */
  listGeneralCards(channelId: string): ListGeneralCardsResult {
    const opinions = this.repo
      .listByChannel(channelId)
      .filter(
        (o) => o.kind === 'self-raised' || o.kind === 'user-raised',
      );

    const lightVotes = this.repo.listLightVotesByChannel(channelId);

    // 카드별 카운터 + 사용자 vote 집계.
    const aggregateByOpinion = new Map<
      string,
      { agree: number; oppose: number; userVote: OpinionVoteValue | null }
    >();
    for (const o of opinions) {
      aggregateByOpinion.set(o.id, { agree: 0, oppose: 0, userVote: null });
    }
    for (const v of lightVotes) {
      const agg = aggregateByOpinion.get(v.targetId);
      if (!agg) continue; // join 의 race — 정상 흐름에서는 발생 X
      if (v.vote === 'agree') agg.agree += 1;
      else if (v.vote === 'oppose') agg.oppose += 1;
      // abstain 은 카운터 미반영 (UI 미노출)
      if (v.voterProviderId === null) {
        agg.userVote = v.vote;
      }
    }

    const cards: GeneralOpinionCard[] = opinions.map((o) => {
      const agg = aggregateByOpinion.get(o.id)!;
      return {
        opinion: o,
        agreeCount: agg.agree,
        opposeCount: agg.oppose,
        userVote: agg.userVote,
      };
    });

    return { channelId, cards };
  }

  /**
   * 사용자 light vote 토글. 같은 vote 재요청 = DELETE (취소), 반대 vote =
   * REPLACE (이전 row DELETE + 신규 INSERT). 사용자 voter 1 인 가정 —
   * 카드별 voter_provider_id IS NULL 의 light vote row 가 0 또는 1 건만
   * 존재한다는 invariant 를 service 가 강제.
   *
   * 호출 시점:
   *   - SsmBox GeneralVariant 의 동의/반대 버튼 클릭 (T21)
   *
   * 차단:
   *   - opinion 이 존재하지 않으면 OpinionNotFoundError
   *   - opinion.kind 가 'self-raised'/'user-raised' 가 아니면 LightVoteTargetError
   *     (회의 카드에는 light vote 차단 — meeting_id 가 NULL 이 아니어도 동일)
   *   - opinion.meetingId 가 NULL 이 아니면 LightVoteTargetError (이중 방어)
   *
   * 후속 카운터 = repository 의 light vote 집계 1 회 더 호출 (1 카드 query 라
   * 비용 무시 가능) — caller 가 별도 list refetch 안 해도 새 상태 알 수 있게.
   */
  toggleLightVote(input: ToggleLightVoteInput): ToggleLightVoteResult {
    const target = this.repo.get(input.opinionId);
    if (!target) {
      throw new OpinionNotFoundError(input.opinionId);
    }
    if (target.kind !== 'self-raised' && target.kind !== 'user-raised') {
      throw new LightVoteTargetError(
        input.opinionId,
        `kind='${target.kind}' is not eligible for light vote ` +
          `(only 'self-raised' / 'user-raised' allowed)`,
      );
    }
    if (target.meetingId !== null) {
      throw new LightVoteTargetError(
        input.opinionId,
        `meetingId='${target.meetingId}' — light vote is restricted to ` +
          `general channel cards (meetingId NULL)`,
      );
    }

    const existing = this.repo.findUserLightVote(input.opinionId);

    let effect: ToggleLightVoteResult['effect'];
    let userVote: OpinionVoteValue | null;
    const now = Date.now();

    if (existing === null) {
      // 처음 vote — INSERT.
      const inserted: OpinionVote = {
        id: randomUUID(),
        targetId: input.opinionId,
        voterProviderId: null,
        vote: input.vote,
        comment: null,
        round: 0,
        roundKind: 'light',
        createdAt: now,
      };
      this.repo.insertVote(inserted);
      effect = 'inserted';
      userVote = input.vote;
    } else if (existing.vote === input.vote) {
      // 같은 vote 재클릭 — DELETE (취소).
      const ok = this.repo.deleteVote(existing.id);
      if (!ok) throw new OpinionNotFoundError(existing.id);
      effect = 'removed';
      userVote = null;
    } else {
      // 반대 vote — REPLACE (DELETE 후 INSERT, 마이크로 ts 분리해 정렬 안정).
      const ok = this.repo.deleteVote(existing.id);
      if (!ok) throw new OpinionNotFoundError(existing.id);
      const replaced: OpinionVote = {
        id: randomUUID(),
        targetId: input.opinionId,
        voterProviderId: null,
        vote: input.vote,
        comment: null,
        round: 0,
        roundKind: 'light',
        createdAt: now,
      };
      this.repo.insertVote(replaced);
      effect = 'replaced';
      userVote = input.vote;
    }

    // 후속 카운터 — 영속 후 채널 단위 집계 재계산보다 1 카드 query 가 싸다.
    const allVotes = this.repo.listLightVotesByChannel(target.channelId);
    let agreeCount = 0;
    let opposeCount = 0;
    for (const v of allVotes) {
      if (v.targetId !== input.opinionId) continue;
      if (v.vote === 'agree') agreeCount += 1;
      else if (v.vote === 'oppose') opposeCount += 1;
    }

    return {
      opinionId: input.opinionId,
      effect,
      userVote,
      agreeCount,
      opposeCount,
    };
  }
}
