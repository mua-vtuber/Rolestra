/**
 * Schema contract tests for v3 migration 018-channels-role-purpose-handoff
 * (R12-C Task 1 + Task 18 통합 — 1 phase 1 마이그레이션).
 *
 * Coverage:
 * - channels.role TEXT NULL 추가
 * - channels.purpose TEXT NULL 추가
 * - channels.handoff_mode TEXT NOT NULL DEFAULT 'check' 추가
 * - channel_members.drag_order INTEGER NULL 추가
 * - providers.is_department_head TEXT NOT NULL DEFAULT '{}' 추가
 * - system_general 전역화: 가장 오래된 1개 row 만 project_id NULL 로 보존,
 *   나머지 DELETE
 * - 018 이 migrations tracking 표에 기록됨
 * - chain-level idempotency: 두 번째 runMigrations 는 no-op
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { insertProject, NOW } from './_helpers';

describe('v3 migration 018-channels-role-purpose-handoff — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('channels column shape', () => {
    it('adds role column nullable', () => {
      const cols = db
        .prepare('PRAGMA table_info(channels)')
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const role = cols.find((c) => c.name === 'role');
      expect(role).toBeDefined();
      expect(role?.notnull).toBe(0);
      expect(role?.dflt_value).toBeNull();
    });

    it('adds purpose column nullable', () => {
      const cols = db
        .prepare('PRAGMA table_info(channels)')
        .all() as Array<{ name: string; notnull: number }>;
      const purpose = cols.find((c) => c.name === 'purpose');
      expect(purpose).toBeDefined();
      expect(purpose?.notnull).toBe(0);
    });

    it('adds handoff_mode column NOT NULL DEFAULT check', () => {
      const cols = db
        .prepare('PRAGMA table_info(channels)')
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const mode = cols.find((c) => c.name === 'handoff_mode');
      expect(mode).toBeDefined();
      expect(mode?.notnull).toBe(1);
      expect(mode?.dflt_value).toBe("'check'");
    });
  });

  describe('channel_members column shape', () => {
    it('adds drag_order column nullable INTEGER', () => {
      const cols = db
        .prepare('PRAGMA table_info(channel_members)')
        .all() as Array<{ name: string; type: string; notnull: number }>;
      const dragOrder = cols.find((c) => c.name === 'drag_order');
      expect(dragOrder).toBeDefined();
      expect(dragOrder?.type).toBe('INTEGER');
      expect(dragOrder?.notnull).toBe(0);
    });
  });

  describe('providers column shape', () => {
    it('adds is_department_head column NOT NULL DEFAULT empty JSON object', () => {
      const cols = db
        .prepare('PRAGMA table_info(providers)')
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const isHead = cols.find((c) => c.name === 'is_department_head');
      expect(isHead).toBeDefined();
      expect(isHead?.notnull).toBe(1);
      expect(isHead?.dflt_value).toBe("'{}'");
    });
  });

  describe('default behavior on insert', () => {
    it('inserts new channel with handoff_mode = check when omitted', () => {
      insertProject(db, 'p1');
      db.prepare(
        `INSERT INTO channels (id, project_id, name, kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('c1', 'p1', 'test', 'user', NOW);
      const row = db
        .prepare(
          'SELECT handoff_mode, role, purpose FROM channels WHERE id = ?',
        )
        .get('c1') as { handoff_mode: string; role: string | null; purpose: string | null };
      expect(row.handoff_mode).toBe('check');
      expect(row.role).toBeNull();
      expect(row.purpose).toBeNull();
    });

    it('inserts new provider with is_department_head = empty JSON when omitted', () => {
      db.prepare(
        `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('pv1', 'Test', 'api', '{}', NOW, NOW);
      const row = db
        .prepare('SELECT is_department_head FROM providers WHERE id = ?')
        .get('pv1') as { is_department_head: string };
      expect(row.is_department_head).toBe('{}');
    });
  });

  describe('system_general consolidation', () => {
    it('keeps only the oldest system_general row with project_id NULL when 3 existed before', () => {
      // 017 까지만 적용된 별도 db 로 시뮬레이션 — 018 의 system_general 정리 로직 검증
      const partialDb = new Database(':memory:');
      partialDb.pragma('foreign_keys = ON');
      runMigrations(partialDb, migrations.slice(0, 17));

      insertProject(partialDb, 'p1');
      insertProject(partialDb, 'p2');
      insertProject(partialDb, 'p3');

      // seed 3 system_general rows with different created_at
      partialDb
        .prepare(
          `INSERT INTO channels (id, project_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('g1', 'p1', '일반', 'system_general', 1000);
      partialDb
        .prepare(
          `INSERT INTO channels (id, project_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('g2', 'p2', '일반', 'system_general', 2000);
      partialDb
        .prepare(
          `INSERT INTO channels (id, project_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('g3', 'p3', '일반', 'system_general', 3000);

      // 018 적용
      runMigrations(partialDb, migrations);

      const rows = partialDb
        .prepare(`SELECT id, project_id FROM channels WHERE kind = 'system_general' ORDER BY id`)
        .all() as Array<{ id: string; project_id: string | null }>;
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe('g1'); // 가장 오래된 created_at = 1000
      expect(rows[0].project_id).toBeNull();

      partialDb.close();
    });

    it('does nothing when no system_general rows exist before 018', () => {
      // beforeEach 의 db 가 이 시나리오 — system_general 없음 상태에서 마이그레이션 적용됨
      const rows = db
        .prepare(`SELECT id FROM channels WHERE kind = 'system_general'`)
        .all();
      expect(rows.length).toBe(0);
    });
  });

  describe('migrations tracking', () => {
    it('records 018 in the migrations table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('018-channels-role-purpose-handoff');
      expect(rows.findIndex((r) => r.id === '018-channels-role-purpose-handoff')).toBe(17);
    });
  });

  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (018 is skipped)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(before).toBeGreaterThanOrEqual(18);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(after).toBe(before);
    });
  });
});
