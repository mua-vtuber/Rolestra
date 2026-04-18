/**
 * Integration tests for ApiProvider — full SSE lifecycle across OpenAI, Anthropic, and Google formats.
 *
 * Covers:
 * - Full create-warmup-stream-usage-cooldown cycles per format
 * - Error recovery (429, 529, network timeout)
 * - Unparseable SSE lines (skip & continue)
 * - Pre-abort and mid-stream abort
 * - Status lifecycle transitions
 * - Multi-format concurrent streaming
 * - Format-specific request headers and body structure
 * - Token usage tracking and consumeLastTokenUsage semantics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiProvider } from '../api-provider';
import type { ApiProviderConfig } from '../../../../shared/provider-types';
import {
  mockSSEResponse,
  collectTokens,
  openAiTokenLines,
  anthropicTokenLines,
  googleTokenLines,
} from '../../../../test-utils';

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
    id: `test-${config.endpoint.replace(/[^a-z0-9]/gi, '-')}`,
    displayName: 'Test',
    model: config.model,
    config,
    resolveApiKey,
  });
}

function createOpenAIProvider() {
  return createProvider(makeConfig({ endpoint: 'https://api.openai.com/v1' }));
}

function createAnthropicProvider() {
  return createProvider(makeConfig({ endpoint: 'https://api.anthropic.com/v1', model: 'claude-3-opus' }));
}

function createGoogleProvider() {
  return createProvider(makeConfig({
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-pro',
  }));
}

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];
const PERSONA = 'You are helpful';

// ── Tests ────────────────────────────────────────────────────────────

describe('ApiProvider SSE Cycle Integration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── 1. OpenAI full cycle ──────────────────────────────────────────

  describe('OpenAI full cycle', () => {
    it('create -> warmup -> stream SSE -> verify tokens -> check usage -> cooldown', async () => {
      const provider = createOpenAIProvider();

      // warmup: mock ping to /v1/models
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true }) // ping
        .mockResolvedValueOnce(
          mockSSEResponse(openAiTokenLines(
            ['Hello', ', ', 'World', '!'],
            { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          )),
        ),
      );

      // warmup
      await provider.warmup();
      expect(provider.getStatus()).toBe('ready');

      // stream
      const tokens = await collectTokens(
        provider.streamCompletion(MESSAGES, PERSONA),
      );
      expect(tokens).toEqual(['Hello', ', ', 'World', '!']);

      // usage
      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      });

      // cooldown
      await provider.cooldown();
      expect(provider.getStatus()).toBe('not-installed');
    });
  });

  // ── 2. Anthropic full cycle ───────────────────────────────────────

  describe('Anthropic full cycle', () => {
    it('create -> warmup -> stream SSE -> verify tokens -> check usage -> cooldown', async () => {
      const provider = createAnthropicProvider();

      // warmup: Anthropic ping POSTs to /v1/messages
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // ping
        .mockResolvedValueOnce(
          mockSSEResponse(anthropicTokenLines(
            ['Bonjour', ' le ', 'monde'],
            { input_tokens: 20, output_tokens: 10 },
          )),
        ),
      );

      await provider.warmup();
      expect(provider.getStatus()).toBe('ready');

      const tokens = await collectTokens(
        provider.streamCompletion(MESSAGES, PERSONA),
      );
      expect(tokens).toEqual(['Bonjour', ' le ', 'monde']);

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
      });

      await provider.cooldown();
      expect(provider.getStatus()).toBe('not-installed');
    });
  });

  // ── 3. Google full cycle ──────────────────────────────────────────

  describe('Google full cycle', () => {
    it('create -> warmup -> stream SSE -> verify tokens -> check usage -> cooldown', async () => {
      const provider = createGoogleProvider();

      // Google uses OpenAI-compatible models endpoint for ping
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true }) // ping /v1/models
        .mockResolvedValueOnce(
          mockSSEResponse(googleTokenLines(
            ['Hallo', ' Welt'],
            { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
          )),
        ),
      );

      await provider.warmup();
      expect(provider.getStatus()).toBe('ready');

      const tokens = await collectTokens(
        provider.streamCompletion(MESSAGES, PERSONA),
      );
      expect(tokens).toEqual(['Hallo', ' Welt']);

      const usage = provider.consumeLastTokenUsage();
      expect(usage).toEqual({
        inputTokens: 8,
        outputTokens: 3,
        totalTokens: 11,
      });

      await provider.cooldown();
      expect(provider.getStatus()).toBe('not-installed');
    });
  });

  // ── 4. Error recovery 429 ────────────────────────────────────────

  describe('error recovery', () => {
    it('429 rate limit propagates with status code', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(provider.streamCompletion(MESSAGES, PERSONA));
      }).rejects.toThrow(/429/);
    });

    // ── 5. Error recovery 529 (Anthropic overloaded) ──────────────

    it('529 Anthropic overloaded propagates', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 529,
        text: async () => 'Overloaded',
      } as unknown as Response));

      await expect(async () => {
        await collectTokens(provider.streamCompletion(MESSAGES, PERSONA));
      }).rejects.toThrow(/529/);
    });

    // ── 6. Network timeout ──────────────────────────────────────────

    it('network timeout rejects fetch', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
        new Error('network timeout'),
      ));

      await expect(async () => {
        await collectTokens(provider.streamCompletion(MESSAGES, PERSONA));
      }).rejects.toThrow('network timeout');
    });
  });

  // ── 7. Unparseable SSE line ───────────────────────────────────────

  describe('SSE parse resilience', () => {
    it('skips broken JSON in SSE stream; valid tokens still yield', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"A"}}]}',
          'data: {BROKEN-JSON-HERE!!!}',
          'data: {"choices":[{"delta":{"content":"B"}}]}',
          'data: [DONE]',
        ]),
      ));

      const tokens = await collectTokens(provider.streamCompletion(MESSAGES, ''));
      expect(tokens).toEqual(['A', 'B']);
    });
  });

  // ── 8. Pre-abort ─────────────────────────────────────────────────

  describe('abort signal', () => {
    it('pre-aborted signal yields empty tokens and fetch not called', async () => {
      const provider = createOpenAIProvider();
      const controller = new AbortController();
      controller.abort();

      vi.stubGlobal('fetch', vi.fn());

      const tokens = await collectTokens(
        provider.streamCompletion(MESSAGES, '', undefined, controller.signal),
      );

      expect(tokens).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // ── 9. Mid-stream abort ─────────────────────────────────────────

    it('mid-stream abort passes signal to fetch', async () => {
      const provider = createOpenAIProvider();
      const controller = new AbortController();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          'data: [DONE]',
        ]),
      ));

      await collectTokens(
        provider.streamCompletion(MESSAGES, '', undefined, controller.signal),
      );

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(call[1]?.signal).toBe(controller.signal);
    });
  });

  // ── 10. Status lifecycle ──────────────────────────────────────────

  describe('status lifecycle', () => {
    it('warmup sets ready, streaming sets busy then back to ready, cooldown sets not-installed', async () => {
      const provider = createOpenAIProvider();
      const statuses: string[] = [];
      provider.onStatusChange((s) => statuses.push(s));

      // warmup
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true }) // ping
        .mockResolvedValueOnce(
          mockSSEResponse(openAiTokenLines(['tok'])),
        ),
      );

      await provider.warmup();
      expect(statuses).toContain('warming-up');
      expect(statuses).toContain('ready');

      // stream
      await collectTokens(provider.streamCompletion(MESSAGES, ''));
      expect(statuses).toContain('busy');

      // After stream completes, should be back to ready
      expect(provider.getStatus()).toBe('ready');

      // cooldown
      await provider.cooldown();
      expect(provider.getStatus()).toBe('not-installed');
      expect(statuses).toContain('not-installed');
    });
  });

  // ── 11. Multi-format concurrent ───────────────────────────────────

  describe('multi-format concurrent', () => {
    it('two providers (OpenAI + Anthropic) stream independently', async () => {
      const openaiProvider = createOpenAIProvider();
      const anthropicProvider = createAnthropicProvider();

      let fetchCallCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        fetchCallCount++;
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return Promise.resolve(mockSSEResponse(
            anthropicTokenLines(['Claude', ' says']),
          ));
        }
        return Promise.resolve(mockSSEResponse(
          openAiTokenLines(['GPT', ' says']),
        ));
      }));

      const [openaiTokens, anthropicTokens] = await Promise.all([
        collectTokens(openaiProvider.streamCompletion(MESSAGES, '')),
        collectTokens(anthropicProvider.streamCompletion(MESSAGES, '')),
      ]);

      expect(openaiTokens).toEqual(['GPT', ' says']);
      expect(anthropicTokens).toEqual(['Claude', ' says']);
      expect(fetchCallCount).toBe(2);
    });
  });

  // ── 12. OpenAI stream_options ─────────────────────────────────────

  describe('format-specific request structure', () => {
    it('openai.com endpoints include stream_options in body', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: [DONE]']),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, ''));

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    // ── 13. Anthropic headers ─────────────────────────────────────

    it('Anthropic requests include x-api-key and anthropic-version headers', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(['data: {"type":"message_stop"}']),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, PERSONA));

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    // ── 14. Google body format ──────────────────────────────────────

    it('Google body includes contents and systemInstruction structure', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse([]),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, 'Be creative'));

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
      expect(body.contents).toBeDefined();
      expect(body.systemInstruction).toBeDefined();

      const contents = body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0].text).toBe('Hello');
    });
  });

  // ── 15. Token usage tracking per format ───────────────────────────

  describe('token usage per format', () => {
    it('OpenAI usage tracked from usage field in SSE chunk', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(openAiTokenLines(
          ['x'],
          { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        )),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, ''));

      const usage = provider.getLastTokenUsage();
      expect(usage).toEqual({ inputTokens: 5, outputTokens: 1, totalTokens: 6 });
    });

    it('Anthropic usage tracked from message_start + message_delta', async () => {
      const provider = createAnthropicProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(anthropicTokenLines(
          ['y'],
          { input_tokens: 30, output_tokens: 15 },
        )),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, ''));

      const usage = provider.getLastTokenUsage();
      expect(usage).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 });
    });

    it('Google usage tracked from usageMetadata', async () => {
      const provider = createGoogleProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(googleTokenLines(
          ['z'],
          { promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11 },
        )),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, ''));

      const usage = provider.getLastTokenUsage();
      expect(usage).toEqual({ inputTokens: 9, outputTokens: 2, totalTokens: 11 });
    });
  });

  // ── 16. consumeLastTokenUsage returns null after consumption ──────

  describe('consumeLastTokenUsage', () => {
    it('returns null after first consumption', async () => {
      const provider = createOpenAIProvider();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockSSEResponse(openAiTokenLines(
          ['a'],
          { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        )),
      ));

      await collectTokens(provider.streamCompletion(MESSAGES, ''));

      const first = provider.consumeLastTokenUsage();
      expect(first).not.toBeNull();

      const second = provider.consumeLastTokenUsage();
      expect(second).toBeNull();
    });
  });
});
