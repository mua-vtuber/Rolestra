/**
 * Schema contract tests for v3 migration 014-llm-cost-audit-log
 * (R11-Task8 — LLM 비용 가시화).
 *
 * Coverage (per spec §10 Task 8 + Decision Log D4 + D5):
 * - Table + index creation: `llm_cost_audit_log` +
 *   `idx_llm_cost_audit_provider` + `idx_llm_cost_audit_meeting`.
 * - `id INTEGER PRIMARY KEY AUTOINCREMENT` — monotonic.
 * - Nullable `meeting_id` accepts NULL.
 * - `provider_id` NOT NULL.
 * - `token_in` / `token_out` CHECK >= 0.
 * - Idempotency: a second `runMigrations` is a no-op AND a direct
 *   re-execution of the SQL is harmless thanks to `IF NOT EXISTS`.
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production
 * `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { migration as migration014 } from '../migrations/014-llm-cost-audit-log';
import { indexExists, tableExists } from './_helpers';

describe('v3 migration 014-llm-cost-audit-log — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('creates the llm_cost_audit_log table', () => {
      expect(tableExists(db, 'llm_cost_audit_log')).toBe(true);
    });

    it('creates the idx_llm_cost_audit_provider index', () => {
      expect(indexExists(db, 'idx_llm_cost_audit_provider')).toBe(true);
    });

    it('creates the idx_llm_cost_audit_meeting index', () => {
      expect(indexExists(db, 'idx_llm_cost_audit_meeting')).toBe(true);
    });

    it('records 014 in the migrations tracking table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('014-llm-cost-audit-log');
      // 014 sits at index 13 (0-based) — after 013-onboarding-state.
      expect(rows.findIndex((r) => r.id === '014-llm-cost-audit-log')).toBe(13);
    });
  });

  describe('column shape', () => {
    it('accepts an INSERT with all columns populated', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO llm_cost_audit_log
              (meeting_id, provider_id, token_in, token_out, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('meeting-1', 'claude', 1234, 567, 1_700_000_000_000),
      ).not.toThrow();
    });

    it('accepts a NULL meeting_id (the column is nullable)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO llm_cost_audit_log
              (meeting_id, provider_id, token_in, token_out, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(null, 'claude', 100, 50, 1_700_000_000_000),
      ).not.toThrow();
      const row = db
        .prepare(
          `SELECT meeting_id FROM llm_cost_audit_log WHERE provider_id = ?`,
        )
        .get('claude') as { meeting_id: string | null } | undefined;
      expect(row?.meeting_id).toBeNull();
    });

    it('rejects a NULL provider_id (NOT NULL constraint)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO llm_cost_audit_log
              (meeting_id, provider_id, token_in, token_out, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('m', null, 1, 1, 1_700_000_000_000),
      ).toThrow(/NOT NULL constraint failed/);
    });

    it('rejects a negative token_in (CHECK >= 0)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO llm_cost_audit_log
              (meeting_id, provider_id, token_in, token_out, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(null, 'claude', -1, 0, 1_700_000_000_000),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects a negative token_out (CHECK >= 0)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO llm_cost_audit_log
              (meeting_id, provider_id, token_in, token_out, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(null, 'claude', 0, -1, 1_700_000_000_000),
      ).toThrow(/CHECK constraint failed/);
    });

    it('id is monotonically increasing across inserts', () => {
      const insert = db.prepare(
        `INSERT INTO llm_cost_audit_log
          (meeting_id, provider_id, token_in, token_out, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const r1 = insert.run('m1', 'p', 1, 1, 1);
      const r2 = insert.run('m2', 'p', 2, 2, 2);
      const r3 = insert.run(null, 'p', 3, 3, 3);
      expect(Number(r2.lastInsertRowid)).toBe(Number(r1.lastInsertRowid) + 1);
      expect(Number(r3.lastInsertRowid)).toBe(Number(r2.lastInsertRowid) + 1);
    });
  });

  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (014 is skipped)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(14);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(after).toBe(before);
    });

    it("re-running 014's SQL directly is a no-op (CREATE ... IF NOT EXISTS)", () => {
      expect(() => db.exec(migration014.sql)).not.toThrow();
      expect(tableExists(db, 'llm_cost_audit_log')).toBe(true);
      expect(indexExists(db, 'idx_llm_cost_audit_provider')).toBe(true);
      expect(indexExists(db, 'idx_llm_cost_audit_meeting')).toBe(true);
    });
  });
});
