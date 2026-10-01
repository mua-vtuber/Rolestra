/**
 * Schema contract tests for v3 migration 019-opinion-tables (R12-C2 P2-1).
 *
 * Coverage:
 * - opinion 테이블 신규 — 컬럼 shape + CHECK 제약 (kind / status) + FK 정책
 *   (parent_id RESTRICT / meeting_id+channel_id CASCADE / author_provider_id SET NULL)
 * - opinion_vote 테이블 신규 — 컬럼 shape + CHECK 제약 (vote / round_kind) + FK
 *   정책 (target_id CASCADE / voter_provider_id SET NULL)
 * - 인덱스 6 종 (idx_opinion_meeting / channel / parent / status +
 *   idx_opinion_vote_target / round)
 * - channels.max_rounds INTEGER NULL ALTER
 * - 일반 채널 [##] 의견 = meeting_id NULL 허용 (kind='self-raised' /
 *   'user-raised')
 * - 019 가 migrations tracking 표에 기록됨
 * - chain-level idempotency: 두 번째 runMigrations 는 no-op
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
  tableExists,
  NOW,
} from './_helpers';

interface ColumnRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const VALID_OPINION = {
  id: 'op-1',
  parent_id: null as string | null,
  meeting_id: null as string | null,
  channel_id: 'c1',
  kind: 'root',
  author_provider_id: 'pv1',
  author_label: 'codex_1',
  title: 'first opinion',
  content: 'opinion body',
  rationale: 'because',
  status: 'pending',
  exclusion_reason: null as string | null,
  round: 0,
  created_at: NOW,
  updated_at: NOW,
};

function insertOpinion(
  db: Database.Database,
  overrides: Partial<typeof VALID_OPINION> = {},
): void {
  const row = { ...VALID_OPINION, ...overrides };
  db.prepare(
    `INSERT INTO opinion
       (id, parent_id, meeting_id, channel_id, kind, author_provider_id,
        author_label, title, content, rationale, status, exclusion_reason,
        round, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.parent_id,
    row.meeting_id,
    row.channel_id,
    row.kind,
    row.author_provider_id,
    row.author_label,
    row.title,
    row.content,
    row.rationale,
    row.status,
    row.exclusion_reason,
    row.round,
    row.created_at,
    row.updated_at,
  );
}

const VALID_VOTE = {
  id: 'v-1',
  target_id: 'op-1',
  voter_provider_id: 'pv1',
  vote: 'agree',
  comment: null as string | null,
  round: 0,
  round_kind: 'quick_vote',
  created_at: NOW,
};

function insertVote(
  db: Database.Database,
  overrides: Partial<typeof VALID_VOTE> = {},
): void {
  const row = { ...VALID_VOTE, ...overrides };
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
    row.created_at,
  );
}

describe('v3 migration 019-opinion-tables — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'c1', 'p1');
  });

  afterEach(() => {
    db.close();
  });

  describe('opinion table shape', () => {
    it('creates the opinion table', () => {
      expect(tableExists(db, 'opinion')).toBe(true);
    });

    it('has all required columns with correct nullability', () => {
      const cols = db
        .prepare('PRAGMA table_info(opinion)')
        .all() as ColumnRow[];
      const byName = new Map(cols.map((c) => [c.name, c]));

      expect(byName.get('id')?.pk).toBe(1);
      expect(byName.get('parent_id')?.notnull).toBe(0);
      expect(byName.get('meeting_id')?.notnull).toBe(0);
      expect(byName.get('channel_id')?.notnull).toBe(1);
      expect(byName.get('kind')?.notnull).toBe(1);
      expect(byName.get('author_provider_id')?.notnull).toBe(0);
      expect(byName.get('author_label')?.notnull).toBe(1);
      expect(byName.get('title')?.notnull).toBe(0);
      expect(byName.get('content')?.notnull).toBe(0);
      expect(byName.get('rationale')?.notnull).toBe(0);
      expect(byName.get('status')?.notnull).toBe(1);
      expect(byName.get('exclusion_reason')?.notnull).toBe(0);
      expect(byName.get('round')?.notnull).toBe(1);
      expect(byName.get('round')?.dflt_value).toBe('0');
      expect(byName.get('created_at')?.notnull).toBe(1);
      expect(byName.get('updated_at')?.notnull).toBe(1);
    });

    it('creates expected indexes', () => {
      expect(indexExists(db, 'idx_opinion_meeting')).toBe(true);
      expect(indexExists(db, 'idx_opinion_channel')).toBe(true);
      expect(indexExists(db, 'idx_opinion_parent')).toBe(true);
      expect(indexExists(db, 'idx_opinion_status')).toBe(true);
    });
  });

  describe('opinion CHECK constraints', () => {
    it('accepts all 6 valid kind values', () => {
      const kinds = ['root', 'revise', 'block', 'addition', 'self-raised', 'user-raised'] as const;
      kinds.forEach((kind, i) => {
        expect(() =>
          insertOpinion(db, { id: `op-kind-${i}`, kind }),
        ).not.toThrow();
      });
    });

    it('rejects invalid kind value', () => {
      expect(() => insertOpinion(db, { kind: 'unknown' })).toThrow();
    });

    it('accepts all 4 valid status values', () => {
      const statuses = ['pending', 'agreed', 'rejected', 'excluded'] as const;
      statuses.forEach((status, i) => {
        expect(() =>
          insertOpinion(db, { id: `op-status-${i}`, status }),
        ).not.toThrow();
      });
    });

    it('rejects invalid status value', () => {
      expect(() => insertOpinion(db, { status: 'frozen' })).toThrow();
    });
  });

  describe('opinion FK behaviors', () => {
    it('allows meeting_id NULL for general channel [##] opinion', () => {
      expect(() =>
        insertOpinion(db, {
          kind: 'self-raised',
          meeting_id: null,
        }),
      ).not.toThrow();
    });

    it('rejects orphan channel_id reference', () => {
      expect(() =>
        insertOpinion(db, { channel_id: 'nonexistent' }),
      ).toThrow();
    });

    it('parent_id RESTRICT — refuses to delete parent with children', () => {
      insertOpinion(db, { id: 'op-parent', kind: 'root' });
      insertOpinion(db, {
        id: 'op-child',
        parent_id: 'op-parent',
        kind: 'revise',
        author_label: 'codex_2',
      });
      expect(() =>
        db.prepare('DELETE FROM opinion WHERE id = ?').run('op-parent'),
      ).toThrow();
    });

    it('channel_id CASCADE — deleting channel removes opinions', () => {
      insertOpinion(db, { id: 'op-cascade-channel' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('c1');
      const row = db
        .prepare('SELECT id FROM opinion WHERE id = ?')
        .get('op-cascade-channel');
      expect(row).toBeUndefined();
    });

    it('meeting_id CASCADE — deleting meeting removes opinions', () => {
      db.prepare(
        `INSERT INTO meetings (id, channel_id, state, started_at)
         VALUES (?, ?, ?, ?)`,
      ).run('m1', 'c1', 'opinion_gather', NOW);
      insertOpinion(db, { id: 'op-cascade-meeting', meeting_id: 'm1' });
      db.prepare('DELETE FROM meetings WHERE id = ?').run('m1');
      const row = db
        .prepare('SELECT id FROM opinion WHERE id = ?')
        .get('op-cascade-meeting');
      expect(row).toBeUndefined();
    });

    it('author_provider_id SET NULL — deleting provider preserves opinion', () => {
      insertOpinion(db, { id: 'op-author-null' });
      db.prepare('DELETE FROM providers WHERE id = ?').run('pv1');
      const row = db
        .prepare('SELECT author_provider_id, author_label FROM opinion WHERE id = ?')
        .get('op-author-null') as
        | { author_provider_id: string | null; author_label: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.author_provider_id).toBeNull();
      expect(row?.author_label).toBe('codex_1');
    });
  });

  describe('opinion_vote table shape', () => {
    it('creates the opinion_vote table', () => {
      expect(tableExists(db, 'opinion_vote')).toBe(true);
    });

    it('has all required columns with correct nullability', () => {
      const cols = db
        .prepare('PRAGMA table_info(opinion_vote)')
        .all() as ColumnRow[];
      const byName = new Map(cols.map((c) => [c.name, c]));

      expect(byName.get('id')?.pk).toBe(1);
      expect(byName.get('target_id')?.notnull).toBe(1);
      expect(byName.get('voter_provider_id')?.notnull).toBe(0);
      expect(byName.get('vote')?.notnull).toBe(1);
      expect(byName.get('comment')?.notnull).toBe(0);
      expect(byName.get('round')?.notnull).toBe(1);
      expect(byName.get('round')?.dflt_value).toBe('0');
      expect(byName.get('round_kind')?.notnull).toBe(1);
      expect(byName.get('created_at')?.notnull).toBe(1);
    });

    it('creates expected indexes', () => {
      expect(indexExists(db, 'idx_opinion_vote_target')).toBe(true);
      expect(indexExists(db, 'idx_opinion_vote_round')).toBe(true);
    });
  });

  describe('opinion_vote CHECK constraints', () => {
    beforeEach(() => {
      insertOpinion(db);
    });

    it('accepts all 3 valid vote values', () => {
      const votes = ['agree', 'oppose', 'abstain'] as const;
      votes.forEach((vote, i) => {
        expect(() =>
          insertVote(db, { id: `v-vote-${i}`, vote }),
        ).not.toThrow();
      });
    });

    it('rejects invalid vote value', () => {
      expect(() => insertVote(db, { vote: 'maybe' })).toThrow();
    });

    it('accepts both valid round_kind values', () => {
      ['quick_vote', 'free_discussion'].forEach((round_kind, i) => {
        expect(() =>
          insertVote(db, { id: `v-rk-${i}`, round_kind }),
        ).not.toThrow();
      });
    });

    it('rejects invalid round_kind value', () => {
      expect(() => insertVote(db, { round_kind: 'lazy' })).toThrow();
    });
  });

  describe('opinion_vote FK behaviors', () => {
    beforeEach(() => {
      insertOpinion(db);
    });

    it('rejects orphan target_id reference', () => {
      expect(() => insertVote(db, { target_id: 'nonexistent' })).toThrow();
    });

    it('target_id CASCADE — deleting opinion removes votes', () => {
      insertVote(db, { id: 'v-cascade' });
      db.prepare('DELETE FROM opinion WHERE id = ?').run('op-1');
      const row = db
        .prepare('SELECT id FROM opinion_vote WHERE id = ?')
        .get('v-cascade');
      expect(row).toBeUndefined();
    });

    it('voter_provider_id SET NULL — deleting provider preserves vote', () => {
      insertVote(db, { id: 'v-voter-null' });
      db.prepare('DELETE FROM providers WHERE id = ?').run('pv1');
      const row = db
        .prepare('SELECT voter_provider_id FROM opinion_vote WHERE id = ?')
        .get('v-voter-null') as { voter_provider_id: string | null } | undefined;
      expect(row).toBeDefined();
      expect(row?.voter_provider_id).toBeNull();
    });
  });

  describe('channels.max_rounds column', () => {
    it('adds max_rounds column nullable INTEGER', () => {
      const cols = db
        .prepare('PRAGMA table_info(channels)')
        .all() as ColumnRow[];
      const maxRounds = cols.find((c) => c.name === 'max_rounds');
      expect(maxRounds).toBeDefined();
      expect(maxRounds?.type).toBe('INTEGER');
      expect(maxRounds?.notnull).toBe(0);
      expect(maxRounds?.dflt_value).toBeNull();
    });

    it('defaults to NULL when omitted on insert', () => {
      insertProject(db, 'p2');
      db.prepare(
        `INSERT INTO channels (id, project_id, name, kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('c2', 'p2', '리뷰', 'user', NOW);
      const row = db
        .prepare('SELECT max_rounds FROM channels WHERE id = ?')
        .get('c2') as { max_rounds: number | null };
      expect(row.max_rounds).toBeNull();
    });

    it('accepts explicit integer value', () => {
      insertProject(db, 'p3');
      db.prepare(
        `INSERT INTO channels (id, project_id, name, kind, created_at, max_rounds)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('c3', 'p3', '회의', 'user', NOW, 5);
      const row = db
        .prepare('SELECT max_rounds FROM channels WHERE id = ?')
        .get('c3') as { max_rounds: number | null };
      expect(row.max_rounds).toBe(5);
    });
  });

  describe('migrations tracking', () => {
    it('records 019 in the migrations table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('019-opinion-tables');
      expect(rows.findIndex((r) => r.id === '019-opinion-tables')).toBe(18);
    });
  });

  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (019 is skipped)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(before).toBeGreaterThanOrEqual(19);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(after).toBe(before);
    });
  });
});
