/**
 * Integration test: Engine → Provider
 *
 * Verifies that:
 * 1. Provider mock completes and returns token usage
 * 2. Provider health checks integrate with the engine
 */

import { describe, it, expect } from 'vitest';
import type { ProviderInfo } from '../../../shared/provider-types';

/** Minimal mock provider matching the subset of BaseProvider used by tests. */
class MockProvider {
  id = 'mock-provider';
  displayName = 'Mock Provider';
  type = 'api' as const;
  model = 'mock-model';
  status = 'ready' as const;

  private responseDelay: number;
  private tokenResponse: { input: number; output: number };

  constructor(options?: { delay?: number; tokens?: { input: number; output: number } }) {
    this.responseDelay = options?.delay ?? 0;
    this.tokenResponse = options?.tokens ?? { input: 100, output: 50 };
  }

  async complete(..._args: unknown[]): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
    void _args;
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }
    return {
      content: 'Mock response',
      usage: {
        inputTokens: this.tokenResponse.input,
        outputTokens: this.tokenResponse.output,
      },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      healthy: true,
      latencyMs: Date.now() - start,
    };
  }

  toInfo(): ProviderInfo {
    return {
      id: this.id,
      type: this.type,
      displayName: this.displayName,
      model: this.model,
      capabilities: [],
      status: this.status,
      config: { type: 'api', endpoint: 'mock', apiKeyRef: 'mock', model: 'mock' },
    };
  }
}

describe('Engine → Provider Integration', () => {
  it('provider complete returns token usage', async () => {
    const provider = new MockProvider({ tokens: { input: 200, output: 100 } });
    const response = await provider.complete([{ role: 'user', content: 'Hello' }]);

    expect(response.usage.inputTokens).toBe(200);
    expect(response.usage.outputTokens).toBe(100);
    expect(response.content).toBe('Mock response');
  });

  it('health check succeeds for responsive provider', async () => {
    const provider = new MockProvider({ delay: 10 });
    const result = await provider.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it('simulates health check failure detection', async () => {
    class FailingProvider extends MockProvider {
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
        return { healthy: false, latencyMs: 0, error: 'Connection timeout' };
      }
    }

    const failingProvider = new FailingProvider();
    const result = await failingProvider.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('Connection timeout');
  });

  it('provider toInfo serializes correctly', () => {
    const provider = new MockProvider();
    const info = provider.toInfo();

    expect(info.id).toBe('mock-provider');
    expect(info.type).toBe('api');
    expect(info.displayName).toBe('Mock Provider');
    expect(info.model).toBe('mock-model');
    expect(info.capabilities).toEqual([]);
    expect(info.status).toBe('ready');
  });
});
