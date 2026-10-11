/**
 * Why an AI call failed (spec 2026-10-08 F3). Main classifies a failure from
 * structured information only (HTTP status, errno, a CLI error envelope code,
 * a closed list of CLI sentences) and stores the code; the renderer turns it
 * into a sentence. An unknown cause is stored as nothing — the notice then
 * keeps its general sentence instead of a guessed one.
 *
 * Codes shared with the settings connection check keep the spelling of
 * {@link ConnectionFailureCode}, enforced by `satisfies`, so the two lists
 * cannot drift apart.
 */
import type { ConnectionFailureCode } from './connection-failure-types';

/** Causes that mean the same as a connection-check failure. */
const CAUSES_SHARED_WITH_CONNECTION_CHECK = [
  'key-missing',
  'auth',
  'http-error',
  'network',
  'cli-not-found',
  'cli-failed',
  'local-not-running',
  'local-model-missing',
] as const satisfies readonly ConnectionFailureCode[];

/** Causes that only happen during an AI call. */
const CALL_ONLY_CAUSES = ['cli-login-required', 'rate-limited', 'service-busy', 'request-rejected'] as const;

export const PROVIDER_FAILURE_CAUSES = [...CAUSES_SHARED_WITH_CONNECTION_CHECK, ...CALL_ONLY_CAUSES] as const;

export type ProviderFailureCause = (typeof PROVIDER_FAILURE_CAUSES)[number];

export function isProviderFailureCause(value: unknown): value is ProviderFailureCause {
  return typeof value === 'string' && (PROVIDER_FAILURE_CAUSES as readonly string[]).includes(value);
}
