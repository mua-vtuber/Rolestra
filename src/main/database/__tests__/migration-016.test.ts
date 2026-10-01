/**
 * Schema contract tests for v3 migration 016-meeting-paused-and-kind
 * (D-A T1 — 메시지 자동 회의 트리거 지원).
 *
 * Coverage (per plan 2026-04-29-rolestra-message-auto-meeting-trigger §1):
 * - `meetings.paused_at INTEGER DEFAULT NULL` 추가.
 * - `meetings.kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','auto'))` 추가.
 * - 기존 행은 paused_at = NULL, kind = 'manual' 로 채워짐.
 * - `idx_meetings_active_per_channel` 그대로 (`ended_at IS NULL`) — paused 도 active 로 계산.
 * - CHECK 제약: invalid kind 거부.
 * - 016 이 migrations tracking 표에 기록됨.
 * - chain-level idempotency: 두 번째 runMigrations 는 no-op.
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { indexExists, insertChannel, NOW } from './_helpers';

describe('v3 migration 016-meeting-paused-and-kind — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('column shape', () => {
    it('adds paused_at column with NULL default', () => {
      const cols = db
        .prepare('PRAGMA table_info(meetings)')
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const pausedAt = cols.find((c) => c.name === 'paused_at');
      expect(pausedAt).toBeDefined();
      expect(pausedAt?.dflt_value).toBeNull();
      expect(pausedAt?.notnull).toBe(0);
    });

    it('adds kind column with NOT NULL default manual', () => {
      const cols = db
        .prepare('PRAGMA table_info(meetings)')
        .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const kind = cols.find((c) => c.name === 'kind');
      expect(kind).toBeDefined();
      expect(kind?.dflt_value).toBe("'manual'");
      expect(kind?.notnull).toBe(1);
    });
  });

  describe('CHECK constraint on kind', () => {
    it('accepts kind = manual', () => {
      insertChannel(db, 'c1', null, 'dm');
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, topic, started_at, state, kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('m1', 'c1', 't', NOW, 'CONVERSATION', 'manual'),
      ).not.toThrow();
    });

    it('accepts kind = auto', () => {
      insertChannel(db, 'c1', null, 'dm');
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, topic, started_at, state, kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('m2', 'c1', 't', NOW, 'CONVERSATION', 'auto'),
      ).not.toThrow();
    });

    it('rejects an invalid kind value via CHECK', () => {
      insertChannel(db, 'c1', null, 'dm');
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, topic, started_at, state, kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('m1', 'c1', 't', NOW, 'CONVERSATION', 'invalid'),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  describe('default behavior on insert without explicit columns', () => {
    it('inserts with paused_at = NULL and kind = manual when omitted', () => {
      insertChannel(db, 'c1', null, 'dm');
      db.prepare(
        `INSERT INTO meetings (id, channel_id, topic, started_at, state)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('m1', 'c1', 't', NOW, 'CONVERSATION');
      const row = db
        .prepare(
          'SELECT paused_at, kind FROM meetings WHERE id = ?',
        )
        .get('m1') as { paused_at: number | null; kind: string };
      expect(row.paused_at).toBeNull();
      expect(row.kind).toBe('manual');
    });
  });

  describe('active meeting partial unique index unchanged', () => {
    it('still rejects two active meetings on the same channel even when one is paused', () => {
      insertChannel(db, 'c1', null, 'dm');
      db.prepare(
        `INSERT INTO meetings (id, channel_id, topic, started_at, state, paused_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('m1', 'c1', 't', NOW, 'CONVERSATION', NOW + 1);
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, topic, started_at, state)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('m2', 'c1', 't', NOW + 2, 'CONVERSATION'),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it('idx_meetings_active_per_channel index is still present', () => {
      expect(indexExists(db, 'idx_meetings_active_per_channel')).toBe(true);
    });
  });

  describe('migrations tracking', () => {
    it('records 016 in the migrations table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('016-meeting-paused-and-kind');
      expect(rows.findIndex((r) => r.id === '016-meeting-paused-and-kind')).toBe(15);
    });
  });

  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (016 is skipped)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(before).toBeGreaterThanOrEqual(16);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
      ).c;
      expect(after).toBe(before);
    });
  });
});
