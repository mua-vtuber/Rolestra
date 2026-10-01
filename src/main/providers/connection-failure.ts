/**
 * Turning a failed request into a {@link ConnectionFailure} (QA Medium-1).
 * Shared by the provider connection checks and the Ollama detector.
 */
import type { ConnectionFailure } from '../../shared/connection-failure-types';

const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** The system error code (`ECONNREFUSED`, `ENOTFOUND`, …) behind a fetch failure, if any. */
export function networkErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    const nested = (current as { errors?: unknown }).errors;
    if (Array.isArray(nested) && nested.length > 0) {
      current = nested[0];
      continue;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function httpDetail(status: number): string {
  return `HTTP ${status}`;
}

/** A non-2xx answer: a rejected key, or another HTTP error. */
export function httpFailure(status: number): ConnectionFailure {
  return { code: AUTH_STATUSES.has(status) ? 'auth' : 'http-error', detail: httpDetail(status) };
}

/** A fetch that threw: its time budget ran out, or nothing could be reached. */
export function fetchFailure(error: unknown): ConnectionFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return { code: 'timeout', detail: null };
  return { code: 'network', detail: networkErrorCode(error) };
}

/** The check itself broke (not the connection): kept with its message. */
export function probeFailure(error: unknown): ConnectionFailure {
  return { code: 'probe-failed', detail: error instanceof Error ? error.message : String(error) };
}
