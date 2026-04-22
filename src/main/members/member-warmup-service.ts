/**
 * MemberWarmupService — fire-and-forget boot warmup driver (R8-Task8,
 * spec §7.2 + R8-D3).
 *
 * On app boot the production wiring calls `void warmAll(providerIds)` so
 * every provider is probed in parallel without blocking the first paint.
 * Each probe runs as `Promise.race([reconnect, timeout])` so a slow or
 * hung provider cannot hold up the bunch — after the timeout the result
 * settles as `offline-connection` while the underlying `warmup` continues
 * in background (Electron `provider.warmup` does not accept an abort
 * signal, so cancellation is best-effort).
 *
 * The service does NOT await the warmup batch in production — `warmAll`
 * itself returns a Promise<void> the caller can `void`-prefix or pass to
 * `Promise.allSettled` as needed (tests do await it to assert on
 * post-batch state).
 *
 * The service is stateless beyond the injected `MemberProfileService`
 * dependency — it never owns the runtime status map. `reconnect`'s
 * existing coalescing guarantees concurrent boot probes for the same
 * providerId collapse onto a single underlying `warmup`.
 */
import type { MemberProfileService } from './member-profile-service';

/** Default per-provider deadline in ms. R8-D3: 5 seconds. */
export const DEFAULT_WARMUP_TIMEOUT_MS = 5_000;

export interface WarmupOptions {
  timeoutMs?: number;
}

/** Return value the service surfaces to callers (tests and main/index.ts). */
export interface WarmupResult {
  providerId: string;
  /** Whether `reconnect()` resolved before the deadline. */
  succeeded: boolean;
  /** ms it took for the probe (or the timeout deadline if expired). */
  durationMs: number;
}

export class MemberWarmupService {
  constructor(private readonly svc: MemberProfileService) {}

  /**
   * Probe every provider in `providerIds`. Resolves after every probe
   * either succeeds, fails, or times out. The promise NEVER rejects —
   * individual provider failures are reflected in the returned
   * {@link WarmupResult} array.
   *
   * Per-provider behaviour:
   *   - Success → {succeeded: true, durationMs: actual}
   *   - reconnect throws → {succeeded: false, durationMs: actual}
   *     (reconnect itself swallows the warmup rejection and sets the
   *     runtime status to 'offline-connection', so the throw here only
   *     happens for unexpected paths.)
   *   - Timeout deadline beats reconnect → {succeeded: false,
   *     durationMs: timeoutMs}. Background warmup continues; the runtime
   *     status will eventually update via the in-flight reconnect's own
   *     finally clause.
   */
  async warmAll(
    providerIds: readonly string[],
    opts: WarmupOptions = {},
  ): Promise<WarmupResult[]> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
    const probes = providerIds.map((id) => this.runProbe(id, timeoutMs));
    return Promise.all(probes);
  }

  private async runProbe(
    providerId: string,
    timeoutMs: number,
  ): Promise<WarmupResult> {
    const startedAt = Date.now();

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<'__warmup_timeout__'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('__warmup_timeout__'), timeoutMs);
    });

    let succeeded = false;
    try {
      const winner = await Promise.race([
        // reconnect() resolves with the WorkStatus (string union); we treat
        // 'online' as success and anything else as not-yet-success — but
        // BOTH paths have already mutated the runtime status map by the
        // time we observe them.
        this.svc.reconnect(providerId).then((status) => status),
        timeoutPromise,
      ]);
      succeeded = winner !== '__warmup_timeout__' && winner === 'online';
    } catch {
      // reconnect re-throws only for unexpected internal errors (the warmup
      // adapter swallows underlying probe failures). Surface as not-success
      // and let the runtime status map carry whatever the inner catch set.
      succeeded = false;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }

    return {
      providerId,
      succeeded,
      durationMs: Date.now() - startedAt,
    };
  }
}
