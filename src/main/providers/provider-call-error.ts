/**
 * Failed AI calls whose cause is known (spec 2026-10-08 F3). Providers throw
 * these; the chat layer stores the cause code (`describeChatFailure`) and the
 * renderer turns it into a sentence telling the user what to do.
 *
 * Classification reads structured information only: the HTTP status, a few
 * structured error fields of a JSON body, and the errno of a fetch failure.
 * `failureDetail` is a short marker the app builds (`HTTP 503`, `ENOTFOUND`,
 * the configured model name) — never provider text, a key or a path. The
 * error message keeps the full text for the log, as before.
 */
import type { ProviderFailureCause } from '../../shared/provider-failure-types';
import { httpDetail, networkErrorCode } from './connection-failure';
import { ProviderUsageLimitError } from './provider-usage-limit-error';

/** Longest `failureDetail` stored (the configured model name is cut to this). */
export const PROVIDER_FAILURE_DETAIL_MAX_CHARS = 100;

/** errno values safe to show: `ENOTFOUND`, `ECONNRESET`, … */
const ERRNO_DETAIL = /^E[A-Z0-9_]{1,40}$/;
/** Node internal error codes (`ERR_INVALID_URL`, …) also match ERRNO_DETAIL but are not errno. */
const NODE_INTERNAL_CODE_PREFIX = 'ERR_';

/** A provider call failure with a known cause. `message` is for the log. */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly failureCause: ProviderFailureCause,
    readonly failureDetail: string | null,
  ) {
    super(message);
    this.name = 'ProviderCallError';
  }
}

/** The API key the AI points at is not stored. */
export class ApiKeyMissingError extends ProviderCallError {
  constructor(message: string) {
    super(message, 'key-missing', null);
    this.name = 'ApiKeyMissingError';
  }
}

type HttpTarget = { kind: 'api' } | { kind: 'local'; model: string };

/** Reads the structured error fields of a JSON error body, if it is one. */
function bodyErrorFields(bodyText: string): { code: unknown; reasons: unknown[] } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  return {
    code: (error as { code?: unknown }).code,
    reasons: Array.isArray(details)
      ? details.map((item: unknown) => (item && typeof item === 'object' ? (item as { reason?: unknown }).reason : undefined))
      : [],
  };
}

function causeForStatus(status: number, target: HttpTarget): ProviderFailureCause {
  if (status === 401 || status === 403) return target.kind === 'local' ? 'http-error' : 'auth';
  if (status === 404) return target.kind === 'local' ? 'local-model-missing' : 'request-rejected';
  if (status === 400 || status === 413 || status === 422) return 'request-rejected';
  if (status === 429) return 'rate-limited';
  if (status === 503 || status === 504 || status === 529) return 'service-busy';
  return 'http-error';
}

/** A non-2xx response. 401/403 and 404 read differently for an API service and a local server. */
export function httpCallError(label: string, status: number, bodyText: string, target: HttpTarget): Error {
  const message = `${label} ${status}: ${bodyText}`;
  const fields = bodyErrorFields(bodyText);
  if (fields?.code === 'insufficient_quota') return new ProviderUsageLimitError(message);
  if (fields?.reasons.includes('API_KEY_INVALID')) return new ProviderCallError(message, 'auth', httpDetail(status));
  const cause = causeForStatus(status, target);
  const detail = cause === 'local-model-missing' && target.kind === 'local'
    ? target.model.slice(0, PROVIDER_FAILURE_DETAIL_MAX_CHARS)
    : httpDetail(status);
  return new ProviderCallError(message, cause, detail);
}

/**
 * An error `fetch` threw. Abort and timeout errors come back untouched: the
 * caller decides between its own time limit and a closed room. Only a
 * recognized errno is classified; any other failure (no errno, a code such as
 * undici's `UND_ERR_*`, or a Node internal `ERR_*` code, which names a program
 * error rather than a connection one) also comes back untouched, so the notice
 * keeps its general sentence instead of guessing "check your connection".
 */
export function fetchCallError(error: unknown, target: 'api' | 'local'): unknown {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return error;
  const errno = networkErrorCode(error);
  if (errno === null || errno.startsWith(NODE_INTERNAL_CODE_PREFIX) || !ERRNO_DETAIL.test(errno)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (target === 'local' && errno === 'ECONNREFUSED') {
    return new ProviderCallError(message, 'local-not-running', null);
  }
  return new ProviderCallError(message, 'network', errno);
}

/**
 * An Anthropic Messages stream `error` event, by its `error.type` only. An
 * unlisted type stays a plain failure (cause unknown).
 */
export function anthropicStreamError(type: string): Error {
  const message = `Anthropic API stream error: ${type}`;
  switch (type) {
    case 'overloaded_error': return new ProviderCallError(message, 'service-busy', null);
    case 'rate_limit_error': return new ProviderCallError(message, 'rate-limited', null);
    case 'authentication_error':
    case 'permission_error': return new ProviderCallError(message, 'auth', null);
    default: return new Error(message);
  }
}
