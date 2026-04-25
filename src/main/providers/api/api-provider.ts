/**
 * API Provider — HTTP-based AI provider for OpenAI-compatible endpoints.
 *
 * Supports streaming via Server-Sent Events (SSE).
 * Works with OpenAI, Anthropic (Messages API), Google AI, and OpenRouter.
 *
 * The endpoint URL determines the request/response format:
 * - Anthropic endpoints use Messages API format.
 * - All others use OpenAI Chat Completions format (including OpenRouter, local proxies).
 */

import { BaseProvider, type BaseProviderInit } from '../provider-interface';
import type {
  Message,
  CompletionOptions,
  ApiProviderConfig,
} from '../../../shared/provider-types';
import {
  openAiChunkSchema,
  anthropicEventSchema,
  googleChunkSchema,
} from './sse-schemas';

/** Anthropic API version header — required by the Messages API. */
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Default max output tokens when not specified by caller.
 * Used as a fallback for APIs that require an explicit max_tokens.
 */
const DEFAULT_MAX_TOKENS = 4096;

/** Callback to resolve an API key reference to the actual key value. */
export type ApiKeyResolver = (ref: string) => Promise<string>;

export interface ApiProviderInit extends Omit<BaseProviderInit, 'type' | 'capabilities'> {
  resolveApiKey: ApiKeyResolver;
}

export class ApiProvider extends BaseProvider {
  private readonly resolveApiKey: ApiKeyResolver;

  constructor(init: ApiProviderInit) {
    super({
      ...init,
      type: 'api',
      // R11-Task9: 'summarize' 정식 추가 (Anthropic / OpenAI / Google /
      // OpenRouter 등 모든 OpenAI-compatible 엔드포인트가 1-shot 요약을
      // 지원하므로 capability snapshot 에 일관 노출).
      capabilities: ['streaming', 'summarize'],
    });
    this.resolveApiKey = init.resolveApiKey;
  }

  private get apiConfig(): ApiProviderConfig {
    return this.config as ApiProviderConfig;
  }

  private isAnthropicEndpoint(): boolean {
    return this.apiConfig.endpoint.includes('anthropic.com');
  }

  private isGoogleEndpoint(): boolean {
    return this.apiConfig.endpoint.includes('generativelanguage.googleapis.com');
  }

  private supportsOpenAIStreamUsage(): boolean {
    const endpoint = this.apiConfig.endpoint.toLowerCase();
    return endpoint.includes('api.openai.com') || endpoint.includes('openrouter.ai');
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async warmup(): Promise<void> {
    this.setStatus('warming-up');
    try {
      const valid = await this.validateConnection();
      this.setStatus(valid ? 'ready' : 'error');
    } catch {
      this.setStatus('error');
    }
  }

  async cooldown(): Promise<void> {
    this.setStatus('not-installed');
  }

  async validateConnection(): Promise<boolean> {
    try {
      return await this.ping();
    } catch {
      return false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const apiKey = await this.resolveApiKey(this.apiConfig.apiKeyRef);
      if (!apiKey) return false;

      // Simple model list fetch to verify connectivity
      if (this.isAnthropicEndpoint()) {
        const res = await fetch(`${this.apiConfig.endpoint}/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.apiConfig.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok || res.status === 400; // 400 = bad request but API is reachable
      }

      // OpenAI-compatible: try models endpoint
      const res = await fetch(`${this.apiConfig.endpoint}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Streaming ─────────────────────────────────────────────

  async *streamCompletion(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (signal?.aborted) return;

    this.clearLastTokenUsage();
    this.setStatus('busy');
    try {
      const apiKey = await this.resolveApiKey(this.apiConfig.apiKeyRef);
      if (!apiKey) throw new Error('API key not found');

      if (this.isAnthropicEndpoint()) {
        yield* this.streamAnthropic(messages, persona, apiKey, options, signal);
      } else if (this.isGoogleEndpoint()) {
        yield* this.streamGoogle(messages, persona, apiKey, options, signal);
      } else {
        yield* this.streamOpenAI(messages, persona, apiKey, options, signal);
      }
    } finally {
      if (this.status === 'busy') {
        this.setStatus('ready');
      }
    }
  }

  // ── OpenAI-compatible streaming ───────────────────────────

  private async *streamOpenAI(
    messages: Message[],
    persona: string,
    apiKey: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const body = {
      model: this.apiConfig.model,
      messages: [
        ...(persona ? [{ role: 'system' as const, content: persona }] : []),
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      stream: true,
      ...(this.supportsOpenAIStreamUsage() && { stream_options: { include_usage: true } }),
      ...(options?.temperature != null && { temperature: options.temperature }),
      ...(options?.maxTokens != null && { max_tokens: options.maxTokens }),
    };

    const res = await fetch(`${this.apiConfig.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    yield* this.parseSSE(res, signal);
  }

  // ── Anthropic Messages API streaming ─────────────────────

  private async *streamAnthropic(
    messages: Message[],
    persona: string,
    apiKey: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const body = {
      model: this.apiConfig.model,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(persona ? { system: persona } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      ...(options?.temperature != null && { temperature: options.temperature }),
    };

    const res = await fetch(`${this.apiConfig.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    yield* this.parseAnthropicSSE(res, signal);
  }

  // ── Google AI streaming ──────────────────────────────────

  private async *streamGoogle(
    messages: Message[],
    persona: string,
    apiKey: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : '' }],
    }));

    const body = {
      contents,
      ...(persona ? { systemInstruction: { parts: [{ text: persona }] } } : {}),
      generationConfig: {
        ...(options?.temperature != null && { temperature: options.temperature }),
        ...(options?.maxTokens != null && { maxOutputTokens: options.maxTokens }),
      },
    };

    const url = `${this.apiConfig.endpoint}/models/${this.apiConfig.model}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google API error ${res.status}: ${text}`);
    }

    yield* this.parseGoogleSSE(res, signal);
  }

  // ── SSE parsers ───────────────────────────────────────────

  private async *parseSSE(
    res: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;

          try {
            const raw = JSON.parse(data);
            const parsed = openAiChunkSchema.safeParse(raw);
            if (!parsed.success) {
              console.warn('[api-provider] OpenAI SSE schema mismatch:', parsed.error.message);
              continue;
            }
            const { usage, choices } = parsed.data;
            if (usage) {
              this.setLastTokenUsage({
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              });
            }
            const content = choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e;
            const msg = e instanceof Error ? e.message : String(e);
            if (/429|rate.?limit/i.test(msg) || /5\d{2}/.test(msg)) {
              throw new Error(`API error: ${msg}`);
            }
            console.warn('[api-provider] SSE parse skip:', msg);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *parseAnthropicSSE(
    res: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();

          try {
            const raw = JSON.parse(data);
            const parsed = anthropicEventSchema.safeParse(raw);
            if (!parsed.success) {
              // Unknown event type — skip silently (Anthropic may add new events)
              continue;
            }
            const event = parsed.data;
            if (event.type === 'message_start') {
              const input = event.message?.usage?.input_tokens;
              if (input != null) {
                const output = event.message?.usage?.output_tokens ?? 0;
                this.setLastTokenUsage({
                  inputTokens: input,
                  outputTokens: output,
                  totalTokens: input + output,
                });
              }
            }
            if (event.type === 'message_delta') {
              const output = event.usage?.output_tokens;
              if (output != null) {
                const prev = this.getLastTokenUsage();
                const inputTokens = prev?.inputTokens ?? 0;
                this.setLastTokenUsage({
                  inputTokens,
                  outputTokens: output,
                  totalTokens: inputTokens + output,
                });
              }
            }
            if (event.type === 'content_block_delta') {
              const text = event.delta?.text;
              if (text) {
                yield text;
              }
            }
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e;
            const msg = e instanceof Error ? e.message : String(e);
            if (/429|rate.?limit/i.test(msg) || /5\d{2}/.test(msg)) {
              throw new Error(`API error: ${msg}`);
            }
            console.warn('[api-provider] SSE parse skip:', msg);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *parseGoogleSSE(
    res: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();

          try {
            const raw = JSON.parse(data);
            const parsed = googleChunkSchema.safeParse(raw);
            if (!parsed.success) {
              console.warn('[api-provider] Google SSE schema mismatch:', parsed.error.message);
              continue;
            }
            const { usageMetadata, candidates } = parsed.data;
            if (usageMetadata) {
              this.setLastTokenUsage({
                inputTokens: usageMetadata.promptTokenCount,
                outputTokens: usageMetadata.candidatesTokenCount,
                totalTokens: usageMetadata.totalTokenCount,
              });
            }
            const text = candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
            }
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e;
            const msg = e instanceof Error ? e.message : String(e);
            if (/429|rate.?limit/i.test(msg) || /5\d{2}/.test(msg)) {
              throw new Error(`API error: ${msg}`);
            }
            console.warn('[api-provider] SSE parse skip:', msg);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

}
