/**
 * OpinionService — 일반 채널 [##] 카드 + light vote backend (R12-C2 P4
 * T20/T21).
 *
 * D1 (2026-09-28): 이 파일은 원래 "5 단계 회의" 모델(gather/tally/
 * quickVote/freeDiscussionRound/finalizeIdeaSelection/requestMoreIdeas)
 * 의 토대였다. chat-first pivot 이후 그 5 단계를 여는 IPC 채널이 하나도
 * 없어 (router.ts / ipc-types.ts 확인 — 호출부 0 건) 전부 제거했다.
 * 살아있는 3 method 만 남는다:
 *
 *   - {@link postFromGeneralChannel} — 메시지 안 [##본문] → 카드 등록
 *   - {@link listGeneralCards}       — 채널의 카드 목록 + light vote 집계
 *   - {@link toggleLightVote}        — 사용자 light vote 토글
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4 일반 부서 새 정의 ([##] 카드)
 *  - §11.13 general row (light vote)
 */

import { randomUUID } from 'node:crypto';
import type {
  GeneralOpinionCard,
  ListGeneralCardsResult,
  Opinion,
  OpinionVote,
  OpinionVoteValue,
  PostFromGeneralChannelInput,
  PostFromGeneralChannelResult,
  ToggleLightVoteInput,
  ToggleLightVoteResult,
} from '../../shared/opinion-types';
import type { OpinionRepository } from './opinion-repository';

// ── Error hierarchy ────────────────────────────────────────────────────

/** Base — caller 가 `e instanceof OpinionError` 로 도메인 분기. */
export class OpinionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpinionError';
  }
}

/** 필수 의견이 누락 (caller 의 잘못된 opinionId). */
export class OpinionNotFoundError extends OpinionError {
  constructor(opinionId: string) {
    super(`OpinionService: opinion not found: ${opinionId}`);
    this.name = 'OpinionNotFoundError';
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

// ── Service ────────────────────────────────────────────────────────────

export class OpinionService {
  constructor(
    private readonly repo: OpinionRepository,
    private readonly assertChatCardChannel: (channelId: string, write: boolean) => void = () => undefined,
  ) {}

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
    this.assertChatCardChannel(input.channelId, true);
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

    for (const [i, part] of input.parts.entries()) {
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
    this.assertChatCardChannel(channelId, false);
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
      const agg =
        aggregateByOpinion.get(o.id) ?? { agree: 0, oppose: 0, userVote: null };
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
    this.assertChatCardChannel(target.channelId, true);
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
