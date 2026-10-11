/**
 * Why a chat CLI call failed (spec 2026-10-08 F3). One closed table: the
 * error envelope's code field when the CLI gives one, otherwise known
 * sentences of the CLI's own error statement, all case-insensitive. A
 * sentence that changes with a CLI release falls through to `cli-failed` —
 * it never shows a wrong cause. The detail stays null here: the chat layer
 * names the CLI from the provider's config, never from CLI text.
 *
 * stderr mixes the CLI's error with other text (progress lines, warnings,
 * the echoed prompt), so the sentence rules read only its lines that start
 * with a known error prefix; a stray "rate limit" or "not logged in" in any
 * other line never makes a cause. The usage-limit sentences are specific
 * enough to keep reading the whole stderr, as before.
 */
import { ProviderCallError } from '../provider-call-error';
import { ProviderUsageLimitError } from '../provider-usage-limit-error';
import type { ProviderFailureCause } from '../../../shared/provider-failure-types';

interface FailureRule {
  cause: ProviderFailureCause;
  codes: readonly string[];
  patterns: readonly RegExp[];
}

/** Usage allowance exhausted: the existing "사용량 한도" notice. */
const USAGE_LIMIT_CODES: readonly string[] = ['usage_limit_reached', 'billing_error'];
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /\byou['’]ve hit your (?:session|weekly|usage) limit\b/i,
  /\b(?:Quota exceeded\.|Your workspace is out of credits\.)/i,
];

/** Checked in order; the first match wins. */
const FAILURE_RULES: readonly FailureRule[] = [
  {
    cause: 'cli-login-required',
    codes: ['authentication_failed'],
    patterns: [
      /\bFailed to authenticate\b/i,
      /\bOAuth (?:session|token)\b[^\n]*\bexpired\b/i,
      /\bnot logged in\b/i,
      /\bplease run \/login\b/i,
      /\b401 Unauthorized\b/i,
    ],
  },
  { cause: 'rate-limited', codes: ['rate_limit'], patterns: [/\b429\b/, /\brate[ _-]?limit/i] },
  {
    cause: 'service-busy',
    codes: ['server_error'],
    patterns: [/\b529\b/, /\boverloaded\b/i, /\b503 Service Unavailable\b/i],
  },
  { cause: 'request-rejected', codes: ['invalid_request'], patterns: [] },
];

function hasCode(code: unknown, codes: readonly string[]): boolean {
  return typeof code === 'string' && codes.includes(code.toLowerCase());
}

const CLI_FAILED_PREFIX = 'CLI command failed: ';

/**
 * A stderr line that is the CLI's own error statement: an optional
 * `[time]` or ISO time stamp, then `Error` / `API Error` / `ERROR` / `fatal`,
 * or the login sentences `Failed to authenticate` / `Invalid API key`.
 */
const STDERR_ERROR_LINE =
  /^\s*(?:\[[^\]]*\]\s*|\d{4}-\d{2}-\d{2}T\S+\s+)?(?:(?:api\s+)?error\b|fatal\b|failed to authenticate\b|invalid api key\b)/i;

function stderrErrorLines(stderr: string): string {
  return stderr.split(/\r?\n/).filter((line) => STDERR_ERROR_LINE.test(line)).join('\n');
}

/**
 * Classifies a CLI failure from its error envelope code, its error statement
 * (`message`: envelope text or an app-made failure sentence) and the error
 * lines of its `stderr`. The log message keeps the whole stderr after the
 * statement, so the missing-session check still reads it. A message that
 * already carries the log prefix (an unclassified failure re-read with its
 * stderr tail) keeps one prefix.
 */
export function cliFailureFrom(message: string, code?: unknown, stderr?: string): Error {
  const stderrText = stderr?.trim() ?? '';
  const full = stderrText ? `${message}: ${stderrText}` : message;
  if (hasCode(code, USAGE_LIMIT_CODES) || USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(full))) {
    return new ProviderUsageLimitError(full);
  }
  const logMessage = full.startsWith(CLI_FAILED_PREFIX) ? full : `${CLI_FAILED_PREFIX}${full}`;
  const statement = stderrText ? `${message}\n${stderrErrorLines(stderrText)}` : message;
  const rule = FAILURE_RULES.find((item) =>
    hasCode(code, item.codes) || item.patterns.some((pattern) => pattern.test(statement)));
  return new ProviderCallError(logMessage, rule?.cause ?? 'cli-failed', null);
}

/**
 * True when a CLI failure already has a cause more specific than
 * `cli-failed`. Only such an error skips the chat path's stderr re-read, which
 * still needs the stderr tail to spot a missing native session.
 */
export function hasKnownCliCause(error: unknown): boolean {
  return error instanceof ProviderCallError && error.failureCause !== 'cli-failed';
}

/** An error `spawn` raised: a missing executable, or another system error. */
export function cliSpawnFailure(error: unknown): Error {
  const errno = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (errno === 'ENOENT') return new ProviderCallError(message, 'cli-not-found', null);
  if (typeof errno === 'string') return new ProviderCallError(message, 'cli-failed', null);
  return error instanceof Error ? error : new Error(message);
}
