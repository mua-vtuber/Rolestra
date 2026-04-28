/**
 * Local LLM Provider — connects to locally running inference servers.
 *
 * Uses OpenAI-compatible API format (supported by Ollama, llama.cpp, vLLM, etc.).
 * No API key required; connects to baseUrl directly.
 */

import { BaseProvider, type BaseProviderInit } from '../provider-interface';
import type {
  Message,
  CompletionOptions,
  LocalProviderConfig,
} from '../../../shared/provider-types';
import { LOCAL_PROVIDER_TIMEOUT_MS } from '../../../shared/timeouts';

export type LocalProviderInit = Omit<BaseProviderInit, 'type' | 'capabilities'>;

export class LocalProvider extends BaseProvider {
  constructor(init: LocalProviderInit) {
    super({
      ...init,
      type: 'local',
      // R11-Task9: 'summarize' 정식 추가. Local Ollama / llama.cpp /vLLM
      // 모두 OpenAI-compatible chat completions 로 1-shot 요약 가능 —
      // 모델이 너무 작아 품질이 낮을 수는 있어도 capability 자체는 advertise.
      capabilities: ['streaming', 'summarize'],
    });
  }

  private get localConfig(): LocalProviderConfig {
    return this.config as LocalProviderConfig;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async warmup(): Promise<void> {
    this.setStatus('warming-up');
    try {
      const valid = await this.validateConnection();
      this.setStatus(valid ? 'ready' : 'not-installed');
    } catch {
      this.setStatus('not-installed');
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
      // Most local servers expose /api/tags (Ollama) or /v1/models (OpenAI-compat)
      const base = this.localConfig.baseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/v1/models`, {
        signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS),
      });
      if (res.ok) return true;

      // Fallback: try Ollama-specific endpoint
      const ollamaRes = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS),
      });
      return ollamaRes.ok;
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
      const base = this.localConfig.baseUrl.replace(/\/+$/, '');
      const body = {
        model: this.localConfig.model,
        messages: [
          ...(persona ? [{ role: 'system' as const, content: persona }] : []),
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        stream: true,
        ...(options?.temperature != null && { temperature: options.temperature }),
        ...(options?.maxTokens != null && { max_tokens: options.maxTokens }),
      };

      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Local LLM error ${res.status}: ${text}`);
      }

      yield* this.parseSSE(res, signal);
    } finally {
      if (this.status === 'busy') {
        this.setStatus('ready');
      }
    }
  }

  // ── SSE parser (OpenAI-compatible) ────────────────────────

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
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const usage = parsed.usage as Record<string, unknown> | undefined;
            const promptTokens = usage?.prompt_tokens;
            const completionTokens = usage?.completion_tokens;
            const totalTokens = usage?.total_tokens;
            if (
              typeof promptTokens === 'number'
              && typeof completionTokens === 'number'
              && typeof totalTokens === 'number'
            ) {
              this.setLastTokenUsage({
                inputTokens: promptTokens,
                outputTokens: completionTokens,
                totalTokens,
              });
            }
            const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
            const content = delta?.content;
            if (typeof content === 'string' && content) {
              yield content;
            }
          } catch { /* skip unparseable */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

}
