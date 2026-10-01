/**
 * API key lifecycle around a registered AI (spec 2026-10-01-messenger-redesign.md
 * R5-5/R5-6): deleting an AI deletes its stored key unless another AI shares
 * the same ref, and replacing a key switches the provider to the new ref and
 * releases the old one under the same rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearLoggerAccessor, setLoggerAccessor } from '../../../log/logger-accessor';
import { StructuredLogger } from '../../../log/structured-logger';
import type { ProviderRow } from '../../../providers/provider-repository';
import type { ProviderConfig } from '../../../../shared/provider-types';

interface FakeProvider {
  id: string;
  type: ProviderConfig['type'];
  displayName: string;
  config: ProviderConfig;
  roles: [];
  skill_overrides: null;
  isDepartmentHead: Record<string, boolean>;
  toInfo: () => { id: string; config: ProviderConfig };
}

const mocks = vi.hoisted(() => ({
  providers: new Map<string, unknown>(),
  rows: [] as Array<{ id: string; configJson: string }>,
  secrets: new Map<string, string>(),
  saveProvider: vi.fn(),
  removeProvider: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    get: (id: string) => mocks.providers.get(id),
    unregister: vi.fn(async (id: string) => {
      if (!mocks.providers.has(id)) throw new Error(`Provider not found: ${id}`);
      mocks.providers.delete(id);
    }),
    listAll: () => [],
  },
}));

vi.mock('../../../providers/provider-repository', () => ({
  saveProvider: mocks.saveProvider,
  removeProvider: mocks.removeProvider,
  loadAllProviders: () => mocks.rows as unknown as ProviderRow[],
}));

vi.mock('../../../config/instance', () => ({
  getConfigService: () => ({
    getSecret: (key: string) => mocks.secrets.get(key) ?? null,
    deleteSecret: mocks.deleteSecret,
    getSettings: () => ({ ollamaEndpoint: '' }),
  }),
}));

import { handleProviderRemove, handleProviderReplaceApiKey } from '../provider-handler';

function apiConfig(apiKeyRef: string): ProviderConfig {
  return { type: 'api', endpoint: 'https://api.example.test/v1', apiKeyRef, model: 'model-a' };
}

function addProvider(id: string, config: ProviderConfig): FakeProvider {
  const provider: FakeProvider = {
    id, type: config.type, displayName: id, config,
    roles: [], skill_overrides: null, isDepartmentHead: {},
    toInfo() { return { id: this.id, config: this.config }; },
  };
  mocks.providers.set(id, provider);
  mocks.rows.push({ id, configJson: JSON.stringify(config) });
  return provider;
}

beforeEach(() => {
  mocks.providers.clear();
  mocks.rows.length = 0;
  mocks.secrets.clear();
  mocks.saveProvider.mockReset();
  mocks.removeProvider.mockReset();
  mocks.deleteSecret.mockReset();
  // The handler reads the rows left in the DB; mirror the real delete/update.
  mocks.removeProvider.mockImplementation((id: string) => {
    const index = mocks.rows.findIndex((r) => r.id === id);
    if (index >= 0) mocks.rows.splice(index, 1);
  });
  mocks.saveProvider.mockImplementation((id: string, _kind: unknown, _name: unknown, config: ProviderConfig) => {
    const existing = mocks.rows.find((r) => r.id === id);
    if (existing) existing.configJson = JSON.stringify(config);
  });
  setLoggerAccessor(() => new StructuredLogger({ console: false, level: 'debug' }));
});

afterEach(() => {
  clearLoggerAccessor();
});

describe('provider:remove — API key cleanup', () => {
  it('deletes the removed AI\'s stored key', async () => {
    addProvider('a', apiConfig('provider-key-a'));
    mocks.secrets.set('provider-key-a', 'sk-a');

    const result = await handleProviderRemove({ id: 'a' });

    expect(mocks.removeProvider).toHaveBeenCalledWith('a');
    expect(mocks.deleteSecret).toHaveBeenCalledWith('provider-key-a');
    expect(result).toEqual({ success: true, apiKeyCleanup: { status: 'deleted' } });
  });

  it('keeps a key that another registered AI still uses', async () => {
    addProvider('a', apiConfig('provider-shared'));
    addProvider('b', apiConfig('provider-shared'));

    const result = await handleProviderRemove({ id: 'a' });

    expect(mocks.deleteSecret).not.toHaveBeenCalled();
    expect(result.apiKeyCleanup).toEqual({ status: 'kept-shared' });
  });

  it('touches no secret for a CLI or local AI', async () => {
    addProvider('cli', { type: 'cli', command: 'claude', args: [], inputFormat: 'stdin-json',
      outputFormat: 'stream-json', sessionStrategy: 'persistent',
      hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown' });

    const result = await handleProviderRemove({ id: 'cli' });

    expect(mocks.deleteSecret).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, apiKeyCleanup: null });
  });

  it('reports a failed key delete without undoing the removal', async () => {
    addProvider('a', apiConfig('provider-key-a'));
    mocks.deleteSecret.mockImplementation(() => { throw new Error('EACCES'); });

    const result = await handleProviderRemove({ id: 'a' });

    expect(mocks.removeProvider).toHaveBeenCalledWith('a');
    expect(result).toEqual({ success: true, apiKeyCleanup: { status: 'failed', message: 'EACCES' } });
  });

  it('an unknown id still fails before anything is deleted', async () => {
    await expect(handleProviderRemove({ id: 'missing' })).rejects.toThrow('Provider not found: missing');
    expect(mocks.removeProvider).not.toHaveBeenCalled();
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });
});

describe('provider:replace-api-key', () => {
  it('switches the provider to the new ref, persists it and deletes the old key', () => {
    const provider = addProvider('a', apiConfig('provider-old'));
    mocks.secrets.set('provider-old', 'sk-old');
    mocks.secrets.set('provider-new', 'sk-new');

    const result = handleProviderReplaceApiKey({ id: 'a', apiKeyRef: 'provider-new' });

    expect(mocks.saveProvider).toHaveBeenCalledTimes(1);
    expect(mocks.saveProvider.mock.calls[0]?.[3]).toEqual(apiConfig('provider-new'));
    expect(provider.config).toEqual(apiConfig('provider-new'));
    expect(mocks.deleteSecret).toHaveBeenCalledWith('provider-old');
    expect(mocks.deleteSecret).not.toHaveBeenCalledWith('provider-new');
    expect(result.previousKeyCleanup).toEqual({ status: 'deleted' });
    expect(result.provider.config).toEqual(apiConfig('provider-new'));
  });

  it('keeps the old key when another AI still shares it', () => {
    addProvider('a', apiConfig('provider-shared'));
    addProvider('b', apiConfig('provider-shared'));
    mocks.secrets.set('provider-new', 'sk-new');

    const result = handleProviderReplaceApiKey({ id: 'a', apiKeyRef: 'provider-new' });

    expect(mocks.deleteSecret).not.toHaveBeenCalled();
    expect(result.previousKeyCleanup).toEqual({ status: 'kept-shared' });
  });

  it('refuses a ref that has no stored secret, changing nothing', () => {
    const provider = addProvider('a', apiConfig('provider-old'));

    expect(() => handleProviderReplaceApiKey({ id: 'a', apiKeyRef: 'provider-missing' }))
      .toThrow('API key not found: provider-missing');
    expect(provider.config).toEqual(apiConfig('provider-old'));
    expect(mocks.saveProvider).not.toHaveBeenCalled();
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });

  it('refuses a non-API AI', () => {
    addProvider('local', { type: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'm' });
    mocks.secrets.set('provider-new', 'sk-new');

    expect(() => handleProviderReplaceApiKey({ id: 'local', apiKeyRef: 'provider-new' }))
      .toThrow('not an API provider');
  });

  it('refuses an unknown AI', () => {
    mocks.secrets.set('provider-new', 'sk-new');
    expect(() => handleProviderReplaceApiKey({ id: 'missing', apiKeyRef: 'provider-new' }))
      .toThrow('Provider not found: missing');
  });

  it('refuses the ref the provider already uses (nothing to replace)', () => {
    addProvider('a', apiConfig('provider-old'));
    mocks.secrets.set('provider-old', 'sk-old');

    expect(() => handleProviderReplaceApiKey({ id: 'a', apiKeyRef: 'provider-old' }))
      .toThrow('already uses');
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });

  it('leaves the provider and the old key alone when saving fails', () => {
    const provider = addProvider('a', apiConfig('provider-old'));
    mocks.secrets.set('provider-new', 'sk-new');
    mocks.saveProvider.mockImplementation(() => { throw new Error('SQLITE_BUSY'); });

    expect(() => handleProviderReplaceApiKey({ id: 'a', apiKeyRef: 'provider-new' }))
      .toThrow('SQLITE_BUSY');
    expect(provider.config).toEqual(apiConfig('provider-old'));
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });
});
