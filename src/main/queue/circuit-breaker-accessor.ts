/**
 * CircuitBreaker accessor (R9-Task6).
 *
 * Some recording sites — notably `CliProcessManager.spawn*` — live deep
 * inside provider factories where threading a CircuitBreaker through
 * every construction path would force a large surface change. Those
 * sites read the breaker through this module-level accessor, which
 * `main/index.ts` wires once at app boot via
 * {@link setCircuitBreakerAccessor}.
 *
 * The accessor is intentionally "maybe-null": tests that construct a
 * CliProvider without going through `main/index.ts` do not call the
 * setter, and the record sites silently no-op (same shape as the
 * optional DI on ExecutionService / QueueService / MeetingTurnExecutor).
 */
import type { CircuitBreaker } from './circuit-breaker';

let accessor: (() => CircuitBreaker | null) | null = null;

/**
 * Install (or uninstall) the accessor. Passing `null` removes the
 * accessor entirely — used by tests that want a clean slate between
 * runs.
 */
export function setCircuitBreakerAccessor(
  fn: (() => CircuitBreaker | null) | null,
): void {
  accessor = fn;
}

/**
 * Read the currently-installed CircuitBreaker, or `null` when no
 * accessor is registered (the default outside `main/index.ts`).
 *
 * Callers are expected to branch on `null` and skip the record call.
 */
export function getCircuitBreaker(): CircuitBreaker | null {
  return accessor?.() ?? null;
}
