/**
 * CircuitBreaker — 4 autonomy-loop safety tripwires (spec §8 CB-5, CD-2).
 *
 * Responsibilities:
 *   Track four independent counters that, when exceeded, fire a `'fired'`
 *   event with a `{reason, detail}` payload. The caller (Task 16 +
 *   onwards) is responsible for the downgrade action — switching the
 *   project to `manual` autonomy, inserting an `approval_item`, notifying
 *   the user — but this module decides WHEN.
 *
 * The four tripwires and their reset behaviour:
 *   1. `files_per_turn`      — accumulates via `recordFileChanges(n)`
 *                              across a single agent turn. Reset with
 *                              `resetTurn()` at the next turn boundary.
 *   2. `cumulative_cli_ms`   — accumulates via `recordCliElapsed(ms)`
 *                              for the lifetime of the process. No
 *                              automatic reset — the user's approval
 *                              explicitly clears the counter elsewhere.
 *   3. `queue_streak`        — counts `recordQueueStart()` calls. Reset
 *                              when the user taps "continue"
 *                              (`confirmContinue()`), which declares
 *                              they reviewed the streak.
 *   4. `same_error`          — counts consecutive identical error
 *                              categories via `recordError(cat)`. A
 *                              different category resets the counter to
 *                              1 (the new category). `clearError()`
 *                              explicitly zeroes both.
 *
 * Fire-once semantics (spec §8 CB-5):
 *   Each tripwire fires at the moment the threshold is crossed. Further
 *   `recordX` calls AFTER the fire do NOT re-fire until the corresponding
 *   reset (resetTurn / confirmContinue / clearError) runs. This prevents
 *   a runaway loop where one user confirmation produces dozens of
 *   duplicate "downgrade" events. `cumulative_cli_ms` is the odd one out
 *   — we latch it in a `cliFired` flag because there is no natural reset
 *   handle; the caller's downgrade logic owns that reset flow.
 *
 * Atomic unit: this module is pure in-memory state + event emission. No
 * I/O, no DB, no dependencies on the queue — a CircuitBreaker can be
 * constructed and exercised in a plain unit test without any fixture.
 */

import { EventEmitter } from 'node:events';
import type {
  CircuitBreakerLimits,
  CircuitBreakerState,
} from '../../shared/queue-types';

/**
 * Default limits per spec §8 CB-5. Exported so callers can compare
 * against the baseline and so tests can reference the same numbers
 * without hard-coding them.
 */
export const DEFAULT_LIMITS: CircuitBreakerLimits = {
  filesChangedPerTurn: 20,
  cumulativeCliMs: 30 * 60 * 1000, // 30 minutes
  consecutiveQueueRuns: 5,
  sameErrorRepeats: 3,
};

/** Reason literals emitted in the `'fired'` event payload. */
export type CircuitBreakerReason =
  | 'files_per_turn'
  | 'cumulative_cli_ms'
  | 'queue_streak'
  | 'same_error';

/** Structured payload for the `'fired'` event. */
export interface CircuitBreakerFiredEvent {
  reason: CircuitBreakerReason;
  detail: unknown;
}

/** Event name emitted when a tripwire crosses its threshold. */
export const CIRCUIT_BREAKER_FIRED_EVENT = 'fired' as const;

/**
 * Typed overlay on `EventEmitter` so callers get static checking for
 * event name + listener shape without giving up the standard API.
 */
export interface CircuitBreakerEvents {
  fired: (event: CircuitBreakerFiredEvent) => void;
}

export class CircuitBreaker extends EventEmitter {
  private readonly limits: CircuitBreakerLimits;
  private readonly state: CircuitBreakerState = {
    filesChangedThisTurn: 0,
    cumulativeCliMs: 0,
    consecutiveQueueRuns: 0,
    recentErrorCategory: null,
    recentErrorCount: 0,
  };

  /**
   * Latches — set `true` when the matching tripwire fires and cleared
   * by the corresponding reset. Each tripwire has its own latch so a
   * simultaneous threshold crossing on two independent counters still
   * produces two events.
   */
  private filesFired = false;
  private cliFired = false;
  private queueFired = false;
  private errorFired = false;

  constructor(limits: CircuitBreakerLimits = DEFAULT_LIMITS) {
    super();
    this.limits = limits;
  }

  // ── Files-per-turn ─────────────────────────────────────────────────

  /**
   * Accumulate `n` file changes within the current turn. Fires
   * `'fired'` with `reason='files_per_turn'` the first time the running
   * total exceeds `limits.filesChangedPerTurn`. Further calls within
   * the same turn do NOT re-fire until `resetTurn()` runs.
   */
  recordFileChanges(n: number): void {
    this.state.filesChangedThisTurn += n;
    if (
      !this.filesFired &&
      this.state.filesChangedThisTurn > this.limits.filesChangedPerTurn
    ) {
      this.filesFired = true;
      this.fire('files_per_turn', {
        count: this.state.filesChangedThisTurn,
      });
    }
  }

  /**
   * Reset the file-changes counter at a turn boundary (e.g. when the
   * agent emits its final message for the current assistant turn).
   * Releases the `files_per_turn` latch so the next turn can fire
   * again if it overshoots.
   */
  resetTurn(): void {
    this.state.filesChangedThisTurn = 0;
    this.filesFired = false;
  }

  // ── Cumulative CLI time ────────────────────────────────────────────

  /**
   * Accumulate `ms` of CLI wall-time. Fires once when the total exceeds
   * `limits.cumulativeCliMs` (default 30 minutes). There is no automatic
   * reset — the downgrade flow clears the latch via `confirmContinue()`
   * along with the queue streak (they share the same "user reviewed"
   * gesture).
   */
  recordCliElapsed(ms: number): void {
    this.state.cumulativeCliMs += ms;
    if (
      !this.cliFired &&
      this.state.cumulativeCliMs > this.limits.cumulativeCliMs
    ) {
      this.cliFired = true;
      this.fire('cumulative_cli_ms', {
        ms: this.state.cumulativeCliMs,
      });
    }
  }

  // ── Consecutive queue runs ─────────────────────────────────────────

  /**
   * Mark the start of a queue item. Fires `'queue_streak'` when the
   * running counter reaches `limits.consecutiveQueueRuns` (default 5).
   * Callers then prompt the user for a "continue" confirmation, which
   * invokes {@link confirmContinue}.
   */
  recordQueueStart(): void {
    this.state.consecutiveQueueRuns += 1;
    if (
      !this.queueFired &&
      this.state.consecutiveQueueRuns >= this.limits.consecutiveQueueRuns
    ) {
      this.queueFired = true;
      this.fire('queue_streak', {
        count: this.state.consecutiveQueueRuns,
      });
    }
  }

  /**
   * Reset the queue-streak counter + release its latch. Called when
   * the user explicitly confirms "continue" after a streak prompt, and
   * also (per spec §8 CB-5) clears the cumulative-CLI latch — those
   * two tripwires share the "user reviewed autonomy" gesture.
   */
  confirmContinue(): void {
    this.state.consecutiveQueueRuns = 0;
    this.queueFired = false;
    // The cumulative CLI counter does NOT reset — the 30-minute budget
    // is a lifetime allowance. But we release its latch so a further
    // allowance from the caller can re-fire once the total grows again.
    // (Callers who explicitly want a lifetime no-repeat can construct
    // a fresh CircuitBreaker instead.)
    this.cliFired = false;
  }

  // ── Same-error repeats ─────────────────────────────────────────────

  /**
   * Record an error categorised by `category` (e.g. provider name,
   * error code family). A different category from the last one resets
   * the counter to 1 and releases the latch. The same category
   * increments the counter and fires once when it reaches
   * `limits.sameErrorRepeats` (default 3).
   */
  recordError(category: string): void {
    if (this.state.recentErrorCategory === category) {
      this.state.recentErrorCount += 1;
    } else {
      this.state.recentErrorCategory = category;
      this.state.recentErrorCount = 1;
      // Category changed: the streak is broken, release the latch so a
      // new streak on this new category can fire once it reaches the
      // threshold.
      this.errorFired = false;
    }
    if (
      !this.errorFired &&
      this.state.recentErrorCount >= this.limits.sameErrorRepeats
    ) {
      this.errorFired = true;
      this.fire('same_error', {
        category,
        count: this.state.recentErrorCount,
      });
    }
  }

  /**
   * Explicitly clear the error counter + latch. Called after a
   * successful retry or a user-confirmed "ignore and continue".
   */
  clearError(): void {
    this.state.recentErrorCategory = null;
    this.state.recentErrorCount = 0;
    this.errorFired = false;
  }

  // ── Introspection ─────────────────────────────────────────────────

  /**
   * Returns a SHALLOW immutable snapshot of the current counter state.
   * Callers must treat the return value as read-only — mutating fields
   * on it does NOT mutate the breaker's internal state (the object is
   * freshly constructed per call), but the contract is still read-only
   * so tests exercise the public surface rather than private access.
   */
  getState(): CircuitBreakerState {
    return {
      filesChangedThisTurn: this.state.filesChangedThisTurn,
      cumulativeCliMs: this.state.cumulativeCliMs,
      consecutiveQueueRuns: this.state.consecutiveQueueRuns,
      recentErrorCategory: this.state.recentErrorCategory,
      recentErrorCount: this.state.recentErrorCount,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Single emit site for `'fired'`. Wraps the emit in a try/catch so a
   * buggy subscriber cannot rewrite the `record*` contract ("I accepted
   * your update and the counter is now X"). The failure is logged and
   * swallowed — same pattern as MessageService.
   */
  private fire(reason: CircuitBreakerReason, detail: unknown): void {
    try {
      this.emit(CIRCUIT_BREAKER_FIRED_EVENT, { reason, detail });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      // TODO R2-log: swap for structured logger (src/main/log/)
      console.warn('[rolestra.queue.circuit-breaker] listener threw:', {
        name: err instanceof Error ? err.name : undefined,
        message: errMessage,
      });
    }
  }

  // ── Typed EventEmitter overloads ──────────────────────────────────

  on<E extends keyof CircuitBreakerEvents>(
    event: E,
    listener: CircuitBreakerEvents[E],
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  on(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<E extends keyof CircuitBreakerEvents>(
    event: E,
    listener: CircuitBreakerEvents[E],
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;
  off(
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    return super.off(event, listener);
  }

  emit<E extends keyof CircuitBreakerEvents>(
    event: E,
    ...args: Parameters<CircuitBreakerEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}
