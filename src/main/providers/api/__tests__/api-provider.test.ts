/**
 * Unit tests for ApiProvider — HTTP-based AI provider with SSE streaming.
 *
 * Covers:
 * - OpenAI SSE format parsing (choices[0].delta.content)
 * - Anthropic SSE format parsing (content_block_delta, message_start, message_delta)
 * - Google SSE format parsing (candidates[0].content.parts[0].text)
 * - Token usage tracking (all 3 formats)
 * - Error responses: 429 → propagate, 5xx → propagate, parse errors → warn and skip
 * - AbortError propagation
 * - isAnthropicEndpoint / isGoogleEndpoint detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiProvider } from '../api-provider';
import type { ApiProviderConfig } from '../../../../shared/provider-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ApiProviderConfig> = {}): ApiProviderConfig {
  return {
    type: 'api',
    endpoint: 'https://api.openai.com/v1',
    apiKeyRef: 'test-key-ref',
    model: 'gpt-4',
    ...overrides,
  };
}

function createProvider(
  config: ApiProviderConfig = makeConfig(),
  resolveApiKey = vi.fn().mockResolvedValue('sk-test-key'),
): ApiProvider {
  return new ApiProvider({
    id: 'test-provider',
    displayName: 'Test',
    model: config.model,
    config,
    resolveApiKey,
  });
}

/** Encode SSE lines into a ReadableStream. */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map(line => encoder.encode(line + '\n'));
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Build a mock Response with SSE body. */
function mockSSEResponse(lines: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: sseStream(lines),
    text: async () => lines.join('\n'),
  } as unknown as Response;
}

/** Collect all yielded tokens from an async generator. */
async function collectTokens(gen: AsyncGenerator<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of gen) {
    tokens.push(token);
  }
  return tokens;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ApiProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Endpoint detection ──────────────────────────────────────────

  describe('endpoint detection', () => {
    it('detects Anthropic endpoint', async () => {
      const config = makeConfig({ endpoint: 'https://api.anthropic.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"content_block_delta","delta":{"text":"hello"}}',
          'data: {"type":"message_stop"}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'You are helpful',
        ),
      );

      // Should have called the anthropic messages endpoint
      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
      expect(tokens).toEqual(['hello']);
    });

    it('detects Google endpoint', async () => {
      const config = makeConfig({
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-pro',
      });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'You are helpful',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect((call[0] as string)).toContain('generativelanguage.googleapis.com');
      expect((call[0] as string)).toContain(':streamGenerateContent');
      expect(tokens).toEqual(['world']);
    });

    it('defaults to OpenAI-compatible for unknown endpoints', async () => {
      const config = makeConfig({ endpoint: 'https://my-proxy.example.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"token"}}]}',
          'data: [DONE]',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect((call[0] as string)).toBe('https://my-proxy.example.com/v1/chat/completions');
      expect(tokens).toEqual(['token']);
    });
  });

  // ── OpenAI SSE parsing ──────────────────────────────────────────

  describe('OpenAI SSE parsing', () => {
    it('parses choices[0].delta.content', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}',
          'data: {"choices":[{"delta":{"content":"Hello"}}]}',
          'data: {"choices":[{"delta":{"content":" World"}}]}',
          'data: [DONE]',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'system prompt',
        ),
      );

      expect(tokens).toEqual(['Hello', ' World']);
    });

    it('tracks token usage from OpenAI format', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
          'data: [DONE]',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });

    it('includes stream_options for openai.com endpoints', async () => {
      const config = makeConfig({ endpoint: 'https://api.openai.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: [DONE]']),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('includes stream_options for openrouter.ai endpoints', async () => {
      const config = makeConfig({ endpoint: 'https://openrouter.ai/api/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: [DONE]']),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('does not include stream_options for unknown proxy endpoints', async () => {
      const config = makeConfig({ endpoint: 'https://my-proxy.example.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: [DONE]']),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.stream_options).toBeUndefined();
    });

    it('skips data lines with unparseable JSON', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"A"}}]}',
          'data: {INVALID JSON}',
          'data: {"choices":[{"delta":{"content":"B"}}]}',
          'data: [DONE]',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      expect(tokens).toEqual(['A', 'B']);
    });

    it('skips non-data lines', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          ': comment line',
          'event: message',
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          '',
          'data: [DONE]',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      expect(tokens).toEqual(['ok']);
    });
  });

  // ── Anthropic SSE parsing ───────────────────────────────────────

  describe('Anthropic SSE parsing', () => {
    function createAnthropicProvider() {
      return createProvider(
        makeConfig({ endpoint: 'https://api.anthropic.com/v1' }),
      );
    }

    it('parses content_block_delta text', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}',
          'data: {"type":"content_block_start","content_block":{"type":"text"}}',
          'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
          'data: {"type":"content_block_delta","delta":{"text":" there"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":8}}',
          'data: {"type":"message_stop"}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'system prompt',
        ),
      );

      expect(tokens).toEqual(['Hello', ' there']);
    });

    it('tracks token usage from message_start and message_delta', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":0}}}',
          'data: {"type":"content_block_delta","delta":{"text":"test"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":12}}',
          'data: {"type":"message_stop"}',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 25,
        outputTokens: 12,
        totalTokens: 37,
      });
    });

    it('sends correct headers for Anthropic', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"message_stop"}',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends system as top-level field for Anthropic', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"message_stop"}',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'Be helpful',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.system).toBe('Be helpful');
      // Messages should not contain a system message
      const messages = body.messages as Array<{ role: string }>;
      expect(messages.every(m => m.role !== 'system')).toBe(true);
    });

    it('skips unparseable Anthropic SSE lines', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"content_block_delta","delta":{"text":"A"}}',
          'data: BROKEN',
          'data: {"type":"content_block_delta","delta":{"text":"B"}}',
          'data: {"type":"message_stop"}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      expect(tokens).toEqual(['A', 'B']);
    });
  });

  // ── Google SSE parsing ──────────────────────────────────────────

  describe('Google SSE parsing', () => {
    function createGoogleProvider() {
      return createProvider(
        makeConfig({
          endpoint: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-pro',
        }),
      );
    }

    it('parses candidates[0].content.parts[0].text', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Foo"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":" Bar"}]}}]}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'persona',
        ),
      );

      expect(tokens).toEqual(['Foo', ' Bar']);
    });

    it('tracks token usage from Google usageMetadata', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":7,"totalTokenCount":22}}',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 15,
        outputTokens: 7,
        totalTokens: 22,
      });
    });

    it('sends correct headers and body format for Google', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          'Be creative',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('sk-test-key');

      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.contents).toBeDefined();
      expect(body.systemInstruction).toBeDefined();
    });

    it('maps assistant role to model for Google', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            { role: 'user', content: 'how are you' },
          ],
          '',
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      const contents = body.contents as Array<{ role: string }>;
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
    });

    it('skips unparseable Google SSE lines', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}',
          'data: NOT_JSON',
          'data: {"candidates":[{"content":{"parts":[{"text":"B"}]}}]}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      expect(tokens).toEqual(['A', 'B']);
    });
  });

  // ── Error responses ─────────────────────────────────────────────

  describe('error responses', () => {
    it('propagates 429 rate limit error', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('API error 429');
    });

    it('propagates 500 server error', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('API error 500');
    });

    it('propagates 503 service unavailable error', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('API error 503');
    });

    it('propagates Anthropic error responses', async () => {
      const config = makeConfig({ endpoint: 'https://api.anthropic.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 529,
        text: async () => 'Overloaded',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('Anthropic API error 529');
    });

    it('propagates Google error responses', async () => {
      const config = makeConfig({
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-pro',
      });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Quota exceeded',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('Google API error 429');
    });

    it('throws when API key is not found', async () => {
      const resolver = vi.fn().mockResolvedValue('');
      const provider = createProvider(makeConfig(), resolver);

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion(
            [{ role: 'user', content: 'hi' }],
            '',
          ),
        );
      }).rejects.toThrow('API key not found');
    });
  });

  // ── Abort signal ────────────────────────────────────────────────

  describe('abort signal', () => {
    it('returns immediately when signal is already aborted', async () => {
      const provider = createProvider();
      const controller = new AbortController();
      controller.abort();

      vi.stubGlobal('fetch', vi.fn());

      const tokens = await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
          undefined,
          controller.signal,
        ),
      );

      expect(tokens).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('passes signal to fetch for mid-stream abort', async () => {
      const provider = createProvider();
      const controller = new AbortController();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"partial"}}]}',
          'data: [DONE]',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
          undefined,
          controller.signal,
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(call[1]?.signal).toBe(controller.signal);
    });
  });

  // ── Status management ───────────────────────────────────────────

  describe('status management', () => {
    it('sets status to busy during streaming and back to ready', async () => {
      const provider = createProvider();
      // Pre-warm to set status to ready
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValue(
          mockSSEResponse([
            'data: {"choices":[{"delta":{"content":"hi"}}]}',
            'data: [DONE]',
          ]),
        ),
      );

      await provider.warmup();
      expect(provider.getStatus()).toBe('ready');

      const statuses: string[] = [];
      provider.onStatusChange(s => statuses.push(s));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
        ),
      );

      expect(statuses).toContain('busy');
      expect(provider.getStatus()).toBe('ready');
    });
  });

  // ── Completion options ──────────────────────────────────────────

  describe('completion options', () => {
    it('passes temperature and maxTokens to OpenAI body', async () => {
      const provider = createProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: [DONE]']),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
          { temperature: 0.7, maxTokens: 1000 },
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(1000);
    });

    it('passes temperature to Anthropic body', async () => {
      const config = makeConfig({ endpoint: 'https://api.anthropic.com/v1' });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"type":"message_stop"}',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
          { temperature: 0.5, maxTokens: 2048 },
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2048);
    });

    it('passes temperature and maxOutputTokens to Google body', async () => {
      const config = makeConfig({
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-pro',
      });
      const provider = createProvider(config);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([]),
      ));

      await collectTokens(
        provider.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          '',
          { temperature: 0.3, maxTokens: 512 },
        ),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      const genConfig = body.generationConfig as Record<string, unknown>;
      expect(genConfig.temperature).toBe(0.3);
      expect(genConfig.maxOutputTokens).toBe(512);
    });
  });

  // ── Lifecycle ───────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('warmup validates connection and sets ready', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const provider = createProvider();
      await provider.warmup();
      expect(provider.getStatus()).toBe('ready');
    });

    it('warmup sets error on failed validation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      const provider = createProvider();
      await provider.warmup();
      expect(provider.getStatus()).toBe('error');
    });

    it('cooldown sets not-installed', async () => {
      const provider = createProvider();
      await provider.cooldown();
      expect(provider.getStatus()).toBe('not-installed');
    });

    it('ping returns false when apiKey is empty', async () => {
      const resolver = vi.fn().mockResolvedValue('');
      const provider = createProvider(makeConfig(), resolver);

      const result = await provider.ping();
      expect(result).toBe(false);
    });
  });
});
