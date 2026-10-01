/**
 * Integration tests for ProviderRegistry — full lifecycle management.
 *
 * Uses TestStreamingProvider from test-utils to verify:
 * - Full create -> register -> warmup -> stream -> usage -> cooldown -> unregister
 * - Multiple provider registration and listing
 * - shutdownAll clears all providers
 * - Status listener notifications
 * - getOrThrow for registered and missing providers
 * - Duplicate registration prevention
 * - Unknown provider unregister prevention
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTestProvider,
  collectTokens,
} from '../../../test-utils';

// ── Tests ────────────────────────────────────────────────────────────

describe('ProviderRegistry Lifecycle Integration', () => {
  // Import fresh module per test to reset singleton state
  let registryModule: typeof import('../registry');

  beforeEach(async () => {
    vi.resetModules();
    registryModule = await import('../registry');
  });

  // ── 1. Full lifecycle ──────────────────────────────────────────────

  it('create -> register -> warmup -> stream -> usage -> cooldown -> unregister', async () => {
    const { providerRegistry } = registryModule;

    const provider = createTestProvider('lifecycle-test', {
      tokens: ['Integration', ' test', ' pass'],
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    // register
    providerRegistry.register(provider);
    expect(providerRegistry.has('lifecycle-test')).toBe(true);

    // warmup
    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');
    expect(provider.warmupCalled).toBe(true);

    // stream
    const tokens = await collectTokens(
      provider.streamCompletion(
        [{ role: 'user', content: 'hello' }],
        'persona',
      ),
    );
    expect(tokens).toEqual(['Integration', ' test', ' pass']);

    // usage
    const usage = provider.consumeLastTokenUsage();
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

    // cooldown via unregister (calls cooldown internally)
    await providerRegistry.unregister('lifecycle-test');
    expect(provider.cooldownCalled).toBe(true);
    expect(provider.getStatus()).toBe('not-installed');
    expect(providerRegistry.has('lifecycle-test')).toBe(false);
  });

  // ── 2. Register 3 providers -> listAll ─────────────────────────────

  it('register 3 providers -> listAll returns 3 ProviderInfo objects', () => {
    const { providerRegistry } = registryModule;

    const p1 = createTestProvider('p1', { tokens: ['A'] });
    const p2 = createTestProvider('p2', { tokens: ['B'] });
    const p3 = createTestProvider('p3', { tokens: ['C'] });

    providerRegistry.register(p1);
    providerRegistry.register(p2);
    providerRegistry.register(p3);

    const list = providerRegistry.listAll();
    expect(list).toHaveLength(3);

    const ids = list.map(info => info.id);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(ids).toContain('p3');

    // Each item should be a serializable ProviderInfo
    for (const info of list) {
      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('displayName');
      expect(info).toHaveProperty('status');
      expect(info).toHaveProperty('capabilities');
    }
  });

  // ── 3. shutdownAll ─────────────────────────────────────────────────

  it('shutdownAll calls cooldown on all and clears registry', async () => {
    const { providerRegistry } = registryModule;

    const p1 = createTestProvider('s1');
    const p2 = createTestProvider('s2');
    providerRegistry.register(p1);
    providerRegistry.register(p2);

    await providerRegistry.shutdownAll();

    expect(p1.cooldownCalled).toBe(true);
    expect(p2.cooldownCalled).toBe(true);
    expect(providerRegistry.size).toBe(0);
  });

  // ── 4. Status listener fires on warmup/cooldown ────────────────────

  it('status listener fires on warmup and cooldown', async () => {
    const { providerRegistry } = registryModule;

    const provider = createTestProvider('listener-test');
    providerRegistry.register(provider);

    const statuses: string[] = [];
    provider.onStatusChange((s) => statuses.push(s));

    await provider.warmup();
    await provider.cooldown();

    expect(statuses).toContain('ready');
    expect(statuses).toContain('not-installed');
  });

  // ── 5. getOrThrow for registered provider ──────────────────────────

  it('getOrThrow returns provider when registered', () => {
    const { providerRegistry } = registryModule;

    const provider = createTestProvider('exists');
    providerRegistry.register(provider);

    const result = providerRegistry.getOrThrow('exists');
    expect(result).toBe(provider);
  });

  // ── 6. getOrThrow for missing provider throws ──────────────────────

  it('getOrThrow throws for missing provider', () => {
    const { providerRegistry } = registryModule;

    expect(() => providerRegistry.getOrThrow('nonexistent')).toThrow('not found');
  });

  // ── 7. Duplicate registration throws ───────────────────────────────

  it('duplicate registration throws', () => {
    const { providerRegistry } = registryModule;

    const provider = createTestProvider('dup');
    providerRegistry.register(provider);

    const duplicate = createTestProvider('dup');
    expect(() => providerRegistry.register(duplicate)).toThrow('already registered');
  });

  // ── 8. Unregister unknown provider throws ──────────────────────────

  it('unregister unknown provider throws', async () => {
    const { providerRegistry } = registryModule;

    await expect(
      providerRegistry.unregister('ghost'),
    ).rejects.toThrow('not found');
  });
});
