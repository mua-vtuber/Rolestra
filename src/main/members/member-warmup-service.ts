/**
 * MemberWarmupService — fire-and-forget boot warmup driver (R8-Task8,
 * spec §7.2 + R8-D3) with R9-Task10 backoff retry.
 *
 * On app boot the production wiring calls `void warmAll(providerIds)` so
 * every provider is probed in parallel without blocking the first paint.
 * Each probe runs as `Promise.race([reconnect, timeout])` so a slow or
 * hung provider cannot hold up the bunch — after the timeout the result
 * settles as `offline-connection` while the underlying `warmup` continues
 * in background (Electron `provider.warmup` does not accept an abort
 * signal, so cancellation is best-effort).
 *
 * R9-Task10 — backoff retry:
 *   If the initial probe fails (timeout OR non-online resolution), the
 *   service schedules exponential retries at {@link WARMUP_RETRY_DELAYS_MS}
 *   (10 s → 30 s → 60 s, max 3 attempts). Each retry runs in the
 *   background via `setTimeout` — `warmAll` does NOT wait for retries.
 *   The first successful retry cancels the rest. The runtime status map
 *   inside {@link MemberProfileService} is updated as each retry settles,
 *   so renderer surfaces that refetch (e.g. `member:list`) see the
 *   latest state without requiring a manual reconnect click.
 *
 *   Cancellation: {@link cancelRetries} / {@link cancelAll} clear pending
 *   timers. The production wiring calls `cancelAll` on app shutdown so
 *   we do not leak timers. Tests call it in `afterEach` to flush state.
 *
 *   Abort signal (R10 deferred): `provider.warmup(signal?)` is not yet
 *   plumbed, so a late-resolving warmup from a prior attempt can still
 *   mutate the runtime status after a retry has already settled. The
 *   `reconnect()` coalescing inside MemberProfileService bounds this to
 *   "last-write-wins per in-flight probe" — acceptable for boot warmup
 *   but documented here so R10 can add an abort signal without
 *   re-discovering why.
 *
 * The service does NOT await the warmup batch in production — `warmAll`
 * itself returns a Promise<void> the caller can `void`-prefix or pass to
 * `Promise.allSettled` as needed (tests do await it to assert on
 * post-batch state).
 *
 * The service is stateless beyond the injected `MemberProfileService`
 * dependency and the retry-timer map — it never owns the runtime status
 * map. `reconnect`'s existing coalescing guarantees concurrent boot
 * probes for the same providerId collapse onto a single underlying
 * `warmup`.
 */
import {
  WARMUP_RETRY_DELAYS_MS,
  type WorkStatus,
} from '../../shared/member-profile-types';
import type { MemberProfileService } from './member-profile-service';

/** Default per-provider deadline in ms. R8-D3: 5 seconds. */
export const DEFAULT_WARMUP_TIMEOUT_MS = 5_000;

/**
 * R10-Task10 narrow port: "is this provider currently disabled?". The
 * service consults this before each retry fires and bails out the
 * entire chain when the answer is `true`. Kept as a function rather
 * than a registry handle so tests can inject `() => false` /
 * `() => true` without standing up a fake registry.
 *
 * Returning `true` short-circuits ALL remaining retries for the given
 * providerId AND clears the in-flight timer (no further `runProbe`
 * calls for that provider until the next `warmAll`). Returning `false`
 * (or omitting the option entirely) preserves the R9 behaviour.
 */
export type IsProviderDisabled = (providerId: string) => boolean;

export interface WarmupOptions {
  /** Override the 5 s default deadline used for each probe attempt. */
  timeoutMs?: number;
  /**
   * Override the {@link WARMUP_RETRY_DELAYS_MS} retry schedule. Pass
   * `[]` to disable retries entirely. Tests usually pass `[10, 20, 30]`
   * (ms not s) to keep the suite fast.
   */
  retryDelaysMs?: readonly number[];
}

/**
 * Constructor-time dependencies for {@link MemberWarmupService}. Accepts
 * the original positional `MemberProfileService` argument for
 * backward-compat with R8/R9 wiring (tests + main/index.ts), with the
 * new R10-Task10 disabled-check supplied via this options bag.
 */
export interface MemberWarmupServiceOptions {
  /**
   * Predicate that decides whether a provider is currently disabled.
   * When omitted, the warmup service behaves exactly like R9 — every
   * scheduled retry fires regardless of provider state.
   *
   * The predicate is consulted at the moment a retry would FIRE (inside
   * the `setTimeout` callback) — never on a poll loop. This matches
   * "ask once, at the moment it matters" (plan R10-Task10): a provider
   * disabled mid-window cancels its retry chain on the next tick of
   * the timer it already scheduled, with no extra wakeups.
   */
  isProviderDisabled?: IsProviderDisabled;
}

/** Return value the service surfaces to callers (tests and main/index.ts). */
export interface WarmupResult {
  providerId: string;
  /** Whether the INITIAL `reconnect()` resolved online before the deadline. */
  succeeded: boolean;
  /** ms it took for the initial probe (or the timeout deadline if expired). */
  durationMs: number;
  /**
   * `true` when the initial probe failed AND the service has scheduled
   * at least one backoff retry for this provider. `false` for happy-path
   * success OR when retries are disabled via `retryDelaysMs=[]`.
   * Callers that want to await the full retry chain should instead
   * observe {@link MemberProfileService.getWorkStatus} over time.
   */
  retriesScheduled: boolean;
}

export class MemberWarmupService {
  /**
   * Pending retry timers per providerId. A provider can have at most one
   * outstanding retry scheduled at any moment — the chain is linear
   * (each retry's `finally` schedules the next on failure). Keyed by
   * providerId so {@link cancelRetries} can target a single member.
   */
  private readonly pendingRetries = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * R10-Task10 disabled-check predicate. `null` means "no check" — the
   * service falls back to R9 behaviour. Frozen at construction so a
   * mid-run swap cannot bend behaviour for a provider already in the
   * retry chain.
   */
  private readonly isProviderDisabled: IsProviderDisabled | null;

  constructor(
    private readonly svc: MemberProfileService,
    options: MemberWarmupServiceOptions = {},
  ) {
    this.isProviderDisabled = options.isProviderDisabled ?? null;
  }

  /**
   * Probe every provider in `providerIds`. Resolves after every INITIAL
   * probe either succeeds, fails, or times out. The promise NEVER
   * rejects — individual provider failures are reflected in the
   * returned {@link WarmupResult} array.
   *
   * Per-provider behaviour:
   *   - Success (online) → {succeeded: true, retriesScheduled: false}
   *   - reconnect throws OR resolves non-online OR timeout expires →
   *     {succeeded: false, retriesScheduled: true (unless retryDelaysMs=[])}.
   *     Retries run in the background; `warmAll` does not wait.
   *
   * The returned Promise settles as soon as the initial parallel batch
   * is done — boot UX depends on this (spec §7.2: "첫 페인트는 warmup
   * 을 기다리지 않는다").
   */
  async warmAll(
    providerIds: readonly string[],
    opts: WarmupOptions = {},
  ): Promise<WarmupResult[]> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
    const retryDelays = opts.retryDelaysMs ?? WARMUP_RETRY_DELAYS_MS;
    const probes = providerIds.map((id) =>
      this.runInitialProbe(id, timeoutMs, retryDelays),
    );
    return Promise.all(probes);
  }

  /**
   * Cancel pending retry timers for a specific provider. Safe to call
   * whether or not a retry is currently scheduled (no-op in the latter
   * case). The Task 18 IPC layer calls this on provider deletion so a
   * newly-recycled providerId does not inherit a stale retry chain.
   */
  cancelRetries(providerId: string): void {
    const timer = this.pendingRetries.get(providerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingRetries.delete(providerId);
    }
  }

  /**
   * Cancel every pending retry timer. Called by the production main
   * process on app quit to avoid leaked timers; tests call it in
   * `afterEach` to reset state between cases.
   */
  cancelAll(): void {
    for (const timer of this.pendingRetries.values()) {
      clearTimeout(timer);
    }
    this.pendingRetries.clear();
  }

  /**
   * Snapshot of how many retries are currently scheduled. Exposed for
   * test assertions and production health reporting — never read by
   * business logic.
   */
  pendingRetryCount(): number {
    return this.pendingRetries.size;
  }

  /**
   * Initial probe. On failure, hands off to {@link scheduleRetry} which
   * owns the backoff chain. The returned {@link WarmupResult} reports on
   * the INITIAL probe only — callers who care about the full retry
   * outcome must observe the runtime status map over time.
   */
  private async runInitialProbe(
    providerId: string,
    timeoutMs: number,
    retryDelays: readonly number[],
  ): Promise<WarmupResult> {
    const outcome = await this.runProbe(providerId, timeoutMs);
    const shouldRetry = !outcome.succeeded && retryDelays.length > 0;
    if (shouldRetry) {
      this.scheduleRetry(providerId, 0, timeoutMs, retryDelays);
    }
    return {
      providerId,
      succeeded: outcome.succeeded,
      durationMs: outcome.durationMs,
      retriesScheduled: shouldRetry,
    };
  }

  /**
   * Core probe — wraps `reconnect()` in a timeout race. Does NOT know
   * about retries. Always resolves (never rejects) so callers can chain
   * without `.catch`.
   */
  private async runProbe(
    providerId: string,
    timeoutMs: number,
  ): Promise<{ succeeded: boolean; durationMs: number; status: WorkStatus | null }> {
    const startedAt = Date.now();

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<'__warmup_timeout__'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('__warmup_timeout__'), timeoutMs);
    });

    let succeeded = false;
    let finalStatus: WorkStatus | null = null;
    try {
      const winner = await Promise.race([
        // reconnect() resolves with the WorkStatus (string union); we
        // treat 'online' as success and anything else as not-yet-success
        // — but BOTH paths have already mutated the runtime status map
        // by the time we observe them.
        this.svc.reconnect(providerId).then((status) => status),
        timeoutPromise,
      ]);
      if (winner === '__warmup_timeout__') {
        succeeded = false;
      } else {
        finalStatus = winner;
        succeeded = winner === 'online';
      }
    } catch {
      // reconnect re-throws only for unexpected internal errors (the
      // warmup adapter swallows underlying probe failures). Surface as
      // not-success and let the runtime status map carry whatever the
      // inner catch set.
      succeeded = false;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }

    return {
      succeeded,
      durationMs: Date.now() - startedAt,
      status: finalStatus,
    };
  }

  /**
   * Schedule the next retry attempt in the chain. `attemptIndex` is the
   * zero-based index into `retryDelays` (0 → first retry, 1 → second,
   * ...). When the chain is exhausted we stop scheduling — the runtime
   * status map carries whatever the last failed probe left there
   * (expected: `'offline-connection'`).
   *
   * The timer callback:
   *   1. Drops its own entry from {@link pendingRetries} (so cancel /
   *      observation reflect a quiescent state even mid-flight).
   *   2. Runs `runProbe` once.
   *   3. On success, stops. On failure, schedules the next retry.
   *
   * A cancellation between step 1 and step 2 still runs the probe
   * itself (we cannot preempt an already-firing timer) but NO further
   * retry gets scheduled because {@link pendingRetries} no longer holds
   * this provider — the next-retry guard inside the finally block
   * checks presence.
   */
  private scheduleRetry(
    providerId: string,
    attemptIndex: number,
    timeoutMs: number,
    retryDelays: readonly number[],
  ): void {
    if (attemptIndex >= retryDelays.length) return;
    const delay = retryDelays[attemptIndex];
    const timer = setTimeout(() => {
      // Remove BEFORE the probe so cancelRetries() issued during the
      // probe window is a pure no-op (timer already fired) and any
      // recursive scheduleRetry below gets a clean slot.
      this.pendingRetries.delete(providerId);

      // R10-Task10 (R9 Known Concern #4): consult the disabled
      // predicate at the moment the retry would fire. A provider that
      // was disabled while we were sleeping (user toggled it off, or
      // the registry marked it not-installed) must NOT trigger
      // another reconnect — that would re-mark its runtime status as
      // 'connecting' and surface a misleading "trying to reach you"
      // banner. We bail out the entire chain instead.
      if (this.isProviderDisabled?.(providerId) === true) {
        return;
      }

      void this.runProbe(providerId, timeoutMs).then((outcome) => {
        if (outcome.succeeded) return; // chain stops on first success
        // Re-check disabled BEFORE scheduling the next retry. The
        // probe itself can take seconds; a provider disabled during
        // that window must not get another retry queued. This is
        // belt-and-suspenders relative to the early bail above —
        // either guard alone is enough; both together make sure the
        // schedule is an unbroken chain of "active providers only".
        if (this.isProviderDisabled?.(providerId) === true) {
          return;
        }
        this.scheduleRetry(providerId, attemptIndex + 1, timeoutMs, retryDelays);
      });
    }, delay);
    // Node's setTimeout returns a Timeout object that keeps the event
    // loop alive; unref() would let the process exit with a retry still
    // pending. Production boot keeps the loop alive anyway (Electron
    // main), and tests call cancelAll() in afterEach — no unref needed.
    this.pendingRetries.set(providerId, timer);
  }
}
