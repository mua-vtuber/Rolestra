/**
 * Single source of truth for runtime timeout / delay magic numbers.
 *
 * F5-T6 (audit Cat 7): the same `5000` ms value was repeated across
 * model registry fetches, the SQLite busy_timeout, CLI detection probes
 * and the local-provider Ollama check. The same `3000` ms KILL_GRACE
 * was repeated across two CLI lifecycle modules. `MAX_SNAPSHOTS=100`
 * was duplicated between consensus-machine and session-state-machine.
 *
 * Keeping these constants in `src/shared/` lets the renderer reuse them
 * for parity assertions in tests without dragging the main bundle into
 * the renderer typescript graph (the values are plain numbers — no
 * runtime cost on either side).
 *
 * Naming: every constant ends with the unit suffix it expresses (`_MS`)
 * so a misuse like `setTimeout(controller.abort, MAX_SNAPSHOTS)` is
 * obvious at the call-site.
 */

// ── Network / probe timeouts ─────────────────────────────────────────

/**
 * Abort window for an outbound model-registry fetch (OpenAI / Anthropic /
 * Google / OpenAI-compatible). Mirrors the previous in-line `5000`.
 */
export const MODEL_REGISTRY_FETCH_TIMEOUT_MS = 5000;

/**
 * Abort window for a CLI binary version/help probe used by
 * `cli-detect-handler`. Mirrors the previous in-line `5000`.
 */
export const CLI_DETECTION_TIMEOUT_MS = 5000;

/**
 * Abort window for an outbound `/api/tags` (Ollama) probe used by the
 * local-provider warm-up. Mirrors the previous in-line `5000`.
 */
export const LOCAL_PROVIDER_TIMEOUT_MS = 5000;

// ── Database ─────────────────────────────────────────────────────────

/**
 * SQLite `busy_timeout` PRAGMA. With WAL journal in place this only
 * applies to schema-changing writes that block on the writer lock.
 */
export const DB_BUSY_TIMEOUT_MS = 5000;

// ── CLI lifecycle ────────────────────────────────────────────────────

/**
 * Grace period between SIGTERM and SIGKILL when shutting down a CLI
 * child process. Both `cli-spawn` and `cli-process` previously hard-
 * coded `3000`.
 */
export const KILL_GRACE_PERIOD_MS = 3000;

// ── Meeting / consensus pacing ───────────────────────────────────────

/**
 * Default pause between consecutive turns in the meeting orchestrator.
 * Lets renderer subscribers settle before the next `stream:turn` event.
 */
export const INTER_TURN_DELAY_MS = 2000;

/**
 * Default TTL for a `consensus_decision` approval — 24 hours. Picks the
 * longer side of the two original sources (`approval-service` and
 * `meeting-orchestrator`) so neither callsite changes behaviour.
 */
export const CONSENSUS_DECISION_TTL_MS = 24 * 60 * 60 * 1000;

// ── State-machine bounds ─────────────────────────────────────────────

/**
 * Maximum SSM / consensus snapshots retained in memory before the
 * ring-buffer overwrites the oldest. Previously duplicated as a local
 * `MAX_SNAPSHOTS = 100` in `consensus-machine` and
 * `session-state-machine`.
 */
export const MAX_SNAPSHOTS = 100;
