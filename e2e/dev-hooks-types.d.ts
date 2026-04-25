/**
 * R11-Task4: ambient declaration for the `window.__rolestraDevHooks`
 * surface that the preload script exposes when `ROLESTRA_E2E=1`. Lives
 * in the `e2e/` tree so the renderer bundle never sees the type — the
 * hooks are intentionally an E2E-only contract and should not be
 * referenced from production code (the runtime gate in `src/preload/
 * index.ts` enforces that, the absent declaration in the renderer
 * `tsconfig` reinforces it at compile time).
 */

interface RolestraDevHooks {
  /**
   * Push `count` file changes through the in-process CircuitBreaker and
   * replicate the autonomy downgrade side-effects (setAutonomy('manual',
   * {reason:'circuit_breaker'}) + circuit_breaker approval row + OS
   * notification). When the active project's id is known the spec
   * passes it explicitly; otherwise the handler picks the first project
   * in `auto_toggle` or `queue` mode.
   */
  tripFilesPerTurn(
    count: number,
    projectId?: string,
  ): Promise<{
    ok: boolean;
    projectId: string | null;
    tripwire: 'files_per_turn';
  }>;

  /** Cumulative CLI wall-clock trip — pass `ms` ≥ 30·60·1000 to fire. */
  tripCumulativeCliMs(
    ms: number,
    projectId?: string,
  ): Promise<{
    ok: boolean;
    projectId: string | null;
    tripwire: 'cumulative_cli_ms';
  }>;

  /** Consecutive queue-run streak trip — pass `count` ≥ 5 to fire. */
  tripQueueStreak(
    count: number,
    projectId?: string,
  ): Promise<{
    ok: boolean;
    projectId: string | null;
    tripwire: 'queue_streak';
  }>;

  /** Same-error streak trip — pass `count` ≥ 3 with the same category. */
  tripSameError(
    category: string,
    count: number,
    projectId?: string,
  ): Promise<{
    ok: boolean;
    projectId: string | null;
    tripwire: 'same_error';
  }>;
}

interface Window {
  /**
   * Present only when `ROLESTRA_E2E=1` (every Playwright Electron run
   * sets this through `electron-launch.ts`). Do NOT use this surface
   * outside of `e2e/*.spec.ts`.
   */
  __rolestraDevHooks?: RolestraDevHooks;
}
