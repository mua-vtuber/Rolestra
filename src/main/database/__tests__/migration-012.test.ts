/**
 * Schema contract tests for v3 migration 012-circuit-breaker-state
 * (R10-Task9 — Circuit Breaker persistence).
 *
 * Coverage (per spec §10 Task 9 + Decision Log D10):
 * - Table + index creation: `circuit_breaker_state` + `idx_cbs_project`.
 * - PRIMARY KEY uniqueness on `(project_id, tripwire)`.
 * - `last_reset_at` accepts NULL.
 * - `last_updated_at` is NOT NULL.
 * - Idempotency: running migrations twice keeps the migrations row
 *   count stable AND a direct re-execution of the SQL is a no-op
 *   thanks to `IF NOT EXISTS` (defense-in-depth — D10 sells 012 as
 *   the only forward-only addition R10 ships).
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production
 * `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { migration as migration012 } from '../migrations/012-circuit-breaker-state';
import { indexExists, tableExists } from './_helpers';

describe('v3 migration 012-circuit-breaker-state — schema contract', () => {
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
    it('creates the circuit_breaker_state table', () => {
      expect(tableExists(db, 'circuit_breaker_state')).toBe(true);
    });

    it('creates the idx_cbs_project index', () => {
      expect(indexExists(db, 'idx_cbs_project')).toBe(true);
    });

    it('records 012 in the migrations tracking table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toContain('012-circuit-breaker-state');
      // R11-Task6 added 013-onboarding-state above 012; the assertion
      // moves from "012 is the last id" to "012 sits at index 11" so
      // future migrations can append without churning this test.
      expect(rows.findIndex((r) => r.id === '012-circuit-breaker-state')).toBe(
        11,
      );
    });
  });

  describe('column shape', () => {
    it('accepts an INSERT with all columns populated', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-1', 'files_per_turn', 5, 1_700_000_000_000, 1_700_000_000_000),
      ).not.toThrow();
    });

    it('accepts a NULL last_reset_at (the column is nullable)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-2', 'queue_streak', 0, null, 1_700_000_000_000),
      ).not.toThrow();

      const row = db
        .prepare(
          `SELECT last_reset_at FROM circuit_breaker_state WHERE project_id = ?`,
        )
        .get('proj-2') as { last_reset_at: number | null } | undefined;
      expect(row?.last_reset_at).toBeNull();
    });

    it('rejects a NULL last_updated_at (NOT NULL constraint)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-3', 'same_error', 0, 1_700_000_000_000, null),
      ).toThrow(/NOT NULL constraint failed/);
    });

    it('defaults counter to 0 when omitted', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('proj-default', 'files_per_turn', null, 1_700_000_000_000);
      const row = db
        .prepare(
          `SELECT counter FROM circuit_breaker_state WHERE project_id = ?`,
        )
        .get('proj-default') as { counter: number } | undefined;
      expect(row?.counter).toBe(0);
    });
  });

  describe('primary key uniqueness', () => {
    it('rejects a duplicate (project_id, tripwire) pair', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-pk', 'queue_streak', 1, null, 1_700_000_000_000);

      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-pk', 'queue_streak', 2, null, 1_700_000_000_001),
      ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    });

    it('accepts the same project_id with a different tripwire', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-pk2', 'queue_streak', 1, null, 1_700_000_000_000);

      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-pk2', 'same_error', 1, null, 1_700_000_000_000),
      ).not.toThrow();
    });

    it('accepts the same tripwire under a different project_id', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-A', 'files_per_turn', 1, null, 1_700_000_000_000);

      expect(() =>
        db
          .prepare(
            `INSERT INTO circuit_breaker_state
              (project_id, tripwire, counter, last_reset_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('proj-B', 'files_per_turn', 1, null, 1_700_000_000_000),
      ).not.toThrow();
    });
  });

  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (012 is skipped)', () => {
      const before = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(before).toBeGreaterThanOrEqual(12);

      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = (
        db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as {
          c: number;
        }
      ).c;
      expect(after).toBe(before);
    });

    it("re-running 012's SQL directly is a no-op (CREATE ... IF NOT EXISTS)", () => {
      // The migrator already skipped 012 above, so a direct exec is the
      // belt-and-braces case D10 calls out: 012 must be safe to apply
      // a second time even outside the tracking table's skip.
      expect(() => db.exec(migration012.sql)).not.toThrow();
      // The table should still be present and untouched.
      expect(tableExists(db, 'circuit_breaker_state')).toBe(true);
      expect(indexExists(db, 'idx_cbs_project')).toBe(true);
    });
  });
});
