/**
 * Migration 021-opinion-vote-light — R12-C2 P4 T21 일반 채널 가벼운 투표 토대.
 *
 * `opinion_vote.round_kind` CHECK 제약 확장:
 *   기존 `'quick_vote' | 'free_discussion'`
 *   → 신규 `'quick_vote' | 'free_discussion' | 'light'`
 *
 * 'light' = 일반 채널 (잡담 정체성) 안 의견 카드의 *가벼운* 동의/반대 표.
 *   - 회의 X (meeting_id NULL 카드 대상)
 *   - 사용자 1 인 voter (voter_provider_id NULL) 가 카드별 1 row 미만 유지 — service
 *     가 같은 vote 재요청 시 DELETE, 다른 vote 시 REPLACE
 *   - round = 0, comment = NULL (UI 가 1 탭 동의/반대만 노출)
 *   - spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *     §11.13 general row "가벼운 동의/반대 카운터 + 사용자 동의/반대 버튼"
 *
 * SQLite 는 CHECK 제약을 직접 ALTER 할 수 없으므로 12-step rebuild 패턴 사용:
 *   1. 새 테이블 `opinion_vote_new` 생성 (확장된 CHECK)
 *   2. 기존 row 통째 복사 — 회의 카드 투표 (quick_vote / free_discussion) 모두 보존
 *   3. 옛 테이블 drop
 *   4. 새 테이블 rename
 *   5. 인덱스 재생성
 *
 * 트랜잭션은 migrator 가 본 SQL 통째 wrap 하므로 본 파일에서 BEGIN/COMMIT 불필요.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '021-opinion-vote-light',
  sql: `
CREATE TABLE opinion_vote_new (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES opinion(id) ON DELETE CASCADE,
  voter_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  vote TEXT NOT NULL CHECK(vote IN ('agree','oppose','abstain')),
  comment TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  round_kind TEXT NOT NULL CHECK(round_kind IN ('quick_vote','free_discussion','light')),
  created_at INTEGER NOT NULL
);

INSERT INTO opinion_vote_new (id, target_id, voter_provider_id, vote, comment, round, round_kind, created_at)
  SELECT id, target_id, voter_provider_id, vote, comment, round, round_kind, created_at
  FROM opinion_vote;

DROP TABLE opinion_vote;

ALTER TABLE opinion_vote_new RENAME TO opinion_vote;

CREATE INDEX idx_opinion_vote_target ON opinion_vote(target_id);
CREATE INDEX idx_opinion_vote_round ON opinion_vote(round);
`,
};
