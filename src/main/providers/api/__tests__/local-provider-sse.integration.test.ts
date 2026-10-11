/**
 * Integration tests for LocalProvider — SSE streaming with local inference servers.
 *
 * Covers:
 * - Warmup ping success (primary /v1/models endpoint)
 * - Warmup ping fallback (/v1/models fails -> /api/tags succeeds)
 * - Full stream cycle (warmup -> stream -> tokens -> usage)
 * - Token usage tracking from OpenAI-compatible format
 * - Abort signal support
 * - Server error propagation (500 response)
 * - Warmup failure sets not-installed status
 * - Cooldown resets to not-installed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalProvider } from '../../local/local-provider';
import type { LocalProviderConfig } from '../../../../shared/provider-types';
import {
  mockSSEResponse,
  collectTokens,
  openAiTokenLines,
} from '../../../../test-utils';

// ── Helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<LocalProviderConfig> = {}): LocalProviderConfig {
  return {
    type: 'local',
    baseUrl: 'http://localhost:11434',
    model: 'llama2',
    ...overrides,
  };
}

function createLocalProvider(config: LocalProviderConfig = makeConfig()): LocalProvider {
  return new LocalProvider({
    id: 'local-test',
    displayName: 'Test Local',
    model: config.model,
    config,
  });
}

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];

// ── Tests ────────────────────────────────────────────────────────────

describe('LocalProvider SSE Integration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── 1. Warmup ping success ─────────────────────────────────────────

  it('warmup ping success via /v1/models sets status to ready', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');
  });

  // ── 2. Warmup ping fallback ────────────────────────────────────────

  it('warmup ping fallback: /v1/models fails, /api/tags succeeds -> ready', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/v1/models')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (typeof url === 'string' && url.includes('/api/tags')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false });
    }));

    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');
  });

  // ── 3. Full stream cycle ───────────────────────────────────────────

  it('warmup -> stream (OpenAI-compatible SSE) -> tokens -> usage', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true }) // ping
      .mockResolvedValueOnce(
        mockSSEResponse(openAiTokenLines(
          ['Local', ' model', ' response'],
          { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        )),
      ),
    );

    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');

    const tokens = await collectTokens(
      provider.streamCompletion(MESSAGES, 'You are helpful'),
    );
    expect(tokens).toEqual(['Local', ' model', ' response']);

    const usage = provider.consumeLastTokenUsage();
    expect(usage).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
  });

  // ── 4. Token usage tracking ────────────────────────────────────────

  it('tracks token usage from OpenAI-compatible format', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockSSEResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}',
        'data: [DONE]',
      ]),
    ));

    await collectTokens(provider.streamCompletion(MESSAGES, ''));

    const usage = provider.consumeLastTokenUsage();
    expect(usage).toEqual({
      inputTokens: 7,
      outputTokens: 2,
      totalTokens: 9,
    });
  });

  // ── 5. Abort signal support ────────────────────────────────────────

  it('abort signal is passed to fetch and pre-aborted signal yields empty', async () => {
    const provider = createLocalProvider();
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal('fetch', vi.fn());

    const tokens = await collectTokens(
      provider.streamCompletion(MESSAGES, '', undefined, controller.signal),
    );

    expect(tokens).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ── 6. Server error propagation ────────────────────────────────────

  it('500 server error propagates', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as unknown as Response));

    await expect(async () => {
      await collectTokens(provider.streamCompletion(MESSAGES, ''));
    }).rejects.toThrow(/500/);
  });

  // ── 6b. Structured output and failure causes (spec 2026-10-08) ─────

  it('sends response_format json_schema only when structuredOutput is given', async () => {
    const provider = createLocalProvider();
    const fetchMock = vi.fn().mockImplementation(async () => mockSSEResponse(['data: [DONE]']));
    vi.stubGlobal('fetch', fetchMock);
    const schema = { type: 'object' as const, properties: { reply: { type: 'string' as const } } };

    await collectTokens(provider.streamCompletion(MESSAGES, '', { structuredOutput: { name: 'private_reply', schema } }));
    await collectTokens(provider.streamCompletion(MESSAGES, ''));

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>);
    expect(bodies[0]?.response_format).toEqual({
      type: 'json_schema', json_schema: { name: 'private_reply', strict: true, schema },
    });
    expect(bodies[0]?.stream).toBe(true);
    expect(bodies[1]).not.toHaveProperty('response_format');
  });

  it('names a missing model on 404 and a stopped server on ECONNREFUSED', async () => {
    const provider = createLocalProvider(makeConfig({ model: 'gemma4:e4b' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => 'model not found',
    } as unknown as Response));
    await expect(collectTokens(provider.streamCompletion(MESSAGES, ''))).rejects.toMatchObject({
      failureCause: 'local-model-missing', failureDetail: 'gemma4:e4b',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })));
    await expect(collectTokens(provider.streamCompletion(MESSAGES, ''))).rejects.toMatchObject({
      failureCause: 'local-not-running', failureDetail: null,
    });
  });

  it('names a rejected request on 400 (no retry without the schema)', async () => {
    const provider = createLocalProvider();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'response_format not supported',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(collectTokens(provider.streamCompletion(MESSAGES, '', {
      structuredOutput: { name: 'room_turn', schema: { type: 'object' } },
    }))).rejects.toMatchObject({ failureCause: 'request-rejected', failureDetail: 'HTTP 400' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── 7. Warmup failure sets not-installed ───────────────────────────

  it('warmup failure when both endpoints fail sets not-installed', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await provider.warmup();
    expect(provider.getStatus()).toBe('not-installed');
  });

  // ── 8. Cooldown resets to not-installed ────────────────────────────

  it('cooldown resets status to not-installed', async () => {
    const provider = createLocalProvider();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');

    await provider.cooldown();
    expect(provider.getStatus()).toBe('not-installed');
  });
});
