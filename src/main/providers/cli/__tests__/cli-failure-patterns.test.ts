import { describe, expect, it } from 'vitest';
import { cliFailureFrom, cliSpawnFailure, hasKnownCliCause } from '../cli-failure-patterns';
import { ProviderCallError } from '../../provider-call-error';
import { ProviderUsageLimitError } from '../../provider-usage-limit-error';

function causeOf(error: Error): string {
  if (!(error instanceof ProviderCallError)) throw new Error(`not a ProviderCallError: ${error.message}`);
  expect(error.failureDetail).toBeNull();
  return error.failureCause;
}

describe('cliFailureFrom (spec 2026-10-08 F3)', () => {
  it('reads the logged Claude login failure as a login problem', () => {
    expect(causeOf(cliFailureFrom('Failed to authenticate: OAuth session expired and could not be refreshed')))
      .toBe('cli-login-required');
    expect(causeOf(cliFailureFrom('Invalid API key · Please run /login'))).toBe('cli-login-required');
    expect(causeOf(cliFailureFrom('Error: Not logged in'))).toBe('cli-login-required');
    expect(causeOf(cliFailureFrom('API Error: 401 Unauthorized'))).toBe('cli-login-required');
  });

  it.each([
    ['authentication_failed', 'cli-login-required'],
    ['rate_limit', 'rate-limited'],
    ['server_error', 'service-busy'],
    ['invalid_request', 'request-rejected'],
  ])('reads the envelope code %s as %s', (code, cause) => {
    expect(causeOf(cliFailureFrom('Something went wrong', code))).toBe(cause);
  });

  it('reads rate limit and overload sentences', () => {
    expect(causeOf(cliFailureFrom('API Error: 429 Too Many Requests'))).toBe('rate-limited');
    expect(causeOf(cliFailureFrom('Rate limit reached for requests'))).toBe('rate-limited');
    expect(causeOf(cliFailureFrom('API Error: 529 {"type":"overloaded_error"}'))).toBe('service-busy');
    expect(causeOf(cliFailureFrom('503 Service Unavailable'))).toBe('service-busy');
  });

  it('keeps the usage limit rules, plus the billing_error code', () => {
    for (const message of [
      'You’ve hit your weekly limit · resets 3am',
      "You've hit your session limit",
      'Quota exceeded. Check your plan and billing details.',
      'Your workspace is out of credits.',
    ]) {
      expect(cliFailureFrom(message)).toBeInstanceOf(ProviderUsageLimitError);
    }
    expect(cliFailureFrom('limit', 'usage_limit_reached')).toBeInstanceOf(ProviderUsageLimitError);
    expect(cliFailureFrom('billing', 'billing_error')).toBeInstanceOf(ProviderUsageLimitError);
  });

  it('falls back to cli-failed with the old log message', () => {
    const error = cliFailureFrom('unexpected crash', 'error_during_execution');
    expect(causeOf(error)).toBe('cli-failed');
    expect(error.message).toBe('CLI command failed: unexpected crash');
  });

  it('re-reads an unclassified failure with its stderr tail without doubling the log prefix', () => {
    const first = cliFailureFrom('CLI result error_during_execution');
    expect(hasKnownCliCause(first)).toBe(false);
    const again = cliFailureFrom(first.message, undefined, 'Error: Not logged in\n');
    expect(causeOf(again)).toBe('cli-login-required');
    expect(again.message).toBe('CLI command failed: CLI result error_during_execution: Error: Not logged in');
    expect(hasKnownCliCause(again)).toBe(true);
    expect(hasKnownCliCause(new Error('plain'))).toBe(false);
  });

  it('ignores the rule words in stderr lines that are not the CLI error statement (QA 2026-10-08)', () => {
    const stderr = [
      'Reading prompt from stdin...',
      'user said: I am not logged in anywhere, mind the rate limit',
      'retrying after 429ms backoff window',
      'note: the server was overloaded yesterday',
    ].join('\n');
    expect(causeOf(cliFailureFrom('CLI returned no output', undefined, stderr))).toBe('cli-failed');
  });

  it('classifies the stderr error lines, with or without a time stamp', () => {
    const progress = 'Reading prompt from stdin...\n';
    expect(causeOf(cliFailureFrom('CLI process failed', undefined, `${progress}Error: Not logged in`)))
      .toBe('cli-login-required');
    expect(causeOf(cliFailureFrom('CLI process failed', undefined,
      `${progress}2026-10-08T10:00:00Z ERROR codex_core: unexpected status 429 Too Many Requests`)))
      .toBe('rate-limited');
    expect(causeOf(cliFailureFrom('CLI process failed', undefined, `${progress}[12:00:01] API Error: 529 overloaded`)))
      .toBe('service-busy');
    expect(causeOf(cliFailureFrom('CLI process failed', undefined,
      'Failed to authenticate: OAuth session expired and could not be refreshed'))).toBe('cli-login-required');
  });

  it('keeps the whole stderr in the log message so a missing session is still recognized', () => {
    const error = cliFailureFrom('CLI result error_during_execution', undefined,
      'No conversation found with session ID: saved-id\n');
    expect(causeOf(error)).toBe('cli-failed');
    expect(error.message).toContain('No conversation found with session ID: saved-id');
  });

  it('still reads the usage-limit sentences anywhere in stderr', () => {
    expect(cliFailureFrom('CLI process failed', undefined, "You've hit your usage limit. Try again later."))
      .toBeInstanceOf(ProviderUsageLimitError);
  });
});

describe('cliSpawnFailure', () => {
  it('reads ENOENT as a missing CLI and another errno as a failed CLI', () => {
    expect(causeOf(cliSpawnFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))))
      .toBe('cli-not-found');
    expect(causeOf(cliSpawnFailure(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))))
      .toBe('cli-failed');
  });

  it('returns an error without errno untouched', () => {
    const error = new Error('boom');
    expect(cliSpawnFailure(error)).toBe(error);
  });
});
