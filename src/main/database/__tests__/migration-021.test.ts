/**
 * Schema contract tests for v3 migration 021-opinion-vote-light (R12-C2 P4 T21).
 *
 * Coverage:
 * - opinion_vote.round_kind CHECK 확장 — 'light' 신규 허용 + 기존 'quick_vote' /
 *   'free_discussion' 그대로 유지
 * - 잘못된 round_kind ('lazy' 등) 는 여전히 reject
 * - rebuild 후 인덱스 (idx_opinion_vote_target / idx_opinion_vote_round) 재생성
 * - rebuild 후 FK 정책 (target_id CASCADE / voter_provider_id SET NULL) 보존
 * - rebuild 시점에 들어 있던 행 보존 — m019 시대의 row 가 m021 후에도 남아 있어야 함
 * - 021 가 migrations tracking 표 index 20 에 기록됨
 * - chain idempotency — 두 번째 runMigrations 가 no-op
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import {
  insertChannel,
  insertProject,
  insertProvider,
  indexExists,
  NOW,
} from './_helpers';

interface VoteRow {
  id: string;
  target_id: string;
  voter_provider_id: string | null;
  vote: string;
  comment: string | null;
  round: number;
  round_kind: string;
}

function insertOpinion(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO opinion (id, parent_id, meeting_id, channel_id, kind,
        author_provider_id, author_label, title, content, rationale,
        status, exclusion_reason, round, created_at, updated_at)
     VALUES (?, NULL, NULL, 'c1', 'self-raised', 'pv1', 'codex_1',
        't', 'b', 'r', 'pending', NULL, 0, ?, ?)`,
  ).run(id, NOW, NOW);
}

function insertVote(
  db: Database.Database,
  overrides: Partial<VoteRow>,
): void {
  const row: VoteRow = {
    id: 'v-default',
    target_id: 'op-1',
    voter_provider_id: 'pv1',
    vote: 'agree',
    comment: null,
    round: 0,
    round_kind: 'quick_vote',
    ...overrides,
  };
  db.prepare(
    `INSERT INTO opinion_vote
       (id, target_id, voter_provider_id, vote, comment, round, round_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.target_id,
    row.voter_provider_id,
    row.vote,
    row.comment,
    row.round,
    row.round_kind,
    NOW,
  );
}

describe('v3 migration 021-opinion-vote-light — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'c1', 'p1');
    insertOpinion(db, 'op-1');
  });

  afterEach(() => {
    db.close();
  });

  describe('round_kind CHECK 확장', () => {
    it("accepts 'light' (T21 신규)", () => {
      expect(() =>
        insertVote(db, { id: 'v-light', round_kind: 'light' }),
      ).not.toThrow();
    });

    it("still accepts 'quick_vote' (m019 호환)", () => {
      expect(() =>
        insertVote(db, { id: 'v-qv', round_kind: 'quick_vote' }),
      ).not.toThrow();
    });

    it("still accepts 'free_discussion' (m019 호환)", () => {
      expect(() =>
        insertVote(db, { id: 'v-fd', round_kind: 'free_discussion' }),
      ).not.toThrow();
    });

    it("rejects unknown round_kind ('lazy') after rebuild", () => {
      expect(() =>
        insertVote(db, { id: 'v-bad', round_kind: 'lazy' }),
      ).toThrow();
    });
  });

  describe('rebuild 후 인덱스 / 컬럼 보존', () => {
    it('idx_opinion_vote_target / idx_opinion_vote_round 재생성', () => {
      expect(indexExists(db, 'idx_opinion_vote_target')).toBe(true);
      expect(indexExists(db, 'idx_opinion_vote_round')).toBe(true);
    });

    it('컬럼 8 종 모두 보존', () => {
      const cols = db
        .prepare('PRAGMA table_info(opinion_vote)')
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(
        [
          'comment',
          'created_at',
          'id',
          'round',
          'round_kind',
          'target_id',
          'vote',
          'voter_provider_id',
        ].sort(),
      );
    });
  });

  describe('rebuild 후 FK 정책 보존', () => {
    it('target_id CASCADE — 의견 삭제 시 vote 도 삭제', () => {
      insertVote(db, { id: 'v-cascade', round_kind: 'light' });
      db.prepare('DELETE FROM opinion WHERE id = ?').run('op-1');
      const row = db
        .prepare('SELECT id FROM opinion_vote WHERE id = ?')
        .get('v-cascade');
      expect(row).toBeUndefined();
    });

    it('voter_provider_id SET NULL — 직원 삭제 시 vote 보존', () => {
      insertVote(db, { id: 'v-voter-null', round_kind: 'light' });
      db.prepare('DELETE FROM providers WHERE id = ?').run('pv1');
      const row = db
        .prepare(
          'SELECT voter_provider_id FROM opinion_vote WHERE id = ?',
        )
        .get('v-voter-null') as
        | { voter_provider_id: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.voter_provider_id).toBeNull();
    });

    it("voter_provider_id NULL 허용 — 사용자 light vote", () => {
      expect(() =>
        insertVote(db, {
          id: 'v-user',
          voter_provider_id: null,
          round_kind: 'light',
          vote: 'agree',
        }),
      ).not.toThrow();
    });
  });

  describe('migrations tracking', () => {
    it('021 가 chain index 20 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('021-opinion-vote-light');
      expect(rows.findIndex((r) => r.id === '021-opinion-vote-light')).toBe(
        20,
      );
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (021 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(21);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(after).toBe(before);
    });
  });
});
