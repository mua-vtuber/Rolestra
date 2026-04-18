import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BaseProviderInit } from '../provider-interface';
import { BaseProvider } from '../provider-interface';
import type { Message, CompletionOptions } from '../../../shared/provider-types';

/** Minimal concrete implementation for testing. */
class TestProvider extends BaseProvider {
  warmupCalled = false;
  cooldownCalled = false;

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *streamCompletion(messages: Message[], persona: string, options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string> {
    yield 'hello';
    yield ' world';
  }
}

function createInit(overrides?: Partial<BaseProviderInit>): BaseProviderInit {
  return {
    id: 'test-1',
    type: 'api',
    displayName: 'Test Provider',
    model: 'test-model',
    capabilities: ['streaming'],
    config: { type: 'api', endpoint: 'https://api.test.com', apiKeyRef: 'key-ref', model: 'test-model' },
    ...overrides,
  };
}

describe('BaseProvider', () => {
  it('initializes with correct defaults', () => {
    const provider = new TestProvider(createInit());
    expect(provider.id).toBe('test-1');
    expect(provider.type).toBe('api');
    expect(provider.getStatus()).toBe('not-installed');
    expect(provider.isReady()).toBe(false);
    expect(provider.capabilities.has('streaming')).toBe(true);
    expect(provider.persona).toBe('');
  });

  it('warmup sets status to ready', async () => {
    const provider = new TestProvider(createInit());
    await provider.warmup();
    expect(provider.isReady()).toBe(true);
    expect(provider.getStatus()).toBe('ready');
  });

  it('cooldown resets status', async () => {
    const provider = new TestProvider(createInit());
    await provider.warmup();
    await provider.cooldown();
    expect(provider.isReady()).toBe(false);
  });

  it('notifies status change listeners', async () => {
    const provider = new TestProvider(createInit());
    const listener = vi.fn();
    provider.onStatusChange(listener);
    await provider.warmup();
    expect(listener).toHaveBeenCalledWith('ready');
  });

  it('unsubscribe stops notifications', async () => {
    const provider = new TestProvider(createInit());
    const listener = vi.fn();
    const unsub = provider.onStatusChange(listener);
    unsub();
    await provider.warmup();
    expect(listener).not.toHaveBeenCalled();
  });

  it('toInfo returns serializable object', () => {
    const provider = new TestProvider(createInit({ persona: 'Helpful AI' }));
    const info = provider.toInfo();
    expect(info.id).toBe('test-1');
    expect(info.capabilities).toEqual(['streaming']);
    expect(info.persona).toBe('Helpful AI');
    expect(info.status).toBe('not-installed');
  });

  it('streamCompletion yields tokens', async () => {
    const provider = new TestProvider(createInit());
    const tokens: string[] = [];
    for await (const token of provider.streamCompletion([], '')) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['hello', ' world']);
  });
});

describe('ProviderRegistry', () => {
  // Import fresh module for each test to reset singleton state
  let registryModule: typeof import('../registry');

  beforeEach(async () => {
    vi.resetModules();
    registryModule = await import('../registry');
  });

  it('registers and retrieves a provider', () => {
    const { providerRegistry } = registryModule;
    const provider = new TestProvider(createInit());
    providerRegistry.register(provider);
    expect(providerRegistry.get('test-1')).toBe(provider);
    expect(providerRegistry.size).toBe(1);
    expect(providerRegistry.has('test-1')).toBe(true);
  });

  it('throws on duplicate registration', () => {
    const { providerRegistry } = registryModule;
    const provider = new TestProvider(createInit());
    providerRegistry.register(provider);
    expect(() => providerRegistry.register(provider)).toThrow('already registered');
  });

  it('unregisters and calls cooldown', async () => {
    const { providerRegistry } = registryModule;
    const provider = new TestProvider(createInit());
    providerRegistry.register(provider);
    await providerRegistry.unregister('test-1');
    expect(provider.cooldownCalled).toBe(true);
    expect(providerRegistry.has('test-1')).toBe(false);
  });

  it('throws when unregistering unknown provider', async () => {
    const { providerRegistry } = registryModule;
    await expect(providerRegistry.unregister('unknown')).rejects.toThrow('not found');
  });

  it('getOrThrow throws for missing provider', () => {
    const { providerRegistry } = registryModule;
    expect(() => providerRegistry.getOrThrow('missing')).toThrow('not found');
  });

  it('listAll returns serializable info', () => {
    const { providerRegistry } = registryModule;
    providerRegistry.register(new TestProvider(createInit({ id: 'a' })));
    providerRegistry.register(new TestProvider(createInit({ id: 'b' })));
    const list = providerRegistry.listAll();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('a');
    expect(list[1].id).toBe('b');
  });

  it('shutdownAll calls cooldown on all and clears', async () => {
    const { providerRegistry } = registryModule;
    const p1 = new TestProvider(createInit({ id: 'a' }));
    const p2 = new TestProvider(createInit({ id: 'b' }));
    providerRegistry.register(p1);
    providerRegistry.register(p2);
    await providerRegistry.shutdownAll();
    expect(p1.cooldownCalled).toBe(true);
    expect(p2.cooldownCalled).toBe(true);
    expect(providerRegistry.size).toBe(0);
  });
});
