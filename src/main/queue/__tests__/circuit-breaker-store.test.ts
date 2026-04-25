/**
 * Unit tests for {@link CircuitBreakerStore} (R10-Task9).
 *
 * Coverage:
 *   1. hydrate returns rows from a seeded DB.
 *   2. flush UPSERT (insert new row + update existing).
 *   3. flush is debounced — multiple calls within 1s collapse to a
 *      single write.
 *   4. reset writes immediately + resets counter to 0 with
 *      last_reset_at populated.
 *   5. dispose cancels pending timers + flushes synchronously.
 *
 * Uses an in-memory better-sqlite3 DB seeded by the full migration
 * chain so 012 is in place before any store call.
 */

import Database from 'better-sqlite3';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import {
  CircuitBreakerStore,
  DEFAULT_FLUSH_DEBOUNCE_MS,
} from '../circuit-breaker-store';

function rowCount(db: Database.Database): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS c FROM circuit_breaker_state')
      .get() as { c: number }
  ).c;
}

function readRow(
  db: Database.Database,
  projectId: string,
  tripwire: string,
): { counter: number; last_reset_at: number | null; last_updated_at: number } | undefined {
  return db
    .prepare(
      `SELECT counter, last_reset_at, last_updated_at
         FROM circuit_breaker_state
        WHERE project_id = ? AND tripwire = ?`,
    )
    .get(projectId, tripwire) as
    | { counter: number; last_reset_at: number | null; last_updated_at: number }
    | undefined;
}

describe('CircuitBreakerStore', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  // ── hydrate ────────────────────────────────────────────────────────

  describe('hydrate', () => {
    it('returns an empty Map when the table has no rows', () => {
      const store = new CircuitBreakerStore(db);
      const map = store.hydrate();
      expect(map.size).toBe(0);
    });

    it('returns rows from a seeded DB keyed by `${projectId}:${tripwire}`', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-A', 'files_per_turn', 7, 1000, 2000);
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-A', 'queue_streak', 3, null, 2500);

      const store = new CircuitBreakerStore(db);
      const map = store.hydrate();

      expect(map.size).toBe(2);
      expect(map.get('proj-A:files_per_turn')).toEqual({
        counter: 7,
        lastResetAt: 1000,
        lastUpdatedAt: 2000,
      });
      expect(map.get('proj-A:queue_streak')).toEqual({
        counter: 3,
        lastResetAt: null,
        lastUpdatedAt: 2500,
      });
    });
  });

  // ── flush UPSERT ──────────────────────────────────────────────────

  describe('flush', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('inserts a new row when none exists for the (projectId, tripwire) key', () => {
      const store = new CircuitBreakerStore(db);
      store.flush({
        projectId: 'proj-1',
        tripwire: 'files_per_turn',
        counter: 5,
        lastResetAt: null,
      });

      // Pre-debounce: no row yet.
      expect(rowCount(db)).toBe(0);

      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      const row = readRow(db, 'proj-1', 'files_per_turn');
      expect(row).toBeDefined();
      expect(row?.counter).toBe(5);
      expect(row?.last_reset_at).toBeNull();
      expect(row?.last_updated_at).toBeGreaterThan(0);
    });

    it('updates an existing row on subsequent flush() with the same key', () => {
      const store = new CircuitBreakerStore(db);

      store.flush({
        projectId: 'proj-1',
        tripwire: 'queue_streak',
        counter: 1,
        lastResetAt: null,
      });
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      store.flush({
        projectId: 'proj-1',
        tripwire: 'queue_streak',
        counter: 4,
        lastResetAt: 9999,
      });
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      const row = readRow(db, 'proj-1', 'queue_streak');
      expect(row?.counter).toBe(4);
      expect(row?.last_reset_at).toBe(9999);
      // Still exactly one row for this key.
      expect(rowCount(db)).toBe(1);
    });

    it('debounces — multiple calls within the window collapse to a single write', () => {
      const store = new CircuitBreakerStore(db);

      store.flush({
        projectId: 'proj-1',
        tripwire: 'cumulative_cli_ms',
        counter: 100,
        lastResetAt: null,
      });
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS / 2);
      store.flush({
        projectId: 'proj-1',
        tripwire: 'cumulative_cli_ms',
        counter: 200,
        lastResetAt: null,
      });
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS / 2);
      // Window not yet elapsed since last flush — still no row.
      expect(rowCount(db)).toBe(0);

      // Cross the window from the LATEST flush call.
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS / 2);

      const row = readRow(db, 'proj-1', 'cumulative_cli_ms');
      expect(row).toBeDefined();
      // Only the LATEST counter survived (200, not 100).
      expect(row?.counter).toBe(200);
      expect(rowCount(db)).toBe(1);
    });

    it('debounces independently per (projectId, tripwire) key', () => {
      const store = new CircuitBreakerStore(db);

      store.flush({
        projectId: 'proj-A',
        tripwire: 'files_per_turn',
        counter: 1,
        lastResetAt: null,
      });
      store.flush({
        projectId: 'proj-A',
        tripwire: 'queue_streak',
        counter: 2,
        lastResetAt: null,
      });
      store.flush({
        projectId: 'proj-B',
        tripwire: 'files_per_turn',
        counter: 3,
        lastResetAt: null,
      });

      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      expect(rowCount(db)).toBe(3);
      expect(readRow(db, 'proj-A', 'files_per_turn')?.counter).toBe(1);
      expect(readRow(db, 'proj-A', 'queue_streak')?.counter).toBe(2);
      expect(readRow(db, 'proj-B', 'files_per_turn')?.counter).toBe(3);
    });

    it('uses the configured override debounceMs when provided', () => {
      const store = new CircuitBreakerStore(db, { debounceMs: 100 });

      store.flush({
        projectId: 'proj-fast',
        tripwire: 'same_error',
        counter: 1,
        lastResetAt: null,
      });

      vi.advanceTimersByTime(99);
      expect(rowCount(db)).toBe(0);

      vi.advanceTimersByTime(1);
      expect(rowCount(db)).toBe(1);
    });
  });

  // ── reset (immediate) ─────────────────────────────────────────────

  describe('reset', () => {
    it('writes immediately with counter=0 and last_reset_at set to now', () => {
      const store = new CircuitBreakerStore(db);
      const before = Date.now();
      store.reset('proj-1', 'queue_streak');
      const after = Date.now();

      const row = readRow(db, 'proj-1', 'queue_streak');
      expect(row).toBeDefined();
      expect(row?.counter).toBe(0);
      expect(row?.last_reset_at).not.toBeNull();
      expect(row!.last_reset_at!).toBeGreaterThanOrEqual(before);
      expect(row!.last_reset_at!).toBeLessThanOrEqual(after);
    });

    it('updates an existing row in place when one exists for the key', () => {
      const store = new CircuitBreakerStore(db);
      // Seed a non-zero row directly.
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-1', 'same_error', 9, 1, 2);

      store.reset('proj-1', 'same_error');

      expect(rowCount(db)).toBe(1);
      const row = readRow(db, 'proj-1', 'same_error');
      expect(row?.counter).toBe(0);
      expect(row?.last_reset_at).not.toBe(1);
    });

    it('cancels any pending debounced flush for the same key', () => {
      vi.useFakeTimers();
      try {
        const store = new CircuitBreakerStore(db);
        store.flush({
          projectId: 'proj-1',
          tripwire: 'files_per_turn',
          counter: 99,
          lastResetAt: null,
        });
        // Reset before the debounce window elapses — the pending
        // flush MUST be discarded.
        store.reset('proj-1', 'files_per_turn');
        vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS * 2);

        const row = readRow(db, 'proj-1', 'files_per_turn');
        expect(row?.counter).toBe(0);
        expect(rowCount(db)).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── dispose ───────────────────────────────────────────────────────

  describe('dispose', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('flushes any pending writes synchronously', () => {
      const store = new CircuitBreakerStore(db);
      store.flush({
        projectId: 'proj-1',
        tripwire: 'queue_streak',
        counter: 7,
        lastResetAt: null,
      });

      // Pre-dispose: still buffered.
      expect(rowCount(db)).toBe(0);

      store.dispose();

      const row = readRow(db, 'proj-1', 'queue_streak');
      expect(row?.counter).toBe(7);
    });

    it('clears pending timers — advancing time after dispose writes nothing extra', () => {
      const store = new CircuitBreakerStore(db);
      store.flush({
        projectId: 'proj-1',
        tripwire: 'queue_streak',
        counter: 7,
        lastResetAt: null,
      });

      store.dispose();
      const after = rowCount(db);

      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS * 5);
      expect(rowCount(db)).toBe(after);
    });

    it('is safe to call multiple times', () => {
      const store = new CircuitBreakerStore(db);
      expect(() => {
        store.dispose();
        store.dispose();
      }).not.toThrow();
    });
  });
});
