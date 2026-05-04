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
  Opinion,
  OpinionFreeDiscussionResult,
  OpinionGatherResult,
  OpinionQuickVoteResult,
  OpinionTallyResult,
  OpinionVote,
  Step1OpinionGatherResponse,
  Step25QuickVoteResponse,
  Step3FreeDiscussionResponse,
} from '../../shared/opinion-types';
import type { OpinionRepository } from './opinion-repository';
import { OPINION_DEPTH_CAP, buildScreenIdMap, mapToRecord } from './screen-id';

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
}
