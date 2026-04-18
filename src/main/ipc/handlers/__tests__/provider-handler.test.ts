import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockProviderInfo: _mockProviderInfo,
  mockListAll,
  mockRegister,
  mockUnregister,
  mockGet,
  mockCreateProvider,
  mockGetModelsForProvider,
  mockSaveProvider,
  mockRemoveProvider,
} = vi.hoisted(() => {
  const mockProviderInfo = {
    id: 'provider-1',
    type: 'api',
    displayName: 'Claude',
    model: 'claude-3',
    isActive: true,
  };
  return {
    mockProviderInfo,
    mockListAll: vi.fn(() => [mockProviderInfo]),
    mockRegister: vi.fn(),
    mockUnregister: vi.fn(async () => {}),
    mockGet: vi.fn(() => null),
    mockCreateProvider: vi.fn(() => ({
      id: 'provider-new',
      type: 'api',
      displayName: 'GPT-4',
      model: 'gpt-4',
      persona: undefined,
      warmup: vi.fn(async () => {}),
      toInfo: vi.fn(() => ({
        id: 'provider-new',
        type: 'api',
        displayName: 'GPT-4',
        model: 'gpt-4',
        isActive: true,
      })),
    })),
    mockGetModelsForProvider: vi.fn(() => ['model-a', 'model-b']),
    mockSaveProvider: vi.fn(),
    mockRemoveProvider: vi.fn(),
  };
});

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: mockListAll,
    register: mockRegister,
    unregister: mockUnregister,
    get: mockGet,
  },
}));

vi.mock('../../../providers/factory', () => ({
  createProvider: mockCreateProvider,
}));

vi.mock('../../../providers/model-registry', () => ({
  getModelsForProvider: mockGetModelsForProvider,
}));

vi.mock('../../../config/instance', () => ({
  getConfigService: vi.fn(() => ({
    getSecret: vi.fn((key: string) => (key === 'valid-key' ? 'sk-secret' : null)),
  })),
}));

vi.mock('../../../providers/provider-repository', () => ({
  saveProvider: mockSaveProvider,
  removeProvider: mockRemoveProvider,
}));

import {
  handleProviderList,
  handleProviderAdd,
  handleProviderRemove,
  handleProviderListModels,
  handleProviderValidate,
} from '../provider-handler';

describe('provider-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleProviderList', () => {
    it('happy path — returns all registered providers', () => {
      const result = handleProviderList();

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].id).toBe('provider-1');
      expect(mockListAll).toHaveBeenCalledOnce();
    });

    it('empty registry — returns empty array', () => {
      mockListAll.mockReturnValueOnce([]);

      const result = handleProviderList();

      expect(result.providers).toEqual([]);
    });
  });

  describe('handleProviderAdd', () => {
    it('happy path — creates, registers, persists, and returns provider info', async () => {
      const result = await handleProviderAdd({
        displayName: 'GPT-4',
        config: { type: 'api', apiKeyRef: 'openai-key', model: 'gpt-4', baseUrl: 'https://api.openai.com' } as never,
      });

      expect(mockCreateProvider).toHaveBeenCalled();
      expect(mockRegister).toHaveBeenCalled();
      expect(mockSaveProvider).toHaveBeenCalled();
      expect(result.provider.id).toBe('provider-new');
    });
  });

  describe('handleProviderRemove', () => {
    it('happy path — unregisters and removes from DB', async () => {
      const result = await handleProviderRemove({ id: 'provider-1' });

      expect(mockUnregister).toHaveBeenCalledWith('provider-1');
      expect(mockRemoveProvider).toHaveBeenCalledWith('provider-1');
      expect(result.success).toBe(true);
    });

    it('service throws — propagates error', async () => {
      mockUnregister.mockRejectedValueOnce(new Error('Provider not found'));

      await expect(handleProviderRemove({ id: 'nonexistent' })).rejects.toThrow(
        'Provider not found',
      );
    });
  });

  describe('handleProviderListModels', () => {
    it('happy path — returns models for a provider type', async () => {
      const result = await handleProviderListModels({ type: 'api' as never, key: 'openai' });

      expect(result.models).toEqual(['model-a', 'model-b']);
      expect(mockGetModelsForProvider).toHaveBeenCalledWith('api', 'openai', undefined);
    });

    it('with apiKeyRef — resolves key and passes to getModelsForProvider', async () => {
      const result = await handleProviderListModels({
        type: 'api' as never,
        key: 'https://api.openai.com/v1',
        apiKeyRef: 'valid-key',
      });

      expect(result.models).toEqual(['model-a', 'model-b']);
      expect(mockGetModelsForProvider).toHaveBeenCalledWith(
        'api',
        'https://api.openai.com/v1',
        'sk-secret',
      );
    });

    it('with invalid apiKeyRef — passes undefined for apiKey', async () => {
      const result = await handleProviderListModels({
        type: 'api' as never,
        key: 'https://api.openai.com/v1',
        apiKeyRef: 'nonexistent-key',
      });

      expect(result.models).toEqual(['model-a', 'model-b']);
      expect(mockGetModelsForProvider).toHaveBeenCalledWith(
        'api',
        'https://api.openai.com/v1',
        undefined,
      );
    });
  });

  describe('handleProviderValidate', () => {
    it('provider not found — returns invalid with message', async () => {
      mockGet.mockReturnValueOnce(null);

      const result = await handleProviderValidate({ id: 'nonexistent' });

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Provider not found');
    });

    it('validation succeeds — returns valid', async () => {
      mockGet.mockReturnValueOnce({
        validateConnection: vi.fn(async () => true),
      });

      const result = await handleProviderValidate({ id: 'provider-1' });

      expect(result.valid).toBe(true);
    });

    it('validation throws — returns invalid with error message', async () => {
      mockGet.mockReturnValueOnce({
        validateConnection: vi.fn(async () => {
          throw new Error('Connection refused');
        }),
      });

      const result = await handleProviderValidate({ id: 'provider-1' });

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Connection refused');
    });
  });
});
