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
import { resolveLocalCapabilities } from '../capability-resolver';
import type { ConnectionFailure } from '../../../shared/connection-failure-types';
import { fetchFailure, httpFailure } from '../connection-failure';
import { detectOllama } from './ollama-detector';

export type LocalProviderInit = Omit<BaseProviderInit, 'type' | 'capabilities'>;

export class LocalProvider extends BaseProvider {
  constructor(init: LocalProviderInit) {
    super({
      ...init,
      type: 'local',
      // 결재 3번 (A, 2026-05-19): capability 매트릭스를 resolver 로 위임. Local
      // Ollama / llama.cpp / vLLM 은 모델 다양성이 커 보수적으로 공통 능력
      // (streaming + summarize) 만 광고 — 모델별 tools / multimodal 가용성은
      // 단일 advertise 로 표현할 수 없으므로 라우팅에 false-positive 를 만들지
      // 않도록 의도적으로 미등록.
      capabilities: resolveLocalCapabilities(),
    });
  }

  private get localConfig(): LocalProviderConfig {
    return this.config as LocalProviderConfig;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async warmup(): Promise<void> {
    this.setStatus('warming-up');
    const failure = await this.checkConnection();
    this.recordConnectionCheck(failure);
    this.setStatus(failure === null ? 'ready' : 'not-installed');
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
   * A server confirmed as Ollama when it was added is checked with the
   * Ollama detector (running, model still installed, …); any other local
   * server through its OpenAI-compatible `/v1/models`, then Ollama's
   * `/api/tags` (QA Medium-1).
   */
  async checkConnection(): Promise<ConnectionFailure | null> {
    if (this.localConfig.confirmedServer === 'ollama') return this.checkOllama();
    const base = this.localConfig.baseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) });
      if (res.ok) return null;
      const ollamaRes = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) });
      return ollamaRes.ok ? null : httpFailure(res.status);
    } catch (error) {
      return fetchFailure(error);
    }
  }

  private async checkOllama(): Promise<ConnectionFailure | null> {
    const { model } = this.localConfig;
    const detection = await detectOllama(this.localConfig.baseUrl, LOCAL_PROVIDER_TIMEOUT_MS);
    switch (detection.status) {
      case 'running':
        return detection.models.includes(model) ? null : { code: 'local-model-missing', detail: model };
      case 'no-models':
        return { code: 'local-no-models', detail: null };
      case 'invalid-endpoint':
        return { code: 'local-invalid-endpoint', detail: null };
      case 'not-responding':
        switch (detection.cause) {
          case 'refused': return { code: 'local-not-running', detail: detection.detail };
          case 'timeout': return { code: 'timeout', detail: null };
          case 'unreachable': return { code: 'network', detail: detection.detail };
        }
        break;
      case 'unrecognized':
        switch (detection.cause) {
          case 'http-error': return { code: 'http-error', detail: detection.detail };
          case 'bad-model-list': return { code: 'local-bad-model-list', detail: detection.detail };
          case 'not-ollama': return { code: 'local-not-ollama', detail: detection.detail };
        }
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
            const finishReason = choices?.[0]?.finish_reason;
            if (finishReason != null) completed = true;
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
            const content = delta?.content;
            if (typeof content === 'string' && content) {
              yield content;
            }
          } catch { /* skip unparseable */ }
        }
      }
      if (!completed && !signal?.aborted) {
        throw new Error('Local LLM stream ended without completion');
      }
    } finally {
      reader.releaseLock();
    }
  }

}
