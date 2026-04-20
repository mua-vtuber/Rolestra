/**
 * Unit tests for CircuitBreaker (R2 Task 15).
 *
 * Coverage (spec §8 CB-5):
 *   - recordFileChanges: crosses threshold → fire 'files_per_turn' with
 *     {count}. Accumulates across calls. resetTurn releases latch.
 *   - recordCliElapsed: crosses 30min → fire 'cumulative_cli_ms'. Fires
 *     once, does not re-fire without reset.
 *   - recordQueueStart: 5th call → fire 'queue_streak'. confirmContinue
 *     resets counter + latch.
 *   - recordError: same category 3× → fire 'same_error'. Different
 *     category mid-streak resets counter. clearError fully clears.
 *   - getState: returns a snapshot (not a live reference).
 *   - Listener throw does not propagate out of record*.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CIRCUIT_BREAKER_FIRED_EVENT,
  CircuitBreaker,
  DEFAULT_LIMITS,
  type CircuitBreakerFiredEvent,
} from '../circuit-breaker';

function collectFires(breaker: CircuitBreaker): CircuitBreakerFiredEvent[] {
  const received: CircuitBreakerFiredEvent[] = [];
  breaker.on(CIRCUIT_BREAKER_FIRED_EVENT, (evt) => received.push(evt));
  return received;
}

describe('CircuitBreaker', () => {
  // ── files_per_turn ──────────────────────────────────────────────────

  describe('recordFileChanges', () => {
    it('fires once when the cumulative count exceeds the threshold (single call)', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordFileChanges(21);

      expect(fires).toHaveLength(1);
      expect(fires[0]).toEqual({
        reason: 'files_per_turn',
        detail: { count: 21 },
      });
    });

    it('fires once when the threshold is crossed by accumulation across calls', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordFileChanges(10);
      breaker.recordFileChanges(11); // total 21 > 20

      expect(fires).toHaveLength(1);
      expect(fires[0]!.detail).toEqual({ count: 21 });
    });

    it('does NOT fire when the cumulative count stays at or below the threshold', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordFileChanges(20); // exactly equal, not > threshold

      expect(fires).toHaveLength(0);
    });

    it('does NOT re-fire on further calls after the first fire until resetTurn runs', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordFileChanges(25);
      expect(fires).toHaveLength(1);

      breaker.recordFileChanges(10); // still above threshold
      breaker.recordFileChanges(5);

      expect(fires).toHaveLength(1);
    });

    it('resetTurn clears the accumulator + latch; the next overshoot fires again', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordFileChanges(21);
      expect(fires).toHaveLength(1);

      breaker.resetTurn();
      // Smaller than threshold — must stay silent.
      breaker.recordFileChanges(15);
      expect(fires).toHaveLength(1);
      expect(breaker.getState().filesChangedThisTurn).toBe(15);

      // Second overshoot after reset fires again.
      breaker.recordFileChanges(10);
      expect(fires).toHaveLength(2);
      expect(fires[1]!.detail).toEqual({ count: 25 });
    });
  });

  // ── cumulative_cli_ms ──────────────────────────────────────────────

  describe('recordCliElapsed', () => {
    it('fires when cumulative ms exceeds 30 minutes', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordCliElapsed(31 * 60 * 1000);

      expect(fires).toHaveLength(1);
      expect(fires[0]!.reason).toBe('cumulative_cli_ms');
      expect(fires[0]!.detail).toEqual({ ms: 31 * 60 * 1000 });
    });

    it('does not re-fire on further ms without resetting', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordCliElapsed(31 * 60 * 1000);
      breaker.recordCliElapsed(5 * 60 * 1000);

      expect(fires).toHaveLength(1);
    });

    it('does NOT fire at exactly the threshold', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordCliElapsed(DEFAULT_LIMITS.cumulativeCliMs);

      expect(fires).toHaveLength(0);
    });
  });

  // ── queue_streak ───────────────────────────────────────────────────

  describe('recordQueueStart', () => {
    it('fires at the 5th consecutive call', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      for (let i = 0; i < 4; i += 1) breaker.recordQueueStart();
      expect(fires).toHaveLength(0);

      breaker.recordQueueStart(); // 5th
      expect(fires).toHaveLength(1);
      expect(fires[0]).toEqual({
        reason: 'queue_streak',
        detail: { count: 5 },
      });
    });

    it('confirmContinue resets the counter + latch — 4 more calls stay silent', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      for (let i = 0; i < 5; i += 1) breaker.recordQueueStart();
      expect(fires).toHaveLength(1);

      breaker.confirmContinue();
      expect(breaker.getState().consecutiveQueueRuns).toBe(0);

      // 4 subsequent calls must NOT fire (one short of threshold).
      for (let i = 0; i < 4; i += 1) breaker.recordQueueStart();
      expect(fires).toHaveLength(1);
    });

    it('fires again on a fresh 5-streak after confirmContinue', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      for (let i = 0; i < 5; i += 1) breaker.recordQueueStart();
      breaker.confirmContinue();
      for (let i = 0; i < 5; i += 1) breaker.recordQueueStart();

      expect(fires).toHaveLength(2);
    });
  });

  // ── same_error ─────────────────────────────────────────────────────

  describe('recordError', () => {
    it('fires on the 3rd consecutive same-category error', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordError('api.timeout');
      breaker.recordError('api.timeout');
      expect(fires).toHaveLength(0);

      breaker.recordError('api.timeout');
      expect(fires).toHaveLength(1);
      expect(fires[0]).toEqual({
        reason: 'same_error',
        detail: { category: 'api.timeout', count: 3 },
      });
    });

    it('does NOT fire when a different category interrupts the streak', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordError('A');
      breaker.recordError('A');
      breaker.recordError('B'); // resets counter to 1 with category='B'

      expect(fires).toHaveLength(0);
      expect(breaker.getState().recentErrorCategory).toBe('B');
      expect(breaker.getState().recentErrorCount).toBe(1);
    });

    it('fires on a fresh 3-streak of the new category after interruption', () => {
      const breaker = new CircuitBreaker();
      const fires = collectFires(breaker);

      breaker.recordError('A');
      breaker.recordError('A');
      breaker.recordError('B'); // resets
      breaker.recordError('B');
      breaker.recordError('B'); // 3rd B → fires

      expect(fires).toHaveLength(1);
      expect(fires[0]!.detail).toEqual({ category: 'B', count: 3 });
    });

    it('clearError zeroes the counter + category', () => {
      const breaker = new CircuitBreaker();

      breaker.recordError('A');
      breaker.recordError('A');
      breaker.clearError();

      const s = breaker.getState();
      expect(s.recentErrorCategory).toBeNull();
      expect(s.recentErrorCount).toBe(0);
    });
  });

  // ── getState ───────────────────────────────────────────────────────

  describe('getState', () => {
    it('returns a snapshot independent of subsequent mutations', () => {
      const breaker = new CircuitBreaker();
      breaker.recordFileChanges(5);
      const snap = breaker.getState();

      breaker.recordFileChanges(10);
      expect(snap.filesChangedThisTurn).toBe(5); // snapshot did not mutate
      expect(breaker.getState().filesChangedThisTurn).toBe(15);
    });

    it('reflects the initial zero state on construction', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toEqual({
        filesChangedThisTurn: 0,
        cumulativeCliMs: 0,
        consecutiveQueueRuns: 0,
        recentErrorCategory: null,
        recentErrorCount: 0,
      });
    });
  });

  // ── emit isolation ─────────────────────────────────────────────────

  describe('emit isolation', () => {
    it('swallows listener exceptions and logs a warning', () => {
      const breaker = new CircuitBreaker();
      breaker.on(CIRCUIT_BREAKER_FIRED_EVENT, () => {
        throw new Error('listener blew up');
      });
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      try {
        // Must NOT propagate.
        expect(() => breaker.recordFileChanges(21)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [marker, payload] = warnSpy.mock.calls[0]!;
        expect(marker).toBe('[rolestra.queue.circuit-breaker] listener threw:');
        expect(payload).toMatchObject({
          name: 'Error',
          message: 'listener blew up',
        });
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
