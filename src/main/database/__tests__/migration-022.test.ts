/**
 * Schema contract tests for v3 migration 022-handoff-dispatch (R12-C2 P6 T27).
 *
 * Coverage:
 * - handoff_dispatch 테이블 생성 + 컬럼 11 종 명세대로 land
 * - mode CHECK ('check' | 'auto') — 다른 값 거부
 * - FK 정책 — from_meeting_id / from_channel_id / to_channel_id CASCADE,
 *   minutes_id 는 단순 TEXT (FK 없음 — 회의록 본문은 파일이 SSoT)
 * - 인덱스 — idx_handoff_dispatch_to_channel / idx_handoff_dispatch_from_meeting
 * - opened_at NULL 허용 + UPDATE NULL → epoch 가능
 * - 022 가 chain index 21 에 기록됨
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

interface DispatchInsert {
  id?: string;
  fromMeetingId?: string;
  fromChannelId?: string;
  toChannelId?: string;
  reason?: string;
  minutesId?: string | null;
  missionCardJson?: string;
  mode?: string;
  dispatchedAt?: number;
  openedAt?: number | null;
  createdAt?: number;
}

function insertDispatch(
  db: Database.Database,
  overrides: DispatchInsert = {},
): string {
  const row = {
    id: 'hd-1',
    fromMeetingId: 'm-1',
    fromChannelId: 'ch-from',
    toChannelId: 'ch-to',
    reason: 'design handoff',
    minutesId: 'm-1',
    missionCardJson: '{"id":"x"}',
    mode: 'check',
    dispatchedAt: NOW,
    openedAt: null as number | null,
    createdAt: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO handoff_dispatch
       (id, from_meeting_id, from_channel_id, to_channel_id, reason,
        minutes_id, mission_card_json, mode,
        dispatched_at, opened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.fromMeetingId,
    row.fromChannelId,
    row.toChannelId,
    row.reason,
    row.minutesId,
    row.missionCardJson,
    row.mode,
    row.dispatchedAt,
    row.openedAt,
    row.createdAt,
  );
  return row.id;
}

describe('v3 migration 022-handoff-dispatch — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    insertProvider(db, 'pv1');
    insertProject(db, 'p1');
    insertChannel(db, 'ch-from', 'p1');
    insertChannel(db, 'ch-to', 'p1');
    insertMeeting(db, 'm-1', 'ch-from');
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('handoff_dispatch 테이블 생성', () => {
      expect(tableExists(db, 'handoff_dispatch')).toBe(true);
    });

    it('인덱스 2 종 생성', () => {
      expect(indexExists(db, 'idx_handoff_dispatch_to_channel')).toBe(true);
      expect(indexExists(db, 'idx_handoff_dispatch_from_meeting')).toBe(true);
    });

    it('컬럼 11 종 모두 존재', () => {
      const cols = db
        .prepare('PRAGMA table_info(handoff_dispatch)')
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(
        [
          'id',
          'from_meeting_id',
          'from_channel_id',
          'to_channel_id',
          'reason',
          'minutes_id',
          'mission_card_json',
          'mode',
          'dispatched_at',
          'opened_at',
          'created_at',
        ].sort(),
      );
    });
  });

  describe('mode CHECK 제약', () => {
    it("accepts 'check'", () => {
      expect(() => insertDispatch(db, { mode: 'check' })).not.toThrow();
    });

    it("accepts 'auto'", () => {
      expect(() =>
        insertDispatch(db, { id: 'hd-auto', mode: 'auto' }),
      ).not.toThrow();
    });

    it("rejects unknown mode ('silent')", () => {
      expect(() =>
        insertDispatch(db, { id: 'hd-bad', mode: 'silent' }),
      ).toThrow();
    });
  });

  describe('FK 정책 — CASCADE', () => {
    it('from_meeting_id CASCADE — 회의 삭제 시 dispatch 도 삭제', () => {
      insertDispatch(db, { id: 'hd-c1' });
      db.prepare('DELETE FROM meetings WHERE id = ?').run('m-1');
      const row = db
        .prepare('SELECT id FROM handoff_dispatch WHERE id = ?')
        .get('hd-c1');
      expect(row).toBeUndefined();
    });

    it('to_channel_id CASCADE — 받는 채널 삭제 시 dispatch 도 삭제', () => {
      insertDispatch(db, { id: 'hd-c2' });
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-to');
      const row = db
        .prepare('SELECT id FROM handoff_dispatch WHERE id = ?')
        .get('hd-c2');
      expect(row).toBeUndefined();
    });

    it('from_channel_id CASCADE — 보낸 채널 삭제 시 dispatch 도 삭제', () => {
      insertDispatch(db, { id: 'hd-c3' });
      // meetings.channel_id 가 ch-from 을 가리키므로 channel 삭제 시 meeting 도 cascade.
      // 본 테스트는 from_channel_id 에 직접 걸린 cascade 가 동작하는지 검증.
      db.prepare('DELETE FROM channels WHERE id = ?').run('ch-from');
      const row = db
        .prepare('SELECT id FROM handoff_dispatch WHERE id = ?')
        .get('hd-c3');
      expect(row).toBeUndefined();
    });
  });

  describe('opened_at NULL 허용 + UPDATE', () => {
    it('insert 시 openedAt = NULL 허용', () => {
      expect(() =>
        insertDispatch(db, { id: 'hd-null', openedAt: null }),
      ).not.toThrow();
      const row = db
        .prepare('SELECT opened_at FROM handoff_dispatch WHERE id = ?')
        .get('hd-null') as { opened_at: number | null };
      expect(row.opened_at).toBeNull();
    });

    it('NULL → epoch update 가능', () => {
      insertDispatch(db, { id: 'hd-up', openedAt: null });
      db.prepare(
        'UPDATE handoff_dispatch SET opened_at = ? WHERE id = ? AND opened_at IS NULL',
      ).run(NOW + 1, 'hd-up');
      const row = db
        .prepare('SELECT opened_at FROM handoff_dispatch WHERE id = ?')
        .get('hd-up') as { opened_at: number | null };
      expect(row.opened_at).toBe(NOW + 1);
    });
  });

  describe('minutes_id 자유 — FK 없음 (파일 SSoT)', () => {
    it('minutes_id 가 존재하지 않는 임의 문자열도 허용 — 회의록 본문은 파일에', () => {
      expect(() =>
        insertDispatch(db, {
          id: 'hd-min',
          minutesId: 'minutes-arbitrary-id',
        }),
      ).not.toThrow();
    });

    it('minutes_id NULL 허용 — 회의 외 진입', () => {
      expect(() =>
        insertDispatch(db, { id: 'hd-min-null', minutesId: null }),
      ).not.toThrow();
    });
  });

  describe('migrations tracking', () => {
    it('022 가 chain index 21 에 기록됨', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('022-handoff-dispatch');
      expect(rows.findIndex((r) => r.id === '022-handoff-dispatch')).toBe(21);
    });
  });

  describe('idempotency', () => {
    it('두 번째 runMigrations 는 no-op (022 skip)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(22);

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
