import { describe, expect, it } from 'vitest';
import {
  anthropicStreamError, ApiKeyMissingError, fetchCallError, httpCallError, PROVIDER_FAILURE_DETAIL_MAX_CHARS,
  ProviderCallError,
} from '../provider-call-error';
import { ProviderUsageLimitError } from '../provider-usage-limit-error';

const API = { kind: 'api' } as const;
const LOCAL = { kind: 'local', model: 'gemma4:e4b' } as const;

function causeOf(error: unknown): [string, string | null] {
  if (!(error instanceof ProviderCallError)) throw new Error(`not a ProviderCallError: ${String(error)}`);
  return [error.failureCause, error.failureDetail];
}

describe('httpCallError (spec 2026-10-08 F3)', () => {
  it.each([
    [401, 'auth'], [403, 'auth'], [404, 'request-rejected'], [400, 'request-rejected'],
    [413, 'request-rejected'], [422, 'request-rejected'], [429, 'rate-limited'],
    [503, 'service-busy'], [504, 'service-busy'], [529, 'service-busy'], [500, 'http-error'], [502, 'http-error'],
  ])('API %i -> %s with an HTTP marker', (status, cause) => {
    expect(causeOf(httpCallError('API error', status, 'body', API))).toEqual([cause, `HTTP ${status}`]);
  });

  it.each([
    [401, 'http-error'], [403, 'http-error'], [400, 'request-rejected'], [413, 'request-rejected'],
    [422, 'request-rejected'], [429, 'rate-limited'], [503, 'service-busy'], [504, 'service-busy'],
    [529, 'service-busy'], [500, 'http-error'],
  ])('local %i -> %s with an HTTP marker', (status, cause) => {
    expect(causeOf(httpCallError('Local LLM error', status, 'body', LOCAL))).toEqual([cause, `HTTP ${status}`]);
  });

  it('local 404 names the configured model, cut to the detail limit', () => {
    expect(causeOf(httpCallError('Local LLM error', 404, 'model not found', LOCAL)))
      .toEqual(['local-model-missing', 'gemma4:e4b']);
    const long = 'm'.repeat(PROVIDER_FAILURE_DETAIL_MAX_CHARS + 20);
    expect(causeOf(httpCallError('Local LLM error', 404, '', { kind: 'local', model: long }))[1])
      .toHaveLength(PROVIDER_FAILURE_DETAIL_MAX_CHARS);
  });

  it('reads OpenAI insufficient_quota as the usage limit and Google API_KEY_INVALID as auth', () => {
    const quota = httpCallError('API error', 429,
      JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your quota' } }), API);
    expect(quota).toBeInstanceOf(ProviderUsageLimitError);
    const google = httpCallError('Google API error', 400, JSON.stringify({ error: {
      code: 400, message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }],
    } }), API);
    expect(causeOf(google)).toEqual(['auth', 'HTTP 400']);
  });

  it('keeps the body in the log message only, never in the detail', () => {
    const error = httpCallError('API error', 503, 'provider text', API) as ProviderCallError;
    expect(error.message).toBe('API error 503: provider text');
    expect(error.failureDetail).toBe('HTTP 503');
  });
});

describe('fetchCallError', () => {
  const withCode = (code: string): Error => Object.assign(new TypeError('fetch failed'), { cause: { code } });

  it('returns abort and timeout errors untouched', () => {
    const abort = new DOMException('aborted', 'AbortError');
    const timeout = new DOMException('timed out', 'TimeoutError');
    expect(fetchCallError(abort, 'api')).toBe(abort);
    expect(fetchCallError(timeout, 'local')).toBe(timeout);
  });

  it('reads a refused local connection as a stopped local server, elsewhere as a network failure', () => {
    expect(causeOf(fetchCallError(withCode('ECONNREFUSED'), 'local'))).toEqual(['local-not-running', null]);
    expect(causeOf(fetchCallError(withCode('ECONNREFUSED'), 'api'))).toEqual(['network', 'ECONNREFUSED']);
    expect(causeOf(fetchCallError(withCode('ENOTFOUND'), 'api'))).toEqual(['network', 'ENOTFOUND']);
  });

  it('leaves a failure without a recognized errno unclassified (no guessed cause)', () => {
    const undici = withCode('UND_ERR_SOCKET');
    expect(fetchCallError(undici, 'api')).toBe(undici);
    // A malformed stored key makes an invalid header value: not a network problem.
    const header = new TypeError('Headers.append: "Bearer x y" is an invalid header value.');
    expect(fetchCallError(header, 'api')).toBe(header);
    const bare = new TypeError('fetch failed');
    expect(fetchCallError(bare, 'local')).toBe(bare);
    // A Node internal code fits the errno shape but names a program error.
    const internal = withCode('ERR_INVALID_URL');
    expect(fetchCallError(internal, 'api')).toBe(internal);
  });
});

describe('ApiKeyMissingError and Anthropic stream errors', () => {
  it('a missing key is key-missing without detail', () => {
    expect(causeOf(new ApiKeyMissingError('API key not found: ref'))).toEqual(['key-missing', null]);
  });

  it.each([
    ['overloaded_error', 'service-busy'], ['rate_limit_error', 'rate-limited'],
    ['authentication_error', 'auth'], ['permission_error', 'auth'],
  ])('%s -> %s', (type, cause) => {
    expect(causeOf(anthropicStreamError(type))).toEqual([cause, null]);
  });

  it('an unlisted stream error type stays a plain failure', () => {
    const error = anthropicStreamError('api_error');
    expect(error).not.toBeInstanceOf(ProviderCallError);
    expect(error.message).toContain('api_error');
  });
});
