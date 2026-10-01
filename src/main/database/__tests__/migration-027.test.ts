/**
 * Schema contract tests for v3 migration 027-planning-design-check-context
 * (R12-C2 4차 결함 수정 — 026 forward-only column ADD).
 *
 * Coverage:
 * - 027 컬럼 8 종 ADD COLUMN 으로 land
 * - user_decision CHECK enum 멤버 정확 ('send_to_implementation' /
 *   'request_design_revision' / 'stop')
 * - 복합 인덱스 idx_planning_design_check_work_bundle 가
 *   (project_id, work_bundle_key, status, user_decision) 4 컬럼 순서로 land
 * - idx_planning_design_check_design_return_dispatch 인덱스 land
 * - 026 forward-only 의존성 — 027 만 적용하면 ALTER TABLE 가 실패해야 함
 *   (planning_design_check 테이블 미존재)
 * - 027 가 chain index 26 에 기록됨
 * - chain idempotency — 두 번째 runMigrations 가 no-op
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import {
  indexExists,
  insertChannel,
  insertProject,
  insertProvider,
  NOW,
} from './_helpers';

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

interface CheckInsert {
  id?: string;
  projectId?: string;
  sourceDesignMeetingId?: string;
  designChannelId?: string;
  designChannelRole?: string;
  planningChannelId?: string;
  implementationChannelId?: string | null;
  requestTitle?: string;
  requestBody?: string;
  finalDesignMinutesPath?: string;
  finalDesignMinutesBody?: string;
  wireframeCheckpointsJson?: string;
  wireframeUserNotesJson?: string;
  returnCount?: number;
  verdict?: string | null;
  status?: string;
  createdAt?: number;
  workBundleKey?: string | null;
  userDecision?: string | null;
}

/**
 * Inserts a planning_design_check row with optional 027 columns. Keeps the
 * column list explicit so a future schema change forces a test review.
 */
function insertCheck(
  db: Database.Database,
  overrides: CheckInsert = {},
): string {
  const row = {
    id: 'pdc-1',
    projectId: 'p1',
    sourceDesignMeetingId: 'm-design-1',
    designChannelId: 'ch-design',
    designChannelRole: 'design.ui',
    planningChannelId: 'ch-planning',
    implementationChannelId: null as string | null,
    requestTitle: 'Design review request',
    requestBody: 'body',
    finalDesignMinutesPath: '/arena/minutes/m-design-1.md',
    finalDesignMinutesBody: '[합의]\n- A',
    wireframeCheckpointsJson: '[]',
    wireframeUserNotesJson: '[]',
    returnCount: 0,
    verdict: null as string | null,
    status: 'request_created',
    createdAt: NOW,
    workBundleKey: null as string | null,
    userDecision: null as string | null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO planning_design_check
       (id, project_id, source_design_meeting_id, design_channel_id,
        design_channel_role, planning_channel_id, implementation_channel_id,
        request_title, request_body, final_design_minutes_path,
        final_design_minutes_body, wireframe_checkpoints_json,
        wireframe_user_notes_json, return_count, verdict, status, created_at,
        work_bundle_key, user_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.projectId,
    row.sourceDesignMeetingId,
    row.designChannelId,
    row.designChannelRole,
    row.planningChannelId,
    row.implementationChannelId,
    row.requestTitle,
    row.requestBody,
    row.finalDesignMinutesPath,
    row.finalDesignMinutesBody,
    row.wireframeCheckpointsJson,
    row.wireframeUserNotesJson,
    row.returnCount,
    row.verdict,
    row.status,
    row.createdAt,
    row.workBundleKey,
    row.userDecision,
  );
  return row.id;
}

describe('v3 migration 027-planning-design-check-context — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'ch-design', 'p1');
    insertChannel(db, 'ch-planning', 'p1');
    insertMeeting(db, 'm-design-1', 'ch-design');
  });

  afterEach(() => {
    db.close();
  });

  describe('컬럼 ADD COLUMN', () => {
    it('027 추가 컬럼 8 종 존재', () => {
      const cols = db
        .prepare('PRAGMA table_info(planning_design_check)')
        .all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      const added = [
        'work_bundle_key',
        'original_planning_minutes_id',
        'original_planning_minutes_path',
        'original_planning_minutes_body',
        'original_planning_minutes_missing_reason',
        'user_decision',
        'user_decision_note',
        'user_decision_dispatch_id',
      ];
      for (const col of added) {
        expect(names.has(col)).toBe(true);
      }
    });

    it('work_bundle_key 는 nullable (ADD COLUMN 디폴트 — 기존 row 호환)', () => {
      const info = db
        .prepare('PRAGMA table_info(planning_design_check)')
        .all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
      const wb = info.find((c) => c.name === 'work_bundle_key');
      expect(wb).toBeDefined();
      expect(wb?.notnull).toBe(0);
    });
  });

  describe('user_decision CHECK 제약', () => {
    it('accepts NULL (미결정)', () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-ud-null', userDecision: null }),
      ).not.toThrow();
    });

    it("accepts 'send_to_implementation'", () => {
      expect(() =>
        insertCheck(db, {
          id: 'pdc-ud-impl',
          userDecision: 'send_to_implementation',
        }),
      ).not.toThrow();
    });

    it("accepts 'request_design_revision'", () => {
      expect(() =>
        insertCheck(db, {
          id: 'pdc-ud-rev',
          userDecision: 'request_design_revision',
        }),
      ).not.toThrow();
    });

    it("accepts 'stop'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-ud-stop', userDecision: 'stop' }),
      ).not.toThrow();
    });

    it("rejects unknown user_decision ('reject')", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-ud-bad', userDecision: 'reject' }),
      ).toThrow();
    });
  });

  describe('복합 인덱스 work_bundle', () => {
    it('idx_planning_design_check_work_bundle 인덱스 생성', () => {
      expect(
        indexExists(db, 'idx_planning_design_check_work_bundle'),
      ).toBe(true);
    });

    it('인덱스가 4 컬럼 (project_id, work_bundle_key, status, user_decision) 순서로 land', () => {
      const cols = db
        .prepare(
          'PRAGMA index_info(idx_planning_design_check_work_bundle)',
        )
        .all() as Array<{ seqno: number; name: string }>;
      const sorted = [...cols].sort((a, b) => a.seqno - b.seqno);
      expect(sorted.map((c) => c.name)).toEqual([
        'project_id',
        'work_bundle_key',
        'status',
        'user_decision',
      ]);
    });

    it('테이블의 index_list 에 work_bundle 인덱스가 포함됨', () => {
      const indexes = db
        .prepare('PRAGMA index_list(planning_design_check)')
        .all() as Array<{ name: string }>;
      const names = indexes.map((r) => r.name);
      expect(names).toContain('idx_planning_design_check_work_bundle');
    });

    it('idx_planning_design_check_design_return_dispatch 인덱스 생성', () => {
      expect(
        indexExists(
          db,
          'idx_planning_design_check_design_return_dispatch',
        ),
      ).toBe(true);
    });
  });

  describe('026 forward-only 의존성', () => {
    it('027 만 단독 적용 시 ALTER TABLE 실패 (026 의 테이블이 없음)', () => {
      const isolated = new Database(':memory:');
      isolated.pragma('foreign_keys = ON');
      const only027 = migrations.filter(
        (m) => m.id === '027-planning-design-check-context',
      );
      expect(only027.length).toBe(1);
      expect(() => runMigrations(isolated, only027)).toThrow(
        /027-planning-design-check-context/,
      );
      isolated.close();
    });

    it('026 까지만 적용해도 통과 — 027 의 테이블 의존이 026 으로 충족됨', () => {
      const upTo026 = new Database(':memory:');
      upTo026.pragma('foreign_keys = ON');
      const chainUpTo026 = migrations.filter(
        (m) => m.id !== '027-planning-design-check-context',
      );
      expect(() => runMigrations(upTo026, chainUpTo026)).not.toThrow();
      // 이제 027 만 따로 적용 — 026 으로 생성된 테이블 위에서 통과해야 함.
      const only027 = migrations.filter(
        (m) => m.id === '027-planning-design-check-context',
      );
      expect(() => runMigrations(upTo026, only027)).not.toThrow();
      upTo026.close();
    });
  });

  describe('migrations tracking', () => {
    it('027 가 chain index 26 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain(
        '027-planning-design-check-context',
      );
      expect(
        rows.findIndex(
          (r) => r.id === '027-planning-design-check-context',
        ),
      ).toBe(26);
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (027 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(27);

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
