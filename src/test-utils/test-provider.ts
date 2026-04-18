/**
 * Reusable TestStreamingProvider for integration tests.
 *
 * Extends BaseProvider with configurable streaming behavior,
 * call tracking, error injection, and abort signal support.
 */

import { BaseProvider } from '../main/providers/provider-interface';
import type { BaseProviderInit, TokenUsage } from '../main/providers/provider-interface';
import type { Message, CompletionOptions, ProviderCapability } from '../shared/provider-types';

/** Options for configuring TestStreamingProvider behavior. */
export interface TestProviderOptions {
  /** Tokens to yield during streaming. Default: ['Hello', ' World'] */
  tokens?: string[];
  /** Delay between each token in ms. Default: 0 */
  tokenDelayMs?: number;
  /** Token usage to report after streaming completes. */
  tokenUsage?: TokenUsage;
  /** If set, throw an error at the N-th token (0-indexed). */
  errorAtToken?: number;
  /** Error message when errorAtToken fires. */
  errorMessage?: string;
}

/** Record of a single streamCompletion call. */
export interface StreamCall {
  messages: Message[];
  persona: string;
  options?: CompletionOptions;
  timestamp: number;
}

/**
 * Concrete BaseProvider implementation for testing.
 *
 * Tracks all calls, supports configurable token sequences,
 * per-token delays, error injection, and abort signal handling.
 */
export class TestStreamingProvider extends BaseProvider {
  warmupCalled = false;
  cooldownCalled = false;
  readonly calls: StreamCall[] = [];

  private readonly tokens: string[];
  private readonly tokenDelayMs: number;
  private readonly tokenUsage: TokenUsage | null;
  private readonly errorAtToken: number | null;
  private readonly errorMessage: string;

  constructor(
    init: Partial<BaseProviderInit> & { id: string },
    options: TestProviderOptions = {},
  ) {
    super({
      type: 'api',
      displayName: init.displayName ?? `Test-${init.id}`,
      model: init.model ?? 'test-model',
      capabilities: init.capabilities ?? ['streaming'] as ProviderCapability[],
      config: init.config ?? {
        type: 'api',
        endpoint: 'https://test.local',
        apiKeyRef: 'test-key',
        model: init.model ?? 'test-model',
      },
      ...init,
    });

    this.tokens = options.tokens ?? ['Hello', ' World'];
    this.tokenDelayMs = options.tokenDelayMs ?? 0;
    this.tokenUsage = options.tokenUsage ?? null;
    this.errorAtToken = options.errorAtToken ?? null;
    this.errorMessage = options.errorMessage ?? 'Test error at token';
  }

  async warmup(): Promise<void> {
    this.warmupCalled = true;
    this.setStatus('ready');
  }

  async cooldown(): Promise<void> {
    this.cooldownCalled = true;
    this.setStatus('not-installed');
  }

  async validateConnection(): Promise<boolean> {
    return true;
  }

  async ping(): Promise<boolean> {
    return this.isReady();
  }

  async *streamCompletion(
    messages: Message[],
    persona: string,
    options?: CompletionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    this.calls.push({ messages, persona, options, timestamp: Date.now() });
    this.setStatus('busy');

    try {
      for (let i = 0; i < this.tokens.length; i++) {
        if (signal?.aborted) return;

        if (this.errorAtToken !== null && i === this.errorAtToken) {
          throw new Error(this.errorMessage);
        }

        if (this.tokenDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, this.tokenDelayMs));
        }

        if (signal?.aborted) return;
        yield this.tokens[i];
      }

      if (this.tokenUsage) {
        this.setLastTokenUsage(this.tokenUsage);
      }
    } finally {
      this.setStatus('ready');
    }
  }
}

/** Shorthand factory for creating a test provider with defaults. */
export function createTestProvider(
  id: string,
  options?: TestProviderOptions,
  initOverrides?: Partial<BaseProviderInit>,
): TestStreamingProvider {
  return new TestStreamingProvider({ id, ...initOverrides }, options);
}
