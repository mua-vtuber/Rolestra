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
    const results = await warmup.warmAll(['bad']);
    expect(results[0].succeeded).toBe(false);
  });

  it('treats reconnect rejection as not-succeeded (does not throw)', async () => {
    const svc = makeFakeMemberService({
      err: { reject: new Error('boom') },
    });
    const warmup = new MemberWarmupService(svc);
    const results = await warmup.warmAll(['err']);
    expect(results[0].succeeded).toBe(false);
  });
});
