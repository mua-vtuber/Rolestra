/**
 * OpinionRepository — opinion + opinion_vote 두 테이블에 대한 thin
 * data-access layer (R12-C2 P2-2).
 *
 * 책임:
 *   - SQL snake_case 컬럼 ↔ shared camelCase {@link Opinion} / {@link OpinionVote}
 *     매핑.
 *   - 비즈니스 규칙은 0 — caller (OpinionService) 가 깊이 cap 3 / 만장일치
 *     판정 / 화면 ID 부여를 책임진다.
 *
 * Active opinion / vote 의 의미상 unique constraint 는 없다 — 같은 voter 가
 * 같은 target 에 여러 round 투표 가능 (free_discussion 라운드별 별도 row).
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5  데이터 모델 (opinion + opinion_vote)
 *  - migration 019-opinion-tables.ts (FK 정책 / CHECK 제약)
 */

import type Database from 'better-sqlite3';
import type {
  Opinion,
  OpinionRoundKind,
  OpinionStatus,
  OpinionVote,
} from '../../shared/opinion-types';

interface OpinionRow {
  id: string;
  parent_id: string | null;
  meeting_id: string | null;
  channel_id: string;
  kind: Opinion['kind'];
  author_provider_id: string | null;
  author_label: string;
  title: string | null;
  content: string | null;
  rationale: string | null;
  status: OpinionStatus;
  exclusion_reason: string | null;
  round: number;
  created_at: number;
  updated_at: number;
}

interface OpinionVoteRow {
  id: string;
  target_id: string;
  voter_provider_id: string | null;
  vote: OpinionVote['vote'];
  comment: string | null;
  round: number;
  round_kind: OpinionRoundKind;
  created_at: number;
}

function rowToOpinion(row: OpinionRow): Opinion {
  return {
    id: row.id,
    parentId: row.parent_id,
    meetingId: row.meeting_id,
    channelId: row.channel_id,
    kind: row.kind,
    authorProviderId: row.author_provider_id,
    authorLabel: row.author_label,
    title: row.title,
    content: row.content,
    rationale: row.rationale,
    status: row.status,
    exclusionReason: row.exclusion_reason,
    round: row.round,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToVote(row: OpinionVoteRow): OpinionVote {
  return {
    id: row.id,
    targetId: row.target_id,
    voterProviderId: row.voter_provider_id,
    vote: row.vote,
    comment: row.comment,
    round: row.round,
    roundKind: row.round_kind,
    createdAt: row.created_at,
  };
}

export class OpinionRepository {
  constructor(private readonly db: Database.Database) {}

  // ── opinion CRUD ─────────────────────────────────────────────────

  /**
   * 새 의견 row insert. caller 는 `id` (UUID) / `createdAt` / `updatedAt`
   * (= now) 모두 채워서 넘겨야 한다.
   *
   * SqliteError (FK / CHECK 위반) 는 그대로 throw — service 가 도메인
   * 에러로 변환할지 결정한다.
   */
  insert(opinion: Opinion): void {
    this.db
      .prepare(
        `INSERT INTO opinion (
           id, parent_id, meeting_id, channel_id, kind,
           author_provider_id, author_label,
           title, content, rationale,
           status, exclusion_reason, round,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opinion.id,
        opinion.parentId,
        opinion.meetingId,
        opinion.channelId,
        opinion.kind,
        opinion.authorProviderId,
        opinion.authorLabel,
        opinion.title,
        opinion.content,
        opinion.rationale,
        opinion.status,
        opinion.exclusionReason,
        opinion.round,
        opinion.createdAt,
        opinion.updatedAt,
      );
  }

  /** id 로 의견 1 건 조회. 없으면 null. */
  get(id: string): Opinion | null {
    const row = this.db
      .prepare(
        `SELECT id, parent_id, meeting_id, channel_id, kind,
                author_provider_id, author_label,
                title, content, rationale,
                status, exclusion_reason, round,
                created_at, updated_at
         FROM opinion WHERE id = ?`,
      )
      .get(id) as OpinionRow | undefined;
    return row ? rowToOpinion(row) : null;
  }

  /**
   * meetingId 의 모든 의견 — created_at 오름차순. 화면 ID 부여
   * 알고리즘 (depth-first parent chain) 의 입력.
   */
  listByMeeting(meetingId: string): Opinion[] {
    const rows = this.db
      .prepare(
        `SELECT id, parent_id, meeting_id, channel_id, kind,
                author_provider_id, author_label,
                title, content, rationale,
                status, exclusion_reason, round,
                created_at, updated_at
         FROM opinion
         WHERE meeting_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(meetingId) as OpinionRow[];
    return rows.map(rowToOpinion);
  }

  /**
   * channelId 의 모든 의견 — created_at 오름차순. 일반 채널 [##]
   * 카드 list 표시용 (meetingId NULL 포함).
   */
  listByChannel(channelId: string): Opinion[] {
    const rows = this.db
      .prepare(
        `SELECT id, parent_id, meeting_id, channel_id, kind,
                author_provider_id, author_label,
                title, content, rationale,
                status, exclusion_reason, round,
                created_at, updated_at
         FROM opinion
         WHERE channel_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(channelId) as OpinionRow[];
    return rows.map(rowToOpinion);
  }

  /**
   * status 갱신 — exclusionReason 은 status='rejected'/'excluded' 시점에만
   * 의미가 있다. 갱신된 row 가 있으면 true (없으면 false — 알 수 없는 id).
   * updated_at 도 함께 갱신.
   */
  updateStatus(
    id: string,
    status: OpinionStatus,
    exclusionReason: string | null,
    updatedAt: number,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE opinion
         SET status = ?, exclusion_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, exclusionReason, updatedAt, id);
    return result.changes > 0;
  }

  /**
   * 회의 안 특정 author 의 distinct authorLabel 개수 — service 의
   * `nextLabelN` 헬퍼 입력. opinion 테이블만 집계 (opinion_vote 는
   * label 컬럼 없음 — orchestrator 의 in-memory 카운터가 진실원천이고
   * 이 헬퍼는 회의 재시작 / DB 직접 조회 시 best-effort 추정).
   */
  countDistinctLabelsByAuthor(
    meetingId: string,
    authorProviderId: string,
  ): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT author_label) AS n
         FROM opinion
         WHERE meeting_id = ? AND author_provider_id = ?`,
      )
      .get(meetingId, authorProviderId) as { n: number };
    return row.n;
  }

  // ── opinion_vote CRUD ───────────────────────────────────────────

  /** 새 투표 row insert. caller 가 id(UUID) / createdAt 채워서 넘긴다. */
  insertVote(vote: OpinionVote): void {
    this.db
      .prepare(
        `INSERT INTO opinion_vote (
           id, target_id, voter_provider_id, vote, comment,
           round, round_kind, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        vote.id,
        vote.targetId,
        vote.voterProviderId,
        vote.vote,
        vote.comment,
        vote.round,
        vote.roundKind,
        vote.createdAt,
      );
  }

  /**
   * 의견에 들어온 모든 투표 — created_at 오름차순. roundKind 필터 optional
   * (생략 시 quick_vote + free_discussion 통합).
   */
  listVotesByOpinion(
    opinionId: string,
    roundKind?: OpinionRoundKind,
  ): OpinionVote[] {
    if (roundKind === undefined) {
      const rows = this.db
        .prepare(
          `SELECT id, target_id, voter_provider_id, vote, comment,
                  round, round_kind, created_at
           FROM opinion_vote
           WHERE target_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(opinionId) as OpinionVoteRow[];
      return rows.map(rowToVote);
    }
    const rows = this.db
      .prepare(
        `SELECT id, target_id, voter_provider_id, vote, comment,
                round, round_kind, created_at
         FROM opinion_vote
         WHERE target_id = ? AND round_kind = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(opinionId, roundKind) as OpinionVoteRow[];
    return rows.map(rowToVote);
  }

  /**
   * 회의 안 모든 투표 row — opinion 과 inner join 으로 meeting_id 필터.
   * roundKind / round 필터 optional.
   */
  listVotesByMeeting(
    meetingId: string,
    options?: { roundKind?: OpinionRoundKind; round?: number },
  ): OpinionVote[] {
    const clauses: string[] = ['o.meeting_id = ?'];
    const params: Array<string | number> = [meetingId];
    if (options?.roundKind !== undefined) {
      clauses.push('v.round_kind = ?');
      params.push(options.roundKind);
    }
    if (options?.round !== undefined) {
      clauses.push('v.round = ?');
      params.push(options.round);
    }
    const where = clauses.join(' AND ');
    const rows = this.db
      .prepare(
        `SELECT v.id AS id, v.target_id AS target_id,
                v.voter_provider_id AS voter_provider_id,
                v.vote AS vote, v.comment AS comment,
                v.round AS round, v.round_kind AS round_kind,
                v.created_at AS created_at
         FROM opinion_vote v
         JOIN opinion o ON v.target_id = o.id
         WHERE ${where}
         ORDER BY v.created_at ASC, v.id ASC`,
      )
      .all(...params) as OpinionVoteRow[];
    return rows.map(rowToVote);
  }
}
