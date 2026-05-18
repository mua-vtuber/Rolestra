/**
 * Schema contract tests for v3 migration 015-approval-circuit-breaker-kind.
 *
 * 015 is a "rebuild and rename" migration that widens the `approval_items.kind`
 * CHECK constraint from the 006-inbox baseline (5 kinds) to include
 * `'circuit_breaker'` (6 kinds total). SQLite cannot alter a single CHECK in
 * place, so the migration:
 *
 *   1. CREATE TABLE approval_items_v2 (CHECK widened).
 *   2. INSERT INTO approval_items_v2 (…) SELECT (…) FROM approval_items.
 *   3. DROP INDEX idx_approval_status + DROP TABLE approval_items.
 *   4. ALTER TABLE approval_items_v2 RENAME TO approval_items + recreate index.
 *
 * The single failure mode that this pattern silently catastrophises is a
 * column-order mismatch in step 2 — the SQL would run cleanly but every row
 * would land in the wrong column, producing invisible audit corruption. We
 * therefore prove row preservation at the *value* level (id ↔ payload pairing)
 * across the rebuild, in addition to the standard CHECK / index / idempotency
 * checks.
 *
 * Strategy: partial-chain application. We apply migrations 001..014 only
 * (`migrations.slice(0, 14)`), insert representative pre-015 rows under the
 * old CHECK enum, then apply migration 015 alone and assert that every row
 * survives with every column value bit-perfect. Migration 015 itself is
 * unchanged from production — we never touch the migration body, only run it.
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { migration as migration015 } from '../migrations/015-approval-circuit-breaker-kind';
import {
  indexExists,
  insertChannel,
  insertProject,
  NOW,
  tableExists,
} from './_helpers';

const APPROVAL_COLUMNS = [
  'id',
  'kind',
  'project_id',
  'channel_id',
  'meeting_id',
  'requester_id',
  'payload_json',
  'status',
  'decision_comment',
  'created_at',
  'decided_at',
] as const;

interface ApprovalRow {
  id: string;
  kind: string;
  project_id: string | null;
  channel_id: string | null;
  meeting_id: string | null;
  requester_id: string | null;
  payload_json: string;
  status: string;
  decision_comment: string | null;
  created_at: number;
  decided_at: number | null;
}

function insertMeeting(
  db: Database.Database,
  id: string,
  channelId: string,
): void {
  db.prepare(
    `INSERT INTO meetings (id, channel_id, state, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).run(id, channelId, NOW);
}

function insertApproval(db: Database.Database, row: ApprovalRow): void {
  db.prepare(
    `INSERT INTO approval_items
       (id, kind, project_id, channel_id, meeting_id, requester_id,
        payload_json, status, decision_comment, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.kind,
    row.project_id,
    row.channel_id,
    row.meeting_id,
    row.requester_id,
    row.payload_json,
    row.status,
    row.decision_comment,
    row.created_at,
    row.decided_at,
  );
}

function selectApprovalById(
  db: Database.Database,
  id: string,
): ApprovalRow | undefined {
  return db
    .prepare('SELECT * FROM approval_items WHERE id = ?')
    .get(id) as ApprovalRow | undefined;
}

describe('v3 migration 015-approval-circuit-breaker-kind — schema contract', () => {
  describe('partial chain (001..014) — pre-015 baseline', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      // 14 migrations = 001..014 inclusive (slice end is exclusive).
      runMigrations(db, migrations.slice(0, 14));
      insertProject(db, 'p1');
      insertChannel(db, 'ch1', 'p1');
      insertMeeting(db, 'm1', 'ch1');
    });

    afterEach(() => {
      db.close();
    });

    it('approval_items 테이블이 014 시점에 존재하며 CHECK 는 5 enum 기준', () => {
      expect(tableExists(db, 'approval_items')).toBe(true);
      // 014 시점에는 'circuit_breaker' 미지원 — INSERT throw.
      expect(() =>
        insertApproval(db, {
          id: 'a-pre-cb',
          kind: 'circuit_breaker',
          project_id: 'p1',
          channel_id: 'ch1',
          meeting_id: 'm1',
          requester_id: 'r1',
          payload_json: '{}',
          status: 'pending',
          decision_comment: null,
          created_at: NOW,
          decided_at: null,
        }),
      ).toThrow();
    });

    it('014 시점의 5 enum 멤버는 모두 통과', () => {
      const kinds = [
        'cli_permission',
        'mode_transition',
        'consensus_decision',
        'review_outcome',
        'failure_report',
      ];
      for (const [i, kind] of kinds.entries()) {
        expect(() =>
          insertApproval(db, {
            id: `a-enum-${i}`,
            kind,
            project_id: 'p1',
            channel_id: 'ch1',
            meeting_id: 'm1',
            requester_id: 'r1',
            payload_json: `{"k":"${kind}"}`,
            status: 'pending',
            decision_comment: null,
            created_at: NOW + i,
            decided_at: null,
          }),
        ).not.toThrow();
      }
    });
  });

  // ── rebuild row preservation — the heart of this test file ─────────────
  describe('rebuild row 복사 무결성 — 014 → 015 step-up', () => {
    let db: Database.Database;
    let representativeRows: ApprovalRow[];

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db, migrations.slice(0, 14));
      insertProject(db, 'p1');
      insertChannel(db, 'ch1', 'p1');
      insertMeeting(db, 'm1', 'ch1');

      // Three rows under the old (pre-015) CHECK enum. Each row carries a
      // distinct, distinguishable value in *every* column so a silent
      // column-order swap during the INSERT … SELECT rebuild step would
      // produce a visible mismatch.
      representativeRows = [
        {
          id: 'apv-cli-001',
          kind: 'cli_permission',
          project_id: 'p1',
          channel_id: 'ch1',
          meeting_id: 'm1',
          requester_id: 'requester-alpha',
          payload_json: '{"tag":"ALPHA","scope":"cli"}',
          status: 'pending',
          decision_comment: null,
          created_at: NOW,
          decided_at: null,
        },
        {
          id: 'apv-mode-002',
          kind: 'mode_transition',
          project_id: 'p1',
          channel_id: 'ch1',
          meeting_id: null,
          requester_id: 'requester-beta',
          payload_json: '{"tag":"BETA","from":"auto","to":"manual"}',
          status: 'approved',
          decision_comment: 'looks good',
          created_at: NOW + 1,
          decided_at: NOW + 100,
        },
        {
          id: 'apv-cons-003',
          kind: 'consensus_decision',
          project_id: null,
          channel_id: null,
          meeting_id: null,
          requester_id: null,
          payload_json: '{"tag":"GAMMA","outcome":"reject"}',
          status: 'rejected',
          decision_comment: null,
          created_at: NOW + 2,
          decided_at: NOW + 200,
        },
      ];
      for (const row of representativeRows) {
        insertApproval(db, row);
      }

      // Apply 015 alone — production migration body, unmodified.
      runMigrations(db, [migration015]);
    });

    afterEach(() => {
      db.close();
    });

    it('approval_items 가 여전히 존재 + 컬럼 11 종 그대로', () => {
      expect(tableExists(db, 'approval_items')).toBe(true);
      const cols = db
        .prepare('PRAGMA table_info(approval_items)')
        .all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name).sort()).toEqual(
        [...APPROVAL_COLUMNS].sort(),
      );
    });

    it('row 3 개가 모두 보존됨', () => {
      const count = (
        db.prepare('SELECT COUNT(*) AS c FROM approval_items').get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(3);
    });

    it('모든 컬럼 값이 bit-perfect 동일 (column drift 검출)', () => {
      for (const original of representativeRows) {
        const after = selectApprovalById(db, original.id);
        expect(after, `row ${original.id} 사라짐`).toBeDefined();
        // Spread+equality covers every column at once — a silent
        // column-order mismatch in the INSERT … SELECT rebuild step would
        // make at least one field land in the wrong slot.
        expect(after).toEqual(original);
      }
    });

    it('id ↔ payload_json 짝이 그대로 유지 (rebuild row alignment 명시 보장)', () => {
      // Distinct tags in payload_json — if rebuild scrambled column order
      // even subtly (e.g. payload ↔ decision_comment swap), this fails.
      const rows = db
        .prepare('SELECT id, payload_json FROM approval_items ORDER BY id')
        .all() as Array<{ id: string; payload_json: string }>;
      expect(rows).toEqual([
        { id: 'apv-cli-001', payload_json: '{"tag":"ALPHA","scope":"cli"}' },
        {
          id: 'apv-cons-003',
          payload_json: '{"tag":"GAMMA","outcome":"reject"}',
        },
        {
          id: 'apv-mode-002',
          payload_json: '{"tag":"BETA","from":"auto","to":"manual"}',
        },
      ]);
    });

    it('id ↔ status / decision_comment 짝 유지 (NULL/non-NULL alignment 보장)', () => {
      // Original layout had only apv-mode-002 with a non-NULL decision_comment.
      // If rebuild misaligned the column, the NULL would appear in the wrong
      // row.
      const rows = db
        .prepare(
          'SELECT id, status, decision_comment FROM approval_items ORDER BY id',
        )
        .all() as Array<{
        id: string;
        status: string;
        decision_comment: string | null;
      }>;
      expect(rows).toEqual([
        { id: 'apv-cli-001', status: 'pending', decision_comment: null },
        { id: 'apv-cons-003', status: 'rejected', decision_comment: null },
        { id: 'apv-mode-002', status: 'approved', decision_comment: 'looks good' },
      ]);
    });

    it('idx_approval_status 인덱스가 rebuild 후 재생성됨', () => {
      expect(indexExists(db, 'idx_approval_status')).toBe(true);
    });
  });

  // ── CHECK widening / rejection / chain idempotency ─────────────────────
  describe('CHECK enum widening — 015 적용 후', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db, migrations);
      insertProject(db, 'p1');
      insertChannel(db, 'ch1', 'p1');
      insertMeeting(db, 'm1', 'ch1');
    });

    afterEach(() => {
      db.close();
    });

    it("새 enum 멤버 'circuit_breaker' INSERT 통과", () => {
      expect(() =>
        insertApproval(db, {
          id: 'a-cb',
          kind: 'circuit_breaker',
          project_id: 'p1',
          channel_id: 'ch1',
          meeting_id: 'm1',
          requester_id: 'r1',
          payload_json: '{"tripwire":"daily_quota"}',
          status: 'pending',
          decision_comment: null,
          created_at: NOW,
          decided_at: null,
        }),
      ).not.toThrow();
    });

    it('014 시점의 5 enum 멤버도 여전히 통과 (전 enum subset 보존)', () => {
      const kinds = [
        'cli_permission',
        'mode_transition',
        'consensus_decision',
        'review_outcome',
        'failure_report',
      ];
      for (const [i, kind] of kinds.entries()) {
        expect(() =>
          insertApproval(db, {
            id: `a-after-${i}`,
            kind,
            project_id: 'p1',
            channel_id: 'ch1',
            meeting_id: 'm1',
            requester_id: 'r1',
            payload_json: '{}',
            status: 'pending',
            decision_comment: null,
            created_at: NOW + i,
            decided_at: null,
          }),
        ).not.toThrow();
      }
    });

    it("enum 외 값 ('rogue_kind') INSERT 는 throw", () => {
      expect(() =>
        insertApproval(db, {
          id: 'a-bad',
          kind: 'rogue_kind',
          project_id: 'p1',
          channel_id: 'ch1',
          meeting_id: 'm1',
          requester_id: 'r1',
          payload_json: '{}',
          status: 'pending',
          decision_comment: null,
          created_at: NOW,
          decided_at: null,
        }),
      ).toThrow();
    });
  });

  describe('chain tracking + idempotency', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db, migrations);
    });

    afterEach(() => {
      db.close();
    });

    it('015 가 chain index 14 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain(
        '015-approval-circuit-breaker-kind',
      );
      expect(
        rows.findIndex((r) => r.id === '015-approval-circuit-breaker-kind'),
      ).toBe(14);
    });

    it('두 번째 runMigrations 호출 시 015 가 no-op', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
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
