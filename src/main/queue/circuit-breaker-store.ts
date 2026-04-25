/**
 * CircuitBreakerStore — R10-Task9 persistence layer for
 * {@link CircuitBreaker}.
 *
 * Responsibilities:
 *   Round-trip the four tripwire counters (`files_per_turn`,
 *   `cumulative_cli_ms`, `queue_streak`, `same_error`) between the
 *   in-memory `CircuitBreaker` and the `circuit_breaker_state` table
 *   shipped by migration 012. R9 only kept counters in memory, which
 *   leaked a meaningful amount of "is this autonomy run still safe?"
 *   state across app restarts. The store closes that gap.
 *
 * Three public methods, two write paths:
 *   - {@link hydrate}  — read every row, return a Map keyed by
 *                       `${projectId}:${tripwire}` so the caller
 *                       (`CircuitBreaker.hydrate`) can seed in-memory
 *                       counters in O(1) per tripwire lookup.
 *   - {@link flush}    — UPSERT a single (projectId, tripwire) row.
 *                       Debounced 1s per key — multiple `record*`
 *                       mutations within the window collapse into a
 *                       single write. The autonomy loop fires
 *                       `recordX` on a tight cadence (every CLI tick
 *                       for `cumulative_cli_ms`, every meeting end for
 *                       `queue_streak`); coalescing keeps SQLite write
 *                       traffic proportional to actual progress, not
 *                       to event volume.
 *   - {@link reset}    — UPSERT immediately (no debounce) with
 *                       `counter=0` and `last_reset_at=now`. Reset is
 *                       the user's "I reviewed the streak" gesture and
 *                       must not be lost to a pending debounce timer.
 *
 * Lifecycle:
 *   The store owns one `setTimeout` handle per outstanding key. A
 *   `dispose()` call (intended for clean shutdown / tests) flushes
 *   every pending write synchronously before clearing the timers, so
 *   a reset issued just before tear-down is safe.
 *
 * No I/O outside the SQL prepared statements; no async; no Node Date
 * fall-back — `Date.now()` is the single time source so tests can mock
 * it via the standard `vi.useFakeTimers()` route.
 *
 * The class is import-safe in non-Electron contexts (vitest specs) —
 * we accept any `better-sqlite3` `Database` handle directly, mirroring
 * `QueueRepository` (`src/main/queue/queue-repository.ts` line 73).
 */

import type Database from 'better-sqlite3';
import type {
  CircuitBreakerStateRecord,
  CircuitBreakerTripwire,
} from '../../shared/circuit-breaker-types';

/**
 * Subset of {@link CircuitBreakerStateRecord} the store hands back to
 * the breaker. We intentionally drop `projectId` / `tripwire` (already
 * in the map key) and `limit` (hydrate is a state read, the configured
 * limit lives in {@link DEFAULT_LIMITS} until the settings UI grows a
 * surface for it — see spec §10 Task 9 AC).
 */
export interface CircuitBreakerStoreSnapshot {
  counter: number;
  lastResetAt: number | null;
  lastUpdatedAt: number;
}

/**
 * Argument shape for {@link CircuitBreakerStore.flush}. Mirrors the
 * row except `last_updated_at` — the store stamps that itself so the
 * caller never has to resolve a timestamp inside the
 * `record*` hot path.
 */
export interface CircuitBreakerFlushInput {
  projectId: string;
  tripwire: CircuitBreakerTripwire;
  counter: number;
  lastResetAt: number | null;
}

/** Map key composition mirrors `CircuitBreaker`'s in-memory keying. */
function keyOf(projectId: string, tripwire: CircuitBreakerTripwire): string {
  return `${projectId}:${tripwire}`;
}

/** Default debounce window for `flush()` coalescing — 1 second. */
export const DEFAULT_FLUSH_DEBOUNCE_MS = 1000;

/**
 * Pending state for a single (projectId, tripwire) key kept while a
 * debounce timer is in flight. The timer's callback consumes this
 * struct exactly once, so there is no need for refcounts.
 */
interface PendingFlush {
  timer: ReturnType<typeof setTimeout>;
  input: CircuitBreakerFlushInput;
}

export class CircuitBreakerStore {
  private readonly database: Database.Database;
  private readonly debounceMs: number;

  /**
   * (projectId, tripwire) → pending flush state. Each entry holds the
   * latest `flush()` call's payload; subsequent `flush()` calls within
   * the window REPLACE the payload (we only care about the last
   * counter value) and reset the timer.
   */
  private pending = new Map<string, PendingFlush>();

  /**
   * Construct against a `better-sqlite3` handle. The store does not
   * own the handle — a single shared `getDatabase()` instance is
   * threaded through all repositories (see
   * `src/main/queue/queue-repository.ts` for the pattern).
   *
   * @param database  better-sqlite3 handle.
   * @param options.debounceMs  Override the 1s default (used by tests
   *   that want to assert the debounce window without sleeping).
   */
  constructor(
    database: Database.Database,
    options: { debounceMs?: number } = {},
  ) {
    this.database = database;
    this.debounceMs = options.debounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
  }

  /**
   * Read every row in `circuit_breaker_state` and return a Map keyed
   * by `${projectId}:${tripwire}`. `last_reset_at` may be NULL in the
   * DB (a row written by `flush()` before any `reset()` ran) and is
   * surfaced as `null` in the snapshot.
   */
  hydrate(): Map<string, CircuitBreakerStoreSnapshot> {
    const rows = this.database
      .prepare(
        `SELECT project_id, tripwire, counter, last_reset_at, last_updated_at
         FROM circuit_breaker_state`,
      )
      .all() as Array<{
      project_id: string;
      tripwire: CircuitBreakerTripwire;
      counter: number;
      last_reset_at: number | null;
      last_updated_at: number;
    }>;

    const out = new Map<string, CircuitBreakerStoreSnapshot>();
    for (const row of rows) {
      out.set(keyOf(row.project_id, row.tripwire), {
        counter: row.counter,
        lastResetAt: row.last_reset_at,
        lastUpdatedAt: row.last_updated_at,
      });
    }
    return out;
  }

  /**
   * Schedule (or re-schedule) a debounced UPSERT for the given
   * (projectId, tripwire) key. Multiple invocations within the
   * configured window collapse into a single write — the most recent
   * payload wins.
   */
  flush(input: CircuitBreakerFlushInput): void {
    const key = keyOf(input.projectId, input.tripwire);

    // Clear any in-flight timer for this key — we only ever want one
    // pending write per key. (`setTimeout` only, never `setInterval`,
    // per CLAUDE.md/Constraints.)
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      // The closure runs once; the entry is removed BEFORE the SQL
      // call so a subscriber that issues another `flush()` from
      // inside its own UPSERT trigger (none exist today, but we keep
      // the contract clean) can install a fresh timer without
      // racing against this one.
      const pending = this.pending.get(key);
      this.pending.delete(key);
      if (!pending) return;
      this.writeUpsert(pending.input);
    }, this.debounceMs);

    // Most platforms keep timers from blocking process exit; we mark
    // the timer as `unref` where supported so a long debounce window
    // doesn't pin the Electron event loop on shutdown. better-sqlite3
    // is synchronous so `dispose()` covers the graceful path; this is
    // a belt-and-braces guard for crash paths.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }

    this.pending.set(key, { timer, input });
  }

  /**
   * Immediate UPSERT — `counter=0`, `last_reset_at=now`. Used by
   * `CircuitBreaker.resetCounter` (R10-Task4) so the user's "I
   * reviewed the streak" gesture lands in the DB even if it arrives
   * faster than the debounce window. Cancels any pending flush for
   * the same key — the reset's counter=0 supersedes the in-flight
   * write.
   */
  reset(projectId: string, tripwire: CircuitBreakerTripwire): void {
    const key = keyOf(projectId, tripwire);
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
    }
    const now = Date.now();
    this.writeUpsert({
      projectId,
      tripwire,
      counter: 0,
      lastResetAt: now,
    });
  }

  /**
   * Flush every pending debounced write synchronously and clear the
   * timer table. Safe to call repeatedly. Intended for clean shutdown
   * (Electron `before-quit`) and test tear-down.
   */
  dispose(): void {
    // Snapshot keys so the iterator is stable while we mutate the map.
    const keys = Array.from(this.pending.keys());
    for (const key of keys) {
      const pending = this.pending.get(key);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(key);
      this.writeUpsert(pending.input);
    }
  }

  /**
   * Inspect a public snapshot for tests — returns the full row set as
   * an array of {@link CircuitBreakerStateRecord}-shaped objects. The
   * `limit` field is omitted because migration 012 does not store it
   * (per the user's explicit schema in the R10 task brief).
   */
  readAll(): Array<Omit<CircuitBreakerStateRecord, 'limit'>> {
    const rows = this.database
      .prepare(
        `SELECT project_id, tripwire, counter, last_reset_at, last_updated_at
         FROM circuit_breaker_state
         ORDER BY project_id, tripwire`,
      )
      .all() as Array<{
      project_id: string;
      tripwire: CircuitBreakerTripwire;
      counter: number;
      last_reset_at: number | null;
      last_updated_at: number;
    }>;
    return rows.map((row) => ({
      projectId: row.project_id,
      tripwire: row.tripwire,
      counter: row.counter,
      lastResetAt: row.last_reset_at ?? 0,
      lastUpdatedAt: row.last_updated_at,
    }));
  }

  // ── Private ───────────────────────────────────────────────────────

  /**
   * Single UPSERT path used by both `flush()` (debounced) and
   * `reset()` (immediate). `last_updated_at` is stamped here so the
   * caller never has to resolve a timestamp synchronously inside the
   * `record*` hot path.
   */
  private writeUpsert(input: CircuitBreakerFlushInput): void {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO circuit_breaker_state
           (project_id, tripwire, counter, last_reset_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, tripwire) DO UPDATE SET
           counter = excluded.counter,
           last_reset_at = excluded.last_reset_at,
           last_updated_at = excluded.last_updated_at`,
      )
      .run(
        input.projectId,
        input.tripwire,
        input.counter,
        input.lastResetAt,
        now,
      );
  }
}
