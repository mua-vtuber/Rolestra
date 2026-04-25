/**
 * MemberWarmupService — Promise.allSettled boot driver semantics
 * (R8-Task8, spec §7.2 + R8-D3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MemberWarmupService,
  DEFAULT_WARMUP_TIMEOUT_MS,
} from '../member-warmup-service';
import type { MemberProfileService } from '../member-profile-service';
import type { WorkStatus } from '../../../shared/member-profile-types';

interface ProbeOutcome {
  /** Resolution value if the probe should resolve. */
  status?: WorkStatus;
  /** If set, the probe never resolves before the supplied delay (ms). */
  delay?: number;
  /** If set, the probe rejects with this error. */
  reject?: Error;
}

function makeFakeMemberService(
  outcomes: Record<string, ProbeOutcome>,
): MemberProfileService {
  return {
    reconnect(providerId: string): Promise<WorkStatus> {
      const outcome = outcomes[providerId] ?? { status: 'online' as const };
      return new Promise((resolve, reject) => {
        const settle = () => {
          if (outcome.reject) reject(outcome.reject);
          else resolve(outcome.status ?? 'online');
        };
        if (outcome.delay !== undefined) {
          setTimeout(settle, outcome.delay);
        } else {
          settle();
        }
      });
    },
  } as unknown as MemberProfileService;
}

beforeEach(() => {
  // Use real timers — fake timers + Promise.race is fragile across versions.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MemberWarmupService.warmAll — happy paths', () => {
  it('resolves all results when every provider succeeds', async () => {
    const svc = makeFakeMemberService({
      a: { status: 'online' },
      b: { status: 'online' },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['a', 'b']);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.succeeded)).toBe(true);
  });

  it('returns empty array for empty input', async () => {
    const svc = makeFakeMemberService({});
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll([]);
    expect(results).toEqual([]);
  });

  it('exposes default timeout constant matching spec §7.2 (5 s)', () => {
    expect(DEFAULT_WARMUP_TIMEOUT_MS).toBe(5_000);
  });
});

describe('MemberWarmupService.warmAll — timeout enforcement', () => {
  it('marks a probe as failed once timeout elapses (background warmup keeps running)', async () => {
    const svc = makeFakeMemberService({
      slow: { status: 'online', delay: 200 },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['slow'], { timeoutMs: 50 });
    expect(results[0].succeeded).toBe(false);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(40);
    expect(results[0].durationMs).toBeLessThan(190); // < the slow delay
  });

  it('mixes success + timeout in a single batch without rejecting', async () => {
    const svc = makeFakeMemberService({
      fast: { status: 'online' },
      slow: { status: 'online', delay: 500 },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['fast', 'slow'], { timeoutMs: 50 });
    const byId = Object.fromEntries(results.map((r) => [r.providerId, r]));
    expect(byId.fast.succeeded).toBe(true);
    expect(byId.slow.succeeded).toBe(false);
  });
});

describe('MemberWarmupService.warmAll — non-online resolutions', () => {
  it('treats reconnect resolving with offline-connection as not-succeeded', async () => {
    const svc = makeFakeMemberService({
      bad: { status: 'offline-connection' },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['bad'], { retryDelaysMs: [] });
    expect(results[0].succeeded).toBe(false);
  });

  it('treats reconnect rejection as not-succeeded (does not throw)', async () => {
    const svc = makeFakeMemberService({
      err: { reject: new Error('boom') },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['err'], { retryDelaysMs: [] });
    expect(results[0].succeeded).toBe(false);
  });
});

// ── R9-Task10: backoff retry schedule ────────────────────────────────

describe('MemberWarmupService.warmAll — backoff retry (R9-Task10)', () => {
  /**
   * Build a fake MemberProfileService whose `reconnect()` returns the
   * next status in `sequence` on each call (and keeps returning the
   * last value once the sequence is exhausted). Lets a test simulate
   * "first attempt fails, second succeeds" without juggling promises.
   */
  function makeSequencedService(
    sequence: WorkStatus[],
    onCall?: (index: number, providerId: string) => void,
  ) {
    let index = 0;
    return {
      reconnect: vi.fn(async (providerId: string) => {
        const callIndex = index;
        onCall?.(callIndex, providerId);
        const status = sequence[Math.min(index, sequence.length - 1)];
        index += 1;
        return status;
      }),
    } as unknown as MemberProfileService;
  }

  it('does NOT schedule retries on initial success', async () => {
    const svc = makeSequencedService(['online']);
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['a'], {
      retryDelaysMs: [50, 100, 200],
    });

    expect(results[0].succeeded).toBe(true);
    expect(results[0].retriesScheduled).toBe(false);
    expect(warmup.pendingRetryCount()).toBe(0);
  });

  it('schedules a retry when the initial probe fails', async () => {
    const svc = makeSequencedService(['offline-connection', 'offline-connection']);
    const warmup = new MemberWarmupService(svc);

    const results = await warmup.warmAll(['a'], {
      retryDelaysMs: [10_000, 30_000, 60_000],
    });
    try {
      expect(results[0].succeeded).toBe(false);
      expect(results[0].retriesScheduled).toBe(true);
      expect(warmup.pendingRetryCount()).toBe(1);
    } finally {
      warmup.cancelAll();
    }
  });

  it('stops retrying the moment a retry resolves online', async () => {
    // Sequence: initial fail, first retry success. Retry delay tight so
    // the test is fast; we observe via the reconnect call count.
    const svc = makeSequencedService(['offline-connection', 'online']);
    const warmup = new MemberWarmupService(svc);

    await warmup.warmAll(['a'], { retryDelaysMs: [15, 5_000, 5_000] });
    // Let the first (short) retry fire.
    await new Promise((r) => setTimeout(r, 40));

    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    // No further retries scheduled after the success.
    expect(warmup.pendingRetryCount()).toBe(0);

    warmup.cancelAll();
  });

  it('runs up to WARMUP_MAX_RETRIES (3) retries before giving up', async () => {
    // All attempts fail → retries 0 + 3 = 4 reconnect calls total.
    const svc = makeSequencedService([
      'offline-connection',
      'offline-connection',
      'offline-connection',
      'offline-connection',
    ]);
    const warmup = new MemberWarmupService(svc);

    await warmup.warmAll(['a'], { retryDelaysMs: [10, 10, 10] });
    // Wait for all three retries (10 ms each, sequential).
    await new Promise((r) => setTimeout(r, 120));

    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    expect(warmup.pendingRetryCount()).toBe(0);
  });

  it('honours retryDelaysMs=[] to disable retries entirely', async () => {
    const svc = makeSequencedService(['offline-connection', 'online']);
    const warmup = new MemberWarmupService(svc);

    const results = await warmup.warmAll(['a'], { retryDelaysMs: [] });

    expect(results[0].succeeded).toBe(false);
    expect(results[0].retriesScheduled).toBe(false);
    expect(warmup.pendingRetryCount()).toBe(0);

    // Give the event loop a tick — no late retries should fire.
    await new Promise((r) => setTimeout(r, 20));
    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('cancelRetries(providerId) prevents further scheduled retries', async () => {
    const svc = makeSequencedService([
      'offline-connection',
      'offline-connection',
      'offline-connection',
    ]);
    const warmup = new MemberWarmupService(svc);

    await warmup.warmAll(['a'], { retryDelaysMs: [50, 50, 50] });
    expect(warmup.pendingRetryCount()).toBe(1);

    warmup.cancelRetries('a');
    expect(warmup.pendingRetryCount()).toBe(0);

    // Wait past the first retry delay — nothing should fire.
    await new Promise((r) => setTimeout(r, 80));
    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('cancelAll() drains every pending retry in one call', async () => {
    const svc = makeSequencedService(['offline-connection', 'offline-connection']);
    const warmup = new MemberWarmupService(svc);

    await warmup.warmAll(['a', 'b', 'c'], { retryDelaysMs: [60_000] });
    expect(warmup.pendingRetryCount()).toBe(3);

    warmup.cancelAll();
    expect(warmup.pendingRetryCount()).toBe(0);
  });

  // ── R10-Task10: provider.disabled cancels the chain ─────────────────

  it('R10-Task10: cancels the chain when isProviderDisabled returns true at retry-fire time', async () => {
    // Initial probe fails → chain scheduled. While the timer is sleeping
    // we flip the disabled predicate to true. The next fire MUST bail
    // out before another reconnect runs.
    const svc = makeSequencedService([
      'offline-connection',
      'offline-connection',
    ]);
    let disabled = false;
    const warmup = new MemberWarmupService(svc, {
      isProviderDisabled: () => disabled,
    });

    await warmup.warmAll(['a'], { retryDelaysMs: [20, 20, 20] });
    expect(warmup.pendingRetryCount()).toBe(1);

    disabled = true;
    // Wait past the first retry's delay — the timer fires, sees disabled,
    // and bails. No second reconnect lands.
    await new Promise((r) => setTimeout(r, 60));

    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(warmup.pendingRetryCount()).toBe(0);
  });

  it('R10-Task10: lets retries through when isProviderDisabled returns false (regression guard)', async () => {
    // R9 behaviour must be preserved — a present-but-false predicate
    // must NOT cancel anything. Pinning the call count to 2 (initial +
    // retry) ensures the disabled gate did not accidentally short-circuit.
    const svc = makeSequencedService(['offline-connection', 'online']);
    const warmup = new MemberWarmupService(svc, {
      isProviderDisabled: () => false,
    });

    await warmup.warmAll(['a'], { retryDelaysMs: [15, 5_000, 5_000] });
    await new Promise((r) => setTimeout(r, 40));

    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(warmup.pendingRetryCount()).toBe(0);
    warmup.cancelAll();
  });

  it('R10-Task10: missing isProviderDisabled option preserves R9 retry behaviour', async () => {
    // The old single-arg constructor still works (main/index.ts boot
    // wiring path). 3 failures + 3 retries = 4 reconnect calls.
    const svc = makeSequencedService([
      'offline-connection',
      'offline-connection',
      'offline-connection',
      'offline-connection',
    ]);
    const warmup = new MemberWarmupService(svc); // no options

    await warmup.warmAll(['a'], { retryDelaysMs: [10, 10, 10] });
    await new Promise((r) => setTimeout(r, 120));

    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  it('R10-Task10: post-probe re-check blocks the NEXT retry from being queued', async () => {
    // Edge case: the disabled predicate returns false at the timer's
    // pre-check (so the retry probe runs) but true by the time the
    // probe resolves. The post-probe re-check must catch this and
    // refuse to queue the next retry — without it, a slow probe could
    // keep the chain alive after the user has disabled the provider.
    const svc = makeSequencedService([
      'offline-connection',
      'offline-connection',
      'offline-connection',
    ]);
    let disabledCallCount = 0;
    const warmup = new MemberWarmupService(svc, {
      // First call (timer pre-check on retry #1) → false (let it run).
      // Subsequent calls (post-probe re-check) → true (block chain).
      isProviderDisabled: () => {
        disabledCallCount += 1;
        return disabledCallCount > 1;
      },
    });

    await warmup.warmAll(['a'], { retryDelaysMs: [10, 10, 10] });
    // Wait past the first retry's delay AND the would-be second retry.
    await new Promise((r) => setTimeout(r, 60));

    // Initial + first retry only. The post-probe check caught the
    // mid-probe disable and refused to schedule retry #2.
    expect((svc.reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(warmup.pendingRetryCount()).toBe(0);
    expect(disabledCallCount).toBeGreaterThanOrEqual(2);
  });

  it('uses the default WARMUP_RETRY_DELAYS_MS when no schedule is provided', async () => {
    // The default schedule is 10 s → 30 s → 60 s. We cannot wait for
    // that in a unit test — instead, confirm that a retry IS scheduled
    // (pendingRetryCount === 1 right after warmAll resolves) and then
    // cancel so the test suite exits promptly.
    const svc = makeSequencedService(['offline-connection']);
    const warmup = new MemberWarmupService(svc);

    const results = await warmup.warmAll(['a']);
    try {
      expect(results[0].retriesScheduled).toBe(true);
      expect(warmup.pendingRetryCount()).toBe(1);
    } finally {
      warmup.cancelAll();
    }
  });
});
