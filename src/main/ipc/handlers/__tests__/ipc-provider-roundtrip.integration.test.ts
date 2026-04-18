/**
 * Integration tests for provider CRUD roundtrip through IPC handler functions.
 *
 * Tests handleProviderList, handleProviderAdd, handleProviderRemove, and
 * handleProviderValidate by mocking the provider registry and factory.
 *
 * The handler functions depend on providerRegistry, createProvider, and DB
 * persistence. We mock these dependencies to test the handler logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// ── Mock the provider registry ─────────────────────────────────────────

const registeredProviders = new Map<string, {
  id: string;
  type: string;
  displayName: string;
  model: string;
  persona?: string;
  toInfo: () => { id: string; displayName: string; type: string; model: string; status: string };
  warmup: () => Promise<void>;
  validateConnection: () => Promise<boolean>;
  shutdown: () => Promise<void>;
}>();

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: () => Array.from(registeredProviders.values()).map((p) => p.toInfo()),
    register: (provider: { id: string }) => {
      registeredProviders.set(provider.id, provider as typeof registeredProviders extends Map<string, infer V> ? V : never);
    },
    unregister: async (id: string) => {
      if (!registeredProviders.has(id)) {
        throw new Error(`Provider not found: ${id}`);
      }
      const p = registeredProviders.get(id)!;
      await p.shutdown();
      registeredProviders.delete(id);
    },
    get: (id: string) => registeredProviders.get(id) ?? null,
  },
}));

vi.mock('../../../providers/factory', () => ({
  createProvider: (opts: { displayName: string; persona?: string; config: { type: string; model?: string } }) => {
    const id = `prov-${randomUUID().slice(0, 8)}`;
    return {
      id,
      type: opts.config.type,
      displayName: opts.displayName,
      model: opts.config.model ?? 'default-model',
      persona: opts.persona,
      toInfo: () => ({
        id,
        displayName: opts.displayName,
        type: opts.config.type,
        model: opts.config.model ?? 'default-model',
        status: 'ready',
      }),
      warmup: vi.fn().mockResolvedValue(undefined),
      validateConnection: vi.fn().mockResolvedValue(true),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  },
}));

vi.mock('../../../providers/model-registry', () => ({
  getModelsForProvider: vi.fn().mockResolvedValue(['model-a', 'model-b']),
}));

vi.mock('../../../providers/provider-repository', () => ({
  saveProvider: vi.fn(),
  removeProvider: vi.fn(),
}));

vi.mock('../../../config/instance', () => ({
  getConfigService: () => ({
    getSecret: (ref: string) => (ref === 'openai-key' ? 'sk-test-123' : null),
  }),
}));

import {
  handleProviderList,
  handleProviderAdd,
  handleProviderRemove,
  handleProviderValidate,
} from '../provider-handler';

// ═════════════════════════════════════════════════════════════════════════

describe('IPC Provider Roundtrip', () => {
  beforeEach(() => {
    registeredProviders.clear();
  });

  it('provider:list when empty returns empty array', () => {
    const result = handleProviderList();
    expect(result.providers).toEqual([]);
  });

  it('provider:add then provider:list shows the added provider', async () => {
    const addResult = await handleProviderAdd({
      displayName: 'Test Claude',
      config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'openai-key', model: 'gpt-4' },
    });

    expect(addResult.provider).toBeDefined();
    expect(addResult.provider.displayName).toBe('Test Claude');

    const listResult = handleProviderList();
    expect(listResult.providers).toHaveLength(1);
    expect(listResult.providers[0].displayName).toBe('Test Claude');
  });

  it('provider:add then provider:validate returns validation result', async () => {
    const addResult = await handleProviderAdd({
      displayName: 'Validate Me',
      config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'openai-key', model: 'gpt-4' },
    });

    const validateResult = await handleProviderValidate({
      id: addResult.provider.id,
    });

    expect(validateResult.valid).toBe(true);
  });

  it('provider:add then provider:remove then provider:list shows empty', async () => {
    const addResult = await handleProviderAdd({
      displayName: 'Remove Me',
      config: { type: 'api', endpoint: 'https://api.example.com', apiKeyRef: 'openai-key', model: 'gpt-4' },
    });

    const removeResult = await handleProviderRemove({ id: addResult.provider.id });
    expect(removeResult.success).toBe(true);

    const listResult = handleProviderList();
    expect(listResult.providers).toHaveLength(0);
  });

  it('provider:remove with non-existent id throws error', async () => {
    await expect(
      handleProviderRemove({ id: 'nonexistent-id' }),
    ).rejects.toThrow('Provider not found');
  });

  it('provider:validate with non-existent id returns valid=false', async () => {
    const result = await handleProviderValidate({ id: 'nonexistent-id' });
    expect(result.valid).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('provider:add with duplicate displayName adds both (registry allows)', async () => {
    await handleProviderAdd({
      displayName: 'Duplicate Name',
      config: { type: 'api', endpoint: 'https://api1.example.com', apiKeyRef: 'openai-key', model: 'gpt-4' },
    });

    await handleProviderAdd({
      displayName: 'Duplicate Name',
      config: { type: 'api', endpoint: 'https://api2.example.com', apiKeyRef: 'openai-key', model: 'gpt-4' },
    });

    const listResult = handleProviderList();
    expect(listResult.providers).toHaveLength(2);
    expect(listResult.providers[0].displayName).toBe('Duplicate Name');
    expect(listResult.providers[1].displayName).toBe('Duplicate Name');
  });
});
