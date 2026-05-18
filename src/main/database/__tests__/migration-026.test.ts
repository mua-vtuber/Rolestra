/**
 * Schema contract tests for v3 migration 026-planning-design-check (R12-C2 4차).
 *
 * Coverage:
 * - planning_design_check 테이블 생성 + 컬럼 명세대로 land
 * - status / verdict CHECK enum 멤버 정확
 * - return_count >= 0 CHECK 강제
 * - FK 정책 — project_id / source_design_meeting_id / design_channel_id /
 *   planning_channel_id 는 CASCADE, implementation_channel_id 는 SET NULL
 * - 인덱스 3 종 (project_status / design_meeting / return_scope) 생성
 * - 026 가 chain index 25 에 기록됨
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
  tableExists,
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
  snapshotDesktopPath?: string | null;
  snapshotMobilePath?: string | null;
  wireframeCheckpointsJson?: string;
  wireframeUserNotesJson?: string;
  returnCount?: number;
  verdict?: string | null;
  status?: string;
  reason?: string | null;
  revisionDirection?: string | null;
  implementationDispatchId?: string | null;
  designReturnDispatchId?: string | null;
  payloadJson?: string | null;
  createdAt?: number;
  decidedAt?: number | null;
}

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
    implementationChannelId: 'ch-impl' as string | null,
    requestTitle: 'Design review request',
    requestBody: 'body',
    finalDesignMinutesPath: '/arena/minutes/m-design-1.md',
    finalDesignMinutesBody: '[합의]\n- A',
    snapshotDesktopPath: null as string | null,
    snapshotMobilePath: null as string | null,
    wireframeCheckpointsJson: '[]',
    wireframeUserNotesJson: '[]',
    returnCount: 0,
    verdict: null as string | null,
    status: 'request_created',
    reason: null as string | null,
    revisionDirection: null as string | null,
    implementationDispatchId: null as string | null,
    designReturnDispatchId: null as string | null,
    payloadJson: null as string | null,
    createdAt: NOW,
    decidedAt: null as number | null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO planning_design_check
       (id, project_id, source_design_meeting_id, design_channel_id,
        design_channel_role, planning_channel_id, implementation_channel_id,
        request_title, request_body, final_design_minutes_path,
        final_design_minutes_body, snapshot_desktop_path, snapshot_mobile_path,
        wireframe_checkpoints_json, wireframe_user_notes_json, return_count,
        verdict, status, reason, revision_direction,
        implementation_dispatch_id, design_return_dispatch_id, payload_json,
        created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    row.snapshotDesktopPath,
    row.snapshotMobilePath,
    row.wireframeCheckpointsJson,
    row.wireframeUserNotesJson,
    row.returnCount,
    row.verdict,
    row.status,
    row.reason,
    row.revisionDirection,
    row.implementationDispatchId,
    row.designReturnDispatchId,
    row.payloadJson,
    row.createdAt,
    row.decidedAt,
  );
  return row.id;
}

describe('v3 migration 026-planning-design-check — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'ch-design', 'p1');
    insertChannel(db, 'ch-planning', 'p1');
    insertChannel(db, 'ch-impl', 'p1');
    insertMeeting(db, 'm-design-1', 'ch-design');
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('planning_design_check 테이블 생성', () => {
      expect(tableExists(db, 'planning_design_check')).toBe(true);
    });

    it('인덱스 3 종 생성', () => {
      expect(indexExists(db, 'idx_planning_design_check_project_status')).toBe(
        true,
      );
      expect(indexExists(db, 'idx_planning_design_check_design_meeting')).toBe(
        true,
      );
      expect(indexExists(db, 'idx_planning_design_check_return_scope')).toBe(
        true,
      );
    });

    it('컬럼 24 종 모두 존재 (027 적용 후 컬럼 추가 검증은 027 테스트에서)', () => {
      const cols = db
        .prepare('PRAGMA table_info(planning_design_check)')
        .all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      const expected = [
        'id',
        'project_id',
        'source_design_meeting_id',
        'design_channel_id',
        'design_channel_role',
        'planning_channel_id',
        'implementation_channel_id',
        'request_title',
        'request_body',
        'final_design_minutes_path',
        'final_design_minutes_body',
        'snapshot_desktop_path',
        'snapshot_mobile_path',
        'wireframe_checkpoints_json',
        'wireframe_user_notes_json',
        'return_count',
        'verdict',
        'status',
        'reason',
        'revision_direction',
        'implementation_dispatch_id',
        'design_return_dispatch_id',
        'payload_json',
        'created_at',
        'decided_at',
      ];
      for (const col of expected) {
        expect(names.has(col)).toBe(true);
      }
    });
  });

  describe('status CHECK 제약', () => {
    it("accepts 'request_created'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-rc', status: 'request_created' }),
      ).not.toThrow();
    });

    it("accepts 'aligned'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-al', status: 'aligned' }),
      ).not.toThrow();
    });

    it("accepts 'returned_to_design'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-rd', status: 'returned_to_design' }),
      ).not.toThrow();
    });

    it("accepts 'needs_user_decision'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-nu', status: 'needs_user_decision' }),
      ).not.toThrow();
    });

    it("rejects unknown status ('completed')", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-bad', status: 'completed' }),
      ).toThrow();
    });
  });

  describe('verdict CHECK 제약', () => {
    it('accepts NULL (디폴트)', () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-v-null', verdict: null }),
      ).not.toThrow();
    });

    it("accepts 'aligned'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-v-al', verdict: 'aligned' }),
      ).not.toThrow();
    });

    it("accepts 'misaligned'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-v-mi', verdict: 'misaligned' }),
      ).not.toThrow();
    });

    it("accepts 'needs_user_decision'", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-v-nu', verdict: 'needs_user_decision' }),
      ).not.toThrow();
    });

    it("rejects unknown verdict ('unsure')", () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-v-bad', verdict: 'unsure' }),
      ).toThrow();
    });
  });

  describe('return_count CHECK 제약', () => {
    it('accepts 0', () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-rc-0', returnCount: 0 }),
      ).not.toThrow();
    });

    it('accepts positive integer', () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-rc-3', returnCount: 3 }),
      ).not.toThrow();
    });

    it('rejects negative integer', () => {
      expect(() =>
        insertCheck(db, { id: 'pdc-rc-neg', returnCount: -1 }),
      ).toThrow();
    });
  });

  describe('FK 정책', () => {
    it('project_id CASCADE — 프로젝트 삭제 시 row 삭제', () => {
      insertCheck(db, { id: 'pdc-fk-1' });
      // FK CASCADE: deleting the project removes meetings/channels first.
      // Use raw DELETE on planning_design_check via project cascade.
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
      const row = db
        .prepare('SELECT id FROM planning_design_check WHERE id = ?')
        .get('pdc-fk-1');
      expect(row).toBeUndefined();
    });

    it('source_design_meeting_id CASCADE — 회의 삭제 시 row 삭제', () => {
      insertCheck(db, { id: 'pdc-fk-2' });
      db.prepare('DELETE FROM meetings WHERE id = ?').run('m-design-1');
      const row = db
        .prepare('SELECT id FROM planning_design_check WHERE id = ?')
        .get('pdc-fk-2');
      expect(row).toBeUndefined();
    });

    it('planning_channel_id CASCADE — 기획 채널 삭제 시 row 삭제', () => {
      insertCheck(db, { id: 'pdc-fk-3' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-planning');
      const row = db
        .prepare('SELECT id FROM planning_design_check WHERE id = ?')
        .get('pdc-fk-3');
      expect(row).toBeUndefined();
    });

    it('implementation_channel_id SET NULL — 구현 채널 삭제 시 row 보존', () => {
      insertCheck(db, { id: 'pdc-fk-4' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-impl');
      const row = db
        .prepare(
          'SELECT implementation_channel_id FROM planning_design_check WHERE id = ?',
        )
        .get('pdc-fk-4') as { implementation_channel_id: string | null };
      expect(row).toBeDefined();
      expect(row.implementation_channel_id).toBeNull();
    });

    it('implementation_channel_id NULL 허용 — 구현 채널 미지정', () => {
      expect(() =>
        insertCheck(db, {
          id: 'pdc-fk-null',
          implementationChannelId: null,
        }),
      ).not.toThrow();
    });
  });

  describe('migrations tracking', () => {
    it('026 가 chain index 25 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('026-planning-design-check');
      expect(
        rows.findIndex((r) => r.id === '026-planning-design-check'),
      ).toBe(25);
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (026 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(26);

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
