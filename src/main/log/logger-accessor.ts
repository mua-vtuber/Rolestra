/**
 * Lazy accessor for the app-wide {@link StructuredLogger}.
 *
 * Promoted from `ipc/handlers/log-handler.ts` (R7) so non-IPC modules
 * (approval-service, queue-service, etc.) can route their own warnings
 * through the same logger without each owning a redundant accessor.
 *
 * Wiring contract: `src/main/index.ts` calls {@link setLoggerAccessor}
 * once at app startup with a thunk that returns the singleton logger.
 * Modules call {@link getLogger} when they need to log; if the accessor
 * is not yet wired (boot before bootstrap, or test harness without a
 * logger), they fall back to `console`-shape stubs via
 * {@link getLoggerOrConsole}. F5-T8.
 */

import type { StructuredLogger } from './structured-logger';

let loggerAccessor: (() => StructuredLogger) | null = null;

/**
 * Wires the app-wide accessor. Idempotent: replacing the accessor
 * during a hot-reload test is allowed (the underlying logger is what
 * holds the buffer/file handles).
 */
export function setLoggerAccessor(fn: () => StructuredLogger): void {
  loggerAccessor = fn;
}

/**
 * Resets the accessor — for test harnesses that want a clean slate
 * between cases.
 */
export function clearLoggerAccessor(): void {
  loggerAccessor = null;
}

/**
 * Returns the wired logger, or `null` when no accessor was registered
 * yet (test isolation, very-early-boot). Callers that want a guaranteed
 * sink should use {@link getLoggerOrConsole} instead.
 */
export function tryGetLogger(): StructuredLogger | null {
  if (!loggerAccessor) return null;
  return loggerAccessor();
}

/**
 * Strict accessor — throws when the logger is not wired. IPC handlers
 * and any callsite reachable only after `setLoggerAccessor` ran can use
 * this without checking for null.
 */
export function getLogger(): StructuredLogger {
  if (!loggerAccessor) {
    throw new Error('StructuredLogger accessor not initialized');
  }
  return loggerAccessor();
}
