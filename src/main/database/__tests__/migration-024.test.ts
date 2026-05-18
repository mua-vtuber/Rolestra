/**
 * Schema contract tests for v3 migration 024-meeting-review-gate (R12-C2).
 *
 * Coverage:
 * - meeting_review_gate 테이블 + 14 컬럼 명세대로 land
 * - kind CHECK ('planning_minutes') — 다른 값 거부
 * - status CHECK 5 종 enum — 정확한 멤버만 통과
 * - FK 정책 — project_id / meeting_id / source_channel_id CASCADE,
 *   target_channel_id SET NULL
 * - 인덱스 2 종 — idx_meeting_review_gate_project_status,
 *   idx_meeting_review_gate_meeting
 * - 024 가 chain index 23 에 기록됨
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

interface GateInsert {
  id?: string;
  projectId?: string;
  meetingId?: string;
  sourceChannelId?: string;
  targetChannelId?: string | null;
  targetRole?: string | null;
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

function insertGate(
  db: Database.Database,
  overrides: GateInsert = {},
): string {
  const row = {
    id: 'g-1',
    projectId: 'p1',
    meetingId: 'm-1',
    sourceChannelId: 'ch-src',
    targetChannelId: 'ch-tgt' as string | null,
    targetRole: 'planning' as string | null,
    kind: 'planning_minutes',
    status: 'pending',
    title: 'Planning minutes #1',
    documentPath: 'consensus/meetings/m-1/minutes.md',
    documentBodySnapshot: '# minutes\n[합의] ...',
    userNote: null as string | null,
    payloadJson: null as string | null,
    createdAt: NOW,
    decidedAt: null as number | null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO meeting_review_gate
       (id, project_id, meeting_id, source_channel_id, target_channel_id,
        target_role, kind, status, title, document_path,
        document_body_snapshot, user_note, payload_json,
        created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.projectId,
    row.meetingId,
    row.sourceChannelId,
    row.targetChannelId,
    row.targetRole,
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

describe('v3 migration 024-meeting-review-gate — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'ch-src', 'p1');
    insertChannel(db, 'ch-tgt', 'p1');
    insertMeeting(db, 'm-1', 'ch-src');
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('meeting_review_gate 테이블 생성', () => {
      expect(tableExists(db, 'meeting_review_gate')).toBe(true);
    });

    it('인덱스 2 종 생성', () => {
      expect(indexExists(db, 'idx_meeting_review_gate_project_status')).toBe(
        true,
      );
      expect(indexExists(db, 'idx_meeting_review_gate_meeting')).toBe(true);
    });

    it('컬럼 15 종 모두 존재', () => {
      const cols = db
        .prepare('PRAGMA table_info(meeting_review_gate)')
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(
        [
          'id',
          'project_id',
          'meeting_id',
          'source_channel_id',
          'target_channel_id',
          'target_role',
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
  });

  describe('kind CHECK 제약', () => {
    it("accepts 'planning_minutes'", () => {
      expect(() =>
        insertGate(db, { kind: 'planning_minutes' }),
      ).not.toThrow();
    });

    it("rejects unknown kind ('design_review')", () => {
      expect(() =>
        insertGate(db, { id: 'g-bad-kind', kind: 'design_review' }),
      ).toThrow();
    });
  });

  describe('status CHECK 제약 — 5 종 enum', () => {
    it.each([
      'pending',
      'approved',
      'revision_requested',
      'restart_requested',
      'stopped',
    ])("accepts status '%s'", (status) => {
      expect(() =>
        insertGate(db, { id: `g-${status}`, status }),
      ).not.toThrow();
    });

    it("rejects unknown status ('rejected')", () => {
      expect(() =>
        insertGate(db, { id: 'g-bad-status', status: 'rejected' }),
      ).toThrow();
    });

    it("rejects empty status ''", () => {
      expect(() =>
        insertGate(db, { id: 'g-empty-status', status: '' }),
      ).toThrow();
    });
  });

  describe('FK 정책', () => {
    it('project_id CASCADE — project 삭제 시 gate 도 삭제', () => {
      insertGate(db, { id: 'g-c1' });
      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
      const row = db
        .prepare('SELECT id FROM meeting_review_gate WHERE id = ?')
        .get('g-c1');
      expect(row).toBeUndefined();
    });

    it('meeting_id CASCADE — meeting 삭제 시 gate 도 삭제', () => {
      insertGate(db, { id: 'g-c2' });
      db.prepare('DELETE FROM meetings WHERE id = ?').run('m-1');
      const row = db
        .prepare('SELECT id FROM meeting_review_gate WHERE id = ?')
        .get('g-c2');
      expect(row).toBeUndefined();
    });

    it('source_channel_id CASCADE — 출처 채널 삭제 시 gate 도 삭제', () => {
      insertGate(db, { id: 'g-c3' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-src');
      const row = db
        .prepare('SELECT id FROM meeting_review_gate WHERE id = ?')
        .get('g-c3');
      expect(row).toBeUndefined();
    });

    it('target_channel_id SET NULL — 대상 채널 삭제 시 gate 는 보존 + target_channel_id NULL', () => {
      insertGate(db, { id: 'g-c4', targetChannelId: 'ch-tgt' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-tgt');
      const row = db
        .prepare(
          'SELECT id, target_channel_id FROM meeting_review_gate WHERE id = ?',
        )
        .get('g-c4') as
        | { id: string; target_channel_id: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.target_channel_id).toBeNull();
    });

    it('target_channel_id NULL 허용 — 인계 대상 미지정', () => {
      expect(() =>
        insertGate(db, { id: 'g-tgt-null', targetChannelId: null }),
      ).not.toThrow();
    });

    it('project_id 가 존재하지 않으면 FK 위반', () => {
      expect(() =>
        insertGate(db, { id: 'g-no-pj', projectId: 'p-missing' }),
      ).toThrow();
    });
  });

  describe('NULL 허용 컬럼', () => {
    it('user_note / payload_json / decided_at NULL 허용', () => {
      expect(() =>
        insertGate(db, {
          id: 'g-null',
          userNote: null,
          payloadJson: null,
          decidedAt: null,
        }),
      ).not.toThrow();
    });

    it('decided_at 을 NULL → epoch 로 update 가능', () => {
      insertGate(db, { id: 'g-up', decidedAt: null });
      db.prepare(
        'UPDATE meeting_review_gate SET decided_at = ?, status = ? WHERE id = ? AND decided_at IS NULL',
      ).run(NOW + 1, 'approved', 'g-up');
      const row = db
        .prepare(
          'SELECT decided_at, status FROM meeting_review_gate WHERE id = ?',
        )
        .get('g-up') as { decided_at: number | null; status: string };
      expect(row.decided_at).toBe(NOW + 1);
      expect(row.status).toBe('approved');
    });
  });

  describe('migrations tracking', () => {
    it('024 가 chain index 23 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('024-meeting-review-gate');
      expect(
        rows.findIndex((r) => r.id === '024-meeting-review-gate'),
      ).toBe(23);
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (024 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(24);

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
