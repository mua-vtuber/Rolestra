/**
 * Schema contract tests for v3 migration 025-design-wireframe-checkpoint
 * (R12-C2 3차 디자인 와이어프레임 가벼운 확인).
 *
 * Coverage (양 테이블 design_checkpoint + design_checkpoint_preference):
 * - design_checkpoint 테이블 + 13 컬럼 + 2 인덱스
 * - design_checkpoint.kind CHECK ('wireframe') — 다른 값 거부
 * - design_checkpoint.status CHECK 4 종 enum
 * - FK CASCADE — project_id / meeting_id / channel_id
 * - design_checkpoint_preference 테이블 + 3 컬럼
 * - design_checkpoint_preference.wireframe_auto_skip CHECK (0|1)
 * - design_checkpoint_preference.project_id PRIMARY KEY + CASCADE
 * - 025 가 chain index 24 에 기록됨
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

interface CheckpointInsert {
  id?: string;
  projectId?: string;
  meetingId?: string;
  channelId?: string;
  kind?: string;
  status?: string;
  title?: string;
  documentPath?: string;
  documentBodySnapshot?: string;
  userNote?: string | null;
  payloadJson?: string | null;
  createdAt?: number;
  decidedAt?: number | null;
}

function insertCheckpoint(
  db: Database.Database,
  overrides: CheckpointInsert = {},
): string {
  const row = {
    id: 'cp-1',
    projectId: 'p1',
    meetingId: 'm-1',
    channelId: 'ch-design',
    kind: 'wireframe',
    status: 'pending',
    title: 'Wireframe checkpoint #1',
    documentPath: 'design/wireframe-1.md',
    documentBodySnapshot: '# wireframe\n...',
    userNote: null as string | null,
    payloadJson: null as string | null,
    createdAt: NOW,
    decidedAt: null as number | null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO design_checkpoint
       (id, project_id, meeting_id, channel_id, kind, status,
        title, document_path, document_body_snapshot,
        user_note, payload_json, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.projectId,
    row.meetingId,
    row.channelId,
    row.kind,
    row.status,
    row.title,
    row.documentPath,
    row.documentBodySnapshot,
    row.userNote,
    row.payloadJson,
    row.createdAt,
    row.decidedAt,
  );
  return row.id;
}

interface PreferenceInsert {
  projectId?: string;
  wireframeAutoSkip?: number;
  updatedAt?: number;
}

function insertPreference(
  db: Database.Database,
  overrides: PreferenceInsert = {},
): string {
  const row = {
    projectId: 'p1',
    wireframeAutoSkip: 0,
    updatedAt: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO design_checkpoint_preference
       (project_id, wireframe_auto_skip, updated_at)
     VALUES (?, ?, ?)`,
  ).run(row.projectId, row.wireframeAutoSkip, row.updatedAt);
  return row.projectId;
}

describe('v3 migration 025-design-wireframe-checkpoint — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'ch-design', 'p1');
    insertMeeting(db, 'm-1', 'ch-design');
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('design_checkpoint 테이블 생성', () => {
      expect(tableExists(db, 'design_checkpoint')).toBe(true);
    });

    it('design_checkpoint_preference 테이블 생성', () => {
      expect(tableExists(db, 'design_checkpoint_preference')).toBe(true);
    });

    it('design_checkpoint 인덱스 2 종 생성', () => {
      expect(indexExists(db, 'idx_design_checkpoint_project_meeting')).toBe(
        true,
      );
      expect(indexExists(db, 'idx_design_checkpoint_status')).toBe(true);
    });

    it('design_checkpoint 컬럼 13 종 모두 존재', () => {
      const cols = db
        .prepare('PRAGMA table_info(design_checkpoint)')
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(
        [
          'id',
          'project_id',
          'meeting_id',
          'channel_id',
          'kind',
          'status',
          'title',
          'document_path',
          'document_body_snapshot',
          'user_note',
          'payload_json',
          'created_at',
          'decided_at',
        ].sort(),
      );
    });

    it('design_checkpoint_preference 컬럼 3 종 모두 존재', () => {
      const cols = db
        .prepare('PRAGMA table_info(design_checkpoint_preference)')
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(
        ['project_id', 'wireframe_auto_skip', 'updated_at'].sort(),
      );
    });
  });

  describe('design_checkpoint.kind CHECK 제약', () => {
    it("accepts 'wireframe'", () => {
      expect(() => insertCheckpoint(db, { kind: 'wireframe' })).not.toThrow();
    });

    it("rejects unknown kind ('mockup')", () => {
      expect(() =>
        insertCheckpoint(db, { id: 'cp-bad-kind', kind: 'mockup' }),
      ).toThrow();
    });
  });

  describe('design_checkpoint.status CHECK 제약 — 4 종 enum', () => {
    it.each([
      'pending',
      'continued',
      'revision_requested',
      'auto_skipped',
    ])("accepts status '%s'", (status) => {
      expect(() =>
        insertCheckpoint(db, { id: `cp-${status}`, status }),
      ).not.toThrow();
    });

    it("rejects unknown status ('approved')", () => {
      expect(() =>
        insertCheckpoint(db, { id: 'cp-bad-status', status: 'approved' }),
      ).toThrow();
    });
  });

  describe('design_checkpoint FK 정책 — CASCADE', () => {
    it('project_id CASCADE — project 삭제 시 checkpoint 도 삭제', () => {
      insertCheckpoint(db, { id: 'cp-c1' });
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
      const row = db
        .prepare('SELECT id FROM design_checkpoint WHERE id = ?')
        .get('cp-c1');
      expect(row).toBeUndefined();
    });

    it('meeting_id CASCADE — meeting 삭제 시 checkpoint 도 삭제', () => {
      insertCheckpoint(db, { id: 'cp-c2' });
      db.prepare('DELETE FROM meetings WHERE id = ?').run('m-1');
      const row = db
        .prepare('SELECT id FROM design_checkpoint WHERE id = ?')
        .get('cp-c2');
      expect(row).toBeUndefined();
    });

    it('channel_id CASCADE — channel 삭제 시 checkpoint 도 삭제', () => {
      insertCheckpoint(db, { id: 'cp-c3' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-design');
      const row = db
        .prepare('SELECT id FROM design_checkpoint WHERE id = ?')
        .get('cp-c3');
      expect(row).toBeUndefined();
    });

    it('project_id 가 존재하지 않으면 FK 위반', () => {
      expect(() =>
        insertCheckpoint(db, { id: 'cp-no-pj', projectId: 'p-missing' }),
      ).toThrow();
    });
  });

  describe('design_checkpoint_preference', () => {
    it('insert 성공 + project_id PRIMARY KEY 동작 (중복 삽입 거부)', () => {
      insertPreference(db, { projectId: 'p1' });
      expect(() =>
        insertPreference(db, { projectId: 'p1' }),
      ).toThrow();
    });

    it('wireframe_auto_skip 0 / 1 모두 허용', () => {
      expect(() =>
        insertPreference(db, { projectId: 'p1', wireframeAutoSkip: 0 }),
      ).not.toThrow();
      // p1 row 정리 후 1 로 재삽입
      db.prepare(
        'DELETE FROM design_checkpoint_preference WHERE project_id = ?',
      ).run('p1');
      expect(() =>
        insertPreference(db, { projectId: 'p1', wireframeAutoSkip: 1 }),
      ).not.toThrow();
    });

    it('wireframe_auto_skip CHECK — 2 거부', () => {
      expect(() =>
        insertPreference(db, { projectId: 'p1', wireframeAutoSkip: 2 }),
      ).toThrow();
    });

    it('wireframe_auto_skip CHECK — -1 거부', () => {
      expect(() =>
        insertPreference(db, { projectId: 'p1', wireframeAutoSkip: -1 }),
      ).toThrow();
    });

    it('project_id CASCADE — project 삭제 시 preference 도 삭제', () => {
      insertPreference(db, { projectId: 'p1' });
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
      const row = db
        .prepare(
          'SELECT project_id FROM design_checkpoint_preference WHERE project_id = ?',
        )
        .get('p1');
      expect(row).toBeUndefined();
    });
  });

  describe('migrations tracking', () => {
    it('025 가 chain index 24 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain(
        '025-design-wireframe-checkpoint',
      );
      expect(
        rows.findIndex((r) => r.id === '025-design-wireframe-checkpoint'),
      ).toBe(24);
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (025 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(25);

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
