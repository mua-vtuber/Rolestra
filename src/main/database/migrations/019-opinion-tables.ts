/**
 * Migration 019-opinion-tables — R12-C2 P2 회의 backend 토대.
 *
 * 옛 12 단계 SSM 합의 모델 (DISCUSSING / PROPOSING / VOTING / ...) 폐기.
 * 새 모델 = 의견 트리 + 일괄 동의 투표 + 자유 토론 + 모더레이터 회의록.
 * 모든 풀세트 부서 (planning / design.* / review / audit) 공유 토대.
 * 일반 채널 [##본문] 카드도 같은 opinion 테이블 사용 (kind='self-raised' /
 * 'user-raised'). 잡담 정체성 — meeting_id NULL.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 * §4 Migration / §5 데이터 모델 / §11.14 max_rounds.
 *
 * 변경:
 * - `opinion` 테이블 신규 — 의견 트리 (parent_id self-FK) + kind enum 6 종 +
 *   status enum 4 종 + author_label (회의 단위 발화 카운터, 예 `codex_1`).
 * - `opinion_vote` 테이블 신규 — 투표 row (target_id FK opinion) + vote enum
 *   3 종 + round_kind enum 2 종 ('quick_vote' / 'free_discussion').
 * - `channels.max_rounds` INTEGER NULL — 회의 종료 조건 (NULL = 무제한).
 *
 * 옛 `opinion_revisions` 테이블 = R5 시점에 land 된 적 없음 (마이그레이션
 * chain grep 결과 없음) — drop 불필요. `opinion.parent_id` + `opinion.kind`
 * 가 트리 + 수정 정보 통째 흡수.
 *
 * 옛 SSM phase 컬럼 (`meetings.state`) = 새 모델도 사용 (state 문자열만 교체).
 * T10 MeetingOrchestrator 재배선이 새 phase 문자열 ('opinion_gather' /
 * 'tally' / 'quick_vote' / 'free_discussion' / 'minutes' / 'done') 으로 갱신.
 * 컬럼 자체는 유지 — drop 불필요.
 *
 * FK 정책:
 * - opinion.meeting_id ON DELETE CASCADE — 회의 삭제 시 의견도 사라짐
 * - opinion.channel_id ON DELETE CASCADE — 채널 삭제 시 의견도 사라짐
 * - opinion.parent_id ON DELETE RESTRICT — 트리 무결성 (자식 있는 부모 삭제 차단)
 * - opinion.author_provider_id ON DELETE SET NULL — 직원 삭제해도 의견 보존
 *   (author_label 로 식별 가능)
 * - opinion_vote.target_id ON DELETE CASCADE — 의견 삭제 시 투표도 사라짐
 * - opinion_vote.voter_provider_id ON DELETE SET NULL — 직원 삭제해도 투표 row 보존
 *
 * meeting_id NULL 허용 — 일반 채널 [##] 의견 (kind='self-raised' / 'user-raised')
 * 은 회의 없이 카드 등록.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '019-opinion-tables',
  sql: `
CREATE TABLE opinion (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES opinion(id) ON DELETE RESTRICT,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('root','revise','block','addition','self-raised','user-raised')),
  author_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL,
  title TEXT,
  content TEXT,
  rationale TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','agreed','rejected','excluded')),
  exclusion_reason TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_opinion_meeting ON opinion(meeting_id);
CREATE INDEX idx_opinion_channel ON opinion(channel_id);
CREATE INDEX idx_opinion_parent ON opinion(parent_id);
CREATE INDEX idx_opinion_status ON opinion(status);

CREATE TABLE opinion_vote (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES opinion(id) ON DELETE CASCADE,
  voter_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  vote TEXT NOT NULL CHECK(vote IN ('agree','oppose','abstain')),
  comment TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  round_kind TEXT NOT NULL CHECK(round_kind IN ('quick_vote','free_discussion')),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_opinion_vote_target ON opinion_vote(target_id);
CREATE INDEX idx_opinion_vote_round ON opinion_vote(round);

ALTER TABLE channels ADD COLUMN max_rounds INTEGER;
`,
};
