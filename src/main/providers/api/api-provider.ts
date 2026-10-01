/**
 * API Provider — HTTP-based AI provider for OpenAI-compatible endpoints.
 *
 * Supports streaming via Server-Sent Events (SSE).
 * Works with OpenAI, Anthropic (Messages API), Google AI, and OpenRouter.
 *
 * The endpoint URL determines the request/response format:
 * - Anthropic endpoints use Messages API format.
 * - Codex models on api.openai.com use the Responses API.
 * - Other endpoints use OpenAI Chat Completions format (including OpenRouter, local proxies).
 */

import { BaseProvider, type BaseProviderInit, type TokenUsage } from '../provider-interface';
import type { ConnectionFailure } from '../../../shared/connection-failure-types';
import { API_CONNECTION_CHECK_TIMEOUT_MS } from '../../../shared/timeouts';
import { fetchFailure, httpFailure } from '../connection-failure';
import type {
  Message,
  CompletionOptions,
  ApiProviderConfig,
} from '../../../shared/provider-types';
import {
  openAiChunkSchema,
  openAiResponseEventSchema,
  anthropicEventSchema,
  googleChunkSchema,
} from './sse-schemas';
import { resolveApiCapabilities } from '../capability-resolver';
import { tryGetLogger } from '../../log/logger-accessor';

/** Anthropic API version header — required by the Messages API. */
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Default max output tokens when not specified by caller.
 * Used as a fallback for APIs that require an explicit max_tokens.
 */
const DEFAULT_MAX_TOKENS = 4096;

/** Callback to resolve an API key reference to the actual key value. */
export type ApiKeyResolver = (ref: string) => Promise<string>;

/**
 * Thrown by `parseGoogleSSE` when Google blocks the PROMPT itself
 * (`promptFeedback.blockReason`, no candidates produced at all). A
 * dedicated class lets the outer catch re-throw it via `instanceof`
 * instead of matching on the error message text, which would silently
 * misclassify any other error that happened to contain the same words.
 */
export class GoogleBlockedPromptError extends Error {
  constructor(public readonly blockReason: string) {
    super(`Google Generative AI blocked the prompt: ${blockReason}`);
    this.name = 'GoogleBlockedPromptError';
  }
}

export interface ApiProviderInit extends Omit<BaseProviderInit, 'type' | 'capabilities'> {
  resolveApiKey: ApiKeyResolver;
}

export class ApiProvider extends BaseProvider {
  private readonly resolveApiKey: ApiKeyResolver;

  constructor(init: ApiProviderInit) {
    const apiConfig = init.config as ApiProviderConfig;
    super({
      ...init,
      type: 'api',
      // 결재 3번 (A, 2026-05-19): endpoint 별 실제 능력 매트릭스 채우기.
      // Anthropic / OpenAI / Google / OpenRouter 각 endpoint 가 지원하는
      // tools / multimodal / json-mode 를 capability snapshot 에 정직히 노출.
      // R11-Task9 의 streaming + summarize 일관 노출은 resolver 의 공통
      // baseline 에 보존.
      capabilities: resolveApiCapabilities(apiConfig.endpoint),
    });
    this.resolveApiKey = init.resolveApiKey;
  }

  private get apiConfig(): ApiProviderConfig {
    return this.config as ApiProviderConfig;
  }

  /**
   * Routes an SSE parse-skip warning through the app logger when one is
   * wired, falling back to `console.warn` only when it is not (e.g. very
   * early boot or a unit test with no logger accessor set up). Never logs
   * chat message bodies — `detail` is a schema-mismatch or parse-error
   * message, not any streamed content.
   */
  private warnSseParse(action: string, detail?: string): void {
    const logger = tryGetLogger();
    if (logger) {
      logger.warn({
        component: 'api-provider',
        action,
        result: 'failure',
        metadata: { providerId: this.id, detail },
      });
    } else {
      console.warn(`[api-provider] ${action}`, detail ?? '');
    }
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

  private usesOpenAIResponses(): boolean {
    try {
      return new URL(this.apiConfig.endpoint).hostname === 'api.openai.com'
        && /-codex(?:-|$)/i.test(this.apiConfig.model);
    } catch {
      return false;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async warmup(): Promise<void> {
    this.setStatus('warming-up');
    const failure = await this.checkConnection();
    this.recordConnectionCheck(failure);
    this.setStatus(failure === null ? 'ready' : 'error');
  }

  async cooldown(): Promise<void> {
    this.setStatus('not-installed');
  }

  async validateConnection(): Promise<boolean> {
    return (await this.checkConnection()) === null;
  }

  async ping(): Promise<boolean> {
    return (await this.checkConnection()) === null;
  }

  /**
   * Asks the service about the configured model (or, OpenAI-compatible,
   * its model list) without spending generation tokens, and names why it
   * failed: missing key, rejected key, other HTTP error, unreachable or
   * too slow (QA Medium-1).
   */
  async checkConnection(): Promise<ConnectionFailure | null> {
    let apiKey: string;
    try {
      apiKey = await this.resolveApiKey(this.apiConfig.apiKeyRef);
    } catch {
      return { code: 'key-missing', detail: null };
    }
    if (!apiKey) return { code: 'key-missing', detail: null };

    const { url, headers } = this.connectionCheckRequest(apiKey);
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(API_CONNECTION_CHECK_TIMEOUT_MS) });
      return res.ok ? null : httpFailure(res.status);
    } catch (error) {
      return fetchFailure(error);
    }
  }

  private connectionCheckRequest(apiKey: string): { url: string; headers: Record<string, string> } {
    const modelUrl = `${this.apiConfig.endpoint}/models/${encodeURIComponent(this.apiConfig.model)}`;
    if (this.isAnthropicEndpoint()) {
      return { url: modelUrl, headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION } };
    }
    if (this.isGoogleEndpoint()) {
      return { url: modelUrl, headers: { 'x-goog-api-key': apiKey } };
    }
    return { url: `${this.apiConfig.endpoint}/models`, headers: { 'Authorization': `Bearer ${apiKey}` } };
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
      } else if (this.usesOpenAIResponses()) {
        yield* this.streamOpenAIResponses(messages, persona, apiKey, options, signal);
      } else {
        yield* this.streamOpenAI(messages, persona, apiKey, options, signal);
      }
    } finally {
      if (this.status === 'busy') {
        this.setStatus('ready');
      }
    }
  }

  private async *streamOpenAIResponses(
    messages: Message[],
    persona: string,
    apiKey: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const body = {
      model: this.apiConfig.model,
      ...(persona ? { instructions: persona } : {}),
      input: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(block => {
              if (block.type !== 'text' || typeof block.data !== 'string') {
                throw new Error(`Unsupported content block for OpenAI Responses: ${block.type}`);
              }
              return block.data;
            }).join('\n'),
      })),
      stream: true,
      store: false,
      ...(options?.maxTokens != null && { max_output_tokens: options.maxTokens }),
    };

    const res = await fetch(`${this.apiConfig.endpoint}/responses`, {
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
      throw new Error(`OpenAI Responses API error ${res.status}: ${text}`);
    }

    yield* this.parseOpenAIResponsesSSE(res, signal);
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

  private async *parseOpenAIResponsesSSE(
    res: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

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
          if (data === '[DONE]') {
            if (!completed) throw new Error('OpenAI Responses API stream ended without completion');
            return;
          }

          let raw: unknown;
          try {
            raw = JSON.parse(data);
          } catch {
            this.warnSseParse('responses-sse-parse-skip');
            continue;
          }
          const parsed = openAiResponseEventSchema.safeParse(raw);
          if (!parsed.success) continue;

          const event = parsed.data;
          if (event.type === 'response.output_text.delta') {
            if (event.delta) yield event.delta;
          } else if (event.type === 'response.completed') {
            completed = true;
            const usage = event.response.usage;
            if (usage) {
              this.setLastTokenUsage({
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                totalTokens: usage.total_tokens,
              });
            }
            return;
          } else if (event.type === 'response.failed') {
            throw new Error(`OpenAI Responses API error: ${event.response.error?.message ?? 'response failed'}`);
          } else if (event.type === 'response.incomplete') {
            throw new Error(`OpenAI Responses API incomplete: ${event.response.incomplete_details?.reason ?? 'unknown reason'}`);
          } else if (event.type === 'error') {
            throw new Error(`OpenAI Responses API error: ${event.message}`);
          }
        }
      }
      if (!completed && !signal?.aborted) {
        throw new Error('OpenAI Responses API stream ended without completion');
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Preserve the stream result or original error if cancellation fails.
      }
      reader.releaseLock();
    }
  }

  private async *parseSSE(
    res: Response,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

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
          if (data === '[DONE]') { completed = true; return; }

          try {
            const raw = JSON.parse(data);
            const parsed = openAiChunkSchema.safeParse(raw);
            if (!parsed.success) {
              this.warnSseParse('openai-sse-schema-mismatch', parsed.error.message);
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
            if (choices?.[0]?.finish_reason != null) completed = true;
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
            this.warnSseParse('openai-sse-parse-skip', msg);
          }
        }
      }
      if (!completed && !signal?.aborted) {
        throw new Error('OpenAI Chat Completions stream ended without completion');
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
    let completed = false;

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
            if (event.type === 'message_stop') completed = true;
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
            this.warnSseParse('anthropic-sse-parse-skip', msg);
          }
        }
      }
      if (!completed && !signal?.aborted) {
        throw new Error('Anthropic Messages API stream ended without completion');
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
    let completed = false;

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
              this.warnSseParse('google-sse-schema-mismatch', parsed.error.message);
              continue;
            }
            const { usageMetadata, candidates, promptFeedback } = parsed.data;
            // The prompt itself can be blocked before any candidate is
            // produced — `candidates` is then absent entirely. Surface the
            // actual block reason instead of letting the loop fall through
            // to the generic "ended without completion" error.
            if (promptFeedback?.blockReason) {
              throw new GoogleBlockedPromptError(promptFeedback.blockReason);
            }
            // Record only the counts this chunk actually reported (proto3
            // JSON omits a zero-valued field rather than sending 0) — never
            // fabricate a 0 for a count the response left out.
            if (usageMetadata) {
              const usage: TokenUsage = {};
              if (usageMetadata.promptTokenCount != null) usage.inputTokens = usageMetadata.promptTokenCount;
              if (usageMetadata.candidatesTokenCount != null) usage.outputTokens = usageMetadata.candidatesTokenCount;
              if (usageMetadata.totalTokenCount != null) usage.totalTokens = usageMetadata.totalTokenCount;
              if (Object.keys(usage).length > 0) this.setLastTokenUsage(usage);
            }
            if (candidates?.[0]?.finishReason != null) completed = true;
            // Join every non-thought part's text — a chunk can carry several
            // parts, and a "thought" part (thought: true) is Gemini's
            // internal reasoning trace, never part of the visible reply.
            const text = candidates?.[0]?.content?.parts
              ?.filter((part) => part.thought !== true)
              .map((part) => part.text ?? '')
              .join('');
            if (text) {
              yield text;
            }
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e;
            if (e instanceof GoogleBlockedPromptError) throw e;
            const msg = e instanceof Error ? e.message : String(e);
            if (/429|rate.?limit/i.test(msg) || /5\d{2}/.test(msg)) {
              throw new Error(`API error: ${msg}`);
            }
            this.warnSseParse('google-sse-parse-skip', msg);
          }
        }
      }
      if (!completed && !signal?.aborted) {
        throw new Error('Google Generative AI stream ended without completion');
      }
    } finally {
      reader.releaseLock();
    }
  }

}
