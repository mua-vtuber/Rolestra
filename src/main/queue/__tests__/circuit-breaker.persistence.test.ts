/**
 * Integration tests for {@link CircuitBreaker} ↔ {@link CircuitBreakerStore}
 * persistence (R10-Task9).
 *
 * Coverage:
 *   1. CircuitBreaker with store hydrates in-memory counters from the DB.
 *   2. recordX mutation triggers store.flush.
 *   3. resetCounter triggers store.reset.
 *   4. CircuitBreaker without store retains existing R9 behaviour
 *      (regression guard — no DB writes, no API surface change).
 *   5. Restart simulation: instance A flushes → fresh instance B
 *      against the same DB → hydrate restores the counters.
 *
 * The breaker's store hooks are wired through the same options
 * literal `main/index.ts` uses in production, so the assertions
 * mirror the R10 boot block end-to-end.
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
import { CircuitBreaker, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID } from '../circuit-breaker';
import {
  CircuitBreakerStore,
  DEFAULT_FLUSH_DEBOUNCE_MS,
} from '../circuit-breaker-store';

function readCounter(
  db: Database.Database,
  projectId: string,
  tripwire: string,
): number | null {
  const row = db
    .prepare(
      `SELECT counter FROM circuit_breaker_state
        WHERE project_id = ? AND tripwire = ?`,
    )
    .get(projectId, tripwire) as { counter: number } | undefined;
  return row ? row.counter : null;
}

describe('CircuitBreaker persistence integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. hydrate ────────────────────────────────────────────────────

  describe('hydrate', () => {
    it('seeds the in-memory counters from the DB on construction + hydrate()', () => {
      // Seed the persisted state directly so we can verify hydrate
      // pulls it back into memory.
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'files_per_turn', 12, null, 1000);
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'queue_streak', 3, null, 1000);

      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });
      expect(breaker.hydrate()).toBe(true);

      const state = breaker.getState();
      expect(state.filesChangedThisTurn).toBe(12);
      expect(state.consecutiveQueueRuns).toBe(3);
      // Untouched tripwires stay at their zero defaults.
      expect(state.cumulativeCliMs).toBe(0);
      expect(state.recentErrorCount).toBe(0);
    });

    it('returns false when no store is wired (regression guard)', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.hydrate()).toBe(false);
    });

    it('respects a custom projectId — only that project\'s rows are hydrated', () => {
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-A', 'files_per_turn', 5, null, 1000);
      db.prepare(
        `INSERT INTO circuit_breaker_state
          (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('proj-B', 'files_per_turn', 99, null, 1000);

      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store, projectId: 'proj-A' });
      breaker.hydrate();

      expect(breaker.getState().filesChangedThisTurn).toBe(5);
    });
  });

  // ── 2. mutation triggers flush ────────────────────────────────────

  describe('recordX → store.flush', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('recordFileChanges queues a debounced UPSERT', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      breaker.recordFileChanges(3);
      // Pre-debounce: nothing in DB yet.
      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'files_per_turn')).toBeNull();

      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);
      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'files_per_turn')).toBe(3);
    });

    it('recordCliElapsed queues a debounced UPSERT', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      breaker.recordCliElapsed(5000);
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'cumulative_cli_ms')).toBe(5000);
    });

    it('recordQueueStart queues a debounced UPSERT', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      breaker.recordQueueStart();
      breaker.recordQueueStart();
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'queue_streak')).toBe(2);
    });

    it('recordError queues a debounced UPSERT keyed by same_error', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      breaker.recordError('cat-A');
      breaker.recordError('cat-A');
      vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'same_error')).toBe(2);
    });
  });

  // ── 3. resetCounter triggers immediate store.reset ────────────────

  describe('resetCounter → store.reset', () => {
    it('writes counter=0 immediately (no debounce window)', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      // Force a non-zero counter via a record* call, then advance
      // timers so the flushed row exists.
      vi.useFakeTimers();
      try {
        breaker.recordQueueStart();
        breaker.recordQueueStart();
        vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);
        expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'queue_streak')).toBe(2);
      } finally {
        vi.useRealTimers();
      }

      breaker.resetCounter('queue_streak');
      // No timer advance — reset is synchronous.
      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'queue_streak')).toBe(0);
      expect(breaker.getState().consecutiveQueueRuns).toBe(0);
    });

    it('resetCounter for files_per_turn / cumulative_cli_ms / same_error all land in the DB', () => {
      const store = new CircuitBreakerStore(db);
      const breaker = new CircuitBreaker({ store });

      breaker.resetCounter('files_per_turn');
      breaker.resetCounter('cumulative_cli_ms');
      breaker.resetCounter('same_error');

      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'files_per_turn')).toBe(0);
      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'cumulative_cli_ms')).toBe(0);
      expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'same_error')).toBe(0);
    });
  });

  // ── 4. no store = R9 behaviour (regression guard) ─────────────────

  describe('without store (R9 behaviour preserved)', () => {
    it('record* does not write to the DB when no store is wired', () => {
      const breaker = new CircuitBreaker();

      breaker.recordFileChanges(5);
      breaker.recordQueueStart();
      breaker.recordCliElapsed(500);
      breaker.recordError('cat-X');

      // The shared DB has 012 in place but no rows should appear —
      // the breaker has no store DI.
      const count = (
        db.prepare('SELECT COUNT(*) AS c FROM circuit_breaker_state').get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(0);
    });

    it('resetCounter does not throw when no store is wired', () => {
      const breaker = new CircuitBreaker();
      expect(() => breaker.resetCounter('files_per_turn')).not.toThrow();
      expect(() => breaker.resetCounter('queue_streak')).not.toThrow();
      expect(() => breaker.resetCounter('cumulative_cli_ms')).not.toThrow();
      expect(() => breaker.resetCounter('same_error')).not.toThrow();
    });

    it('legacy 1-arg constructor still accepts a CircuitBreakerLimits literal', () => {
      const breaker = new CircuitBreaker({
        filesChangedPerTurn: 5,
        cumulativeCliMs: 1000,
        consecutiveQueueRuns: 2,
        sameErrorRepeats: 2,
      });
      // Threshold lowered to 5 — recording 6 must fire.
      let fired = 0;
      breaker.on('fired', (e) => {
        if (e.reason === 'files_per_turn') fired += 1;
      });
      breaker.recordFileChanges(6);
      expect(fired).toBe(1);
    });
  });

  // ── 5. restart simulation ─────────────────────────────────────────

  describe('restart simulation', () => {
    it('flushes counters from instance A → hydrate restores them on instance B', () => {
      vi.useFakeTimers();
      try {
        // Instance A — pre-restart.
        const storeA = new CircuitBreakerStore(db);
        const breakerA = new CircuitBreaker({ store: storeA });
        breakerA.hydrate();

        breakerA.recordFileChanges(8);
        breakerA.recordQueueStart();
        breakerA.recordQueueStart();
        breakerA.recordQueueStart();

        // Force the debounce window to elapse so the flushes land.
        vi.advanceTimersByTime(DEFAULT_FLUSH_DEBOUNCE_MS);

        // Sanity: the DB now holds the flushed rows.
        expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'files_per_turn')).toBe(8);
        expect(readCounter(db, CIRCUIT_BREAKER_GLOBAL_PROJECT_ID, 'queue_streak')).toBe(3);

        storeA.dispose();
        // Instance A is gone; the DB persists.

        // Instance B — fresh process simulation. Same DB handle is the
        // analogue of the `connection.ts` singleton surviving the
        // `BrowserWindow` reload (or, in production, the SQLite file
        // surviving the OS process restart).
        const storeB = new CircuitBreakerStore(db);
        const breakerB = new CircuitBreaker({ store: storeB });
        breakerB.hydrate();

        const state = breakerB.getState();
        expect(state.filesChangedThisTurn).toBe(8);
        expect(state.consecutiveQueueRuns).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
