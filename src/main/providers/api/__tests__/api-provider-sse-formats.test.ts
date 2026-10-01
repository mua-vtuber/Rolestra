/**
 * Unit tests for ApiProvider — SSE token/usage parsing per wire format.
 *
 * D1 (2026-09-28): split out of api-provider.test.ts, which exceeded the
 * 800-line file cap. These 3 describe blocks (OpenAI / Anthropic / Google
 * SSE parsing) moved here verbatim (no behavior change); endpoint
 * detection, error responses, abort signal, status management, completion
 * options, and lifecycle stayed in the original file. Header and helpers
 * are duplicated so this file is a self-contained suite.
 *
 * Covers:
 * - OpenAI SSE format parsing (choices[0].delta.content) + usage tracking
 * - Anthropic SSE format parsing (content_block_delta, message_start,
 *   message_delta) + usage tracking + headers/system field
 * - Google SSE format parsing (candidates[0].content.parts[0].text) +
 *   usageMetadata tracking + role mapping (assistant → model) + the
 *   missing-finishReason completion guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiProvider, GoogleBlockedPromptError } from '../api-provider';
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
          'data: {"candidates":[{"content":{"parts":[{"text":" Bar"}]},"finishReason":"STOP"}]}',
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
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":7,"totalTokenCount":22}}',
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
        mockSSEResponse(['data: {"candidates":[{"finishReason":"STOP"}]}']),
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
        mockSSEResponse(['data: {"candidates":[{"finishReason":"STOP"}]}']),
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
          'data: {"candidates":[{"content":{"parts":[{"text":"B"}]},"finishReason":"STOP"}]}',
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

    it('throws when the stream ends without a finishReason', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}',
        ]),
      ));

      await expect(async () => {
        await collectTokens(
          provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
        );
      }).rejects.toThrow('without completion');
    });

    // ── A3: proto3 JSON omits zero-valued usage fields ─────────────────
    //
    // Google's JSON encoding (proto3 JSON) omits a field entirely when its
    // value is the type's zero value — so a chunk with, say, zero candidate
    // tokens so far omits `candidatesTokenCount` rather than sending `0`.
    // Before A3, `googleUsageSchema` required all three token counts, so
    // `safeParse` failed on that chunk and the WHOLE chunk (including its
    // text and any terminal `finishReason`) was silently dropped by the
    // schema-mismatch branch.

    it('does not drop text or finishReason when usageMetadata omits candidatesTokenCount (realistic gemini-2.5-flash first chunk)', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          // First chunk: usageMetadata present but candidatesTokenCount
          // omitted (proto3 JSON drops the zero-valued field for a chunk
          // that has not produced any candidate tokens yet).
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],' +
            '"usageMetadata":{"promptTokenCount":12,"totalTokenCount":12,"thoughtsTokenCount":0}}',
          'data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}],' +
            '"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"totalTokenCount":15}}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
      );

      expect(tokens).toEqual(['Hello', ' world']);
    });

    it('records only the usage fields actually present, without inventing zeros', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],' +
            '"usageMetadata":{"promptTokenCount":12,"totalTokenCount":12}}',
        ]),
      ));

      await collectTokens(provider.streamCompletion([{ role: 'user', content: 'hi' }], ''));

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({ inputTokens: 12, totalTokens: 12 });
    });

    it('handles \\r\\n line endings the same as \\n', async () => {
      const provider = createGoogleProvider();

      const lines = [
        'data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"B"}]},"finishReason":"STOP"}]}',
      ];
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines.join('\r\n') + '\r\n'));
          controller.close();
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
        body, text: async () => lines.join('\n'),
      } as unknown as Response));

      const tokens = await collectTokens(
        provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
      );

      expect(tokens).toEqual(['A', 'B']);
    });

    it('joins text from multiple parts in a single chunk', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello, "},{"text":"world!"}]},"finishReason":"STOP"}]}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
      );

      expect(tokens.join('')).toBe('Hello, world!');
    });

    it('excludes a thought part (thought: true) from the emitted output', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"candidates":[{"content":{"parts":[' +
            '{"text":"Let me think about this...","thought":true},' +
            '{"text":"The answer is 42."}' +
            ']},"finishReason":"STOP"}]}',
        ]),
      ));

      const tokens = await collectTokens(
        provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
      );

      expect(tokens.join('')).toBe('The answer is 42.');
    });

    it('ends with a GoogleBlockedPromptError naming the block reason when the prompt itself is blocked (no candidates)', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"promptFeedback":{"blockReason":"SAFETY"}}',
        ]),
      ));

      // Review follow-up #3: the blocked-prompt path is a dedicated error
      // class re-thrown via `instanceof`, not a message-text match — assert
      // both the class identity and that the message still names the
      // reason, and that `blockReason` itself is exposed on the error.
      let caught: unknown;
      try {
        await collectTokens(
          provider.streamCompletion([{ role: 'user', content: 'hi' }], ''),
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(GoogleBlockedPromptError);
      expect((caught as GoogleBlockedPromptError).blockReason).toBe('SAFETY');
      expect((caught as Error).message).toContain('SAFETY');
    });
  });
});
