import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearLoggerAccessor, setLoggerAccessor } from '../../../log/logger-accessor';
import { StructuredLogger } from '../../../log/structured-logger';
import type { ProviderRow } from '../../../providers/provider-repository';
import type { BaseProvider } from '../../../providers/provider-interface';

const {
  mockProviderInfo: _mockProviderInfo,
  mockListAll,
  mockRegister,
  mockUnregister,
  mockDiscardUnstarted,
  mockGet,
  mockCreateProvider,
  mockGetModelsForProvider,
  mockSaveProvider,
  mockRemoveProvider,
  mockLoadAllProviders,
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
    mockDiscardUnstarted: vi.fn(),
    // D3 (2026-09-28): `vi.fn(() => null)` inferred a `null`-only return
    // type, so `.mockReturnValueOnce({ validateConnection: ... })` in
    // handleProviderValidate tests below failed to typecheck (TS2345,
    // argument of type {...} not assignable to parameter of type
    // 'null'). handleProviderValidate only ever calls
    // `.validateConnection()` on the returned provider, so the mock is
    // typed to that minimal slice of BaseProvider instead of importing
    // the full class (which would need a matching constructor call).
    mockGet: vi.fn<
      (id: string) => Pick<BaseProvider, 'validateConnection'> | undefined
    >(() => undefined),
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
    // D3 (2026-09-28): same shape as mockGet above — `vi.fn(() => [])`
    // inferred `never[]`, so `.mockReturnValueOnce([{ id, displayName,
    // ... }])` in the handleProviderListInactiveCli tests below failed
    // to typecheck (TS2322). Typed to the real `loadAllProviders()`
    // return shape.
    mockLoadAllProviders: vi.fn<() => ProviderRow[]>(() => []),
  };
});

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: mockListAll,
    register: mockRegister,
    unregister: mockUnregister,
    discardUnstarted: mockDiscardUnstarted,
    get: mockGet,
  },
}));

vi.mock('../../../providers/factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../providers/factory')>()),
  createProvider: mockCreateProvider,
}));

// Keep the real ModelRegistry* error classes (provider-handler.ts does
// `instanceof` checks against them) — only getModelsForProvider is swapped
// for the mock so tests control the fetch outcome without a real network call.
vi.mock('../../../providers/model-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../providers/model-registry')>()),
  getModelsForProvider: mockGetModelsForProvider,
}));

vi.mock('../../../config/instance', () => ({
  getConfigService: vi.fn(() => ({
    getSecret: vi.fn((key: string) => (key === 'valid-key' ? 'sk-secret' : null)),
    // F4-Task1: provider-handler reads `ollamaEndpoint` from settings to
    // resolve the local-provider catalog default. Empty string keeps the
    // resolver on the env → fallback path so the tests stay env-agnostic.
    getSettings: vi.fn(() => ({ ollamaEndpoint: '' })),
  })),
}));

vi.mock('../../../providers/provider-repository', () => ({
  saveProvider: mockSaveProvider,
  removeProvider: mockRemoveProvider,
  loadAllProviders: mockLoadAllProviders,
}));

import {
  handleProviderList,
  handleProviderAdd,
  handleProviderRemove,
  handleProviderListModels,
  handleProviderValidate,
  handleProviderListInactiveCli,
} from '../provider-handler';
import {
  ModelRegistryAuthError,
  ModelRegistryNetworkError,
  ModelRegistryParseError,
} from '../../../providers/model-registry';

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

    it('discards the in-memory provider when persistence fails', async () => {
      mockSaveProvider.mockImplementationOnce(() => {
        throw new Error('database unavailable');
      });
      await expect(handleProviderAdd({
        displayName: 'GPT-4',
        config: { type: 'api', apiKeyRef: 'openai-key', model: 'gpt-4' } as never,
      })).rejects.toThrow('database unavailable');
      expect(mockDiscardUnstarted).toHaveBeenCalledWith('provider-new');
    });

    it('rejects an unknown CLI command before creating or saving it', async () => {
      await expect(handleProviderAdd({
        displayName: 'Unsafe CLI',
        config: {
          type: 'cli', command: 'unknown-helper', args: ['--dangerous'],
          inputFormat: 'args', outputFormat: 'raw-stdout',
          sessionStrategy: 'per-turn', hangTimeout: { first: 1000, subsequent: 1000 },
          model: 'unknown',
        },
      })).rejects.toThrow('Unsupported chat CLI command');
      expect(mockCreateProvider).not.toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
      expect(mockSaveProvider).not.toHaveBeenCalled();
    });

    it('rejects Gemini CLI registration before creating or saving it', async () => {
      await expect(handleProviderAdd({
        displayName: 'Gemini CLI',
        config: {
          type: 'cli', command: 'C:\\Tools\\gemini.cmd', args: [],
          inputFormat: 'pipe', outputFormat: 'stream-json',
          sessionStrategy: 'per-turn', hangTimeout: { first: 1000, subsequent: 1000 },
          model: 'gemini-2.5-pro',
        },
      })).rejects.toThrow('Unsupported chat CLI command');
      expect(mockCreateProvider).not.toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
      expect(mockSaveProvider).not.toHaveBeenCalled();
    });

    // F2-3: chat-room participants are told apart by display name in the
    // model's own input — a duplicate (even case-different) would make
    // transcripts ambiguous about who said what.
    describe('display-name uniqueness (F2-3)', () => {
      it('rejects a name that collides case-insensitively with an already-registered provider', async () => {
        mockListAll.mockReturnValueOnce([
          { id: 'existing', type: 'api', displayName: 'Claude', model: 'claude-3', isActive: true },
        ] as never);

        await expect(handleProviderAdd({
          displayName: 'claude', // same name, different case
          config: { type: 'api', apiKeyRef: 'k', model: 'claude-3', endpoint: 'https://api.anthropic.com' } as never,
        })).rejects.toThrow('Display name already in use: claude');
        expect(mockCreateProvider).not.toHaveBeenCalled();
        expect(mockRegister).not.toHaveBeenCalled();
        expect(mockSaveProvider).not.toHaveBeenCalled();
      });

      it('the rejection is a DuplicateDisplayNameError so the renderer can show a dedicated message', async () => {
        mockListAll.mockReturnValueOnce([
          { id: 'existing', type: 'api', displayName: 'Claude', model: 'claude-3', isActive: true },
        ] as never);

        await expect(handleProviderAdd({
          displayName: 'Claude',
          config: { type: 'api', apiKeyRef: 'k', model: 'claude-3', endpoint: 'https://api.anthropic.com' } as never,
        })).rejects.toMatchObject({ name: 'DuplicateDisplayNameError' });
      });

      it('trims the display name before both the uniqueness check and persistence', async () => {
        mockListAll.mockReturnValueOnce([]);

        const result = await handleProviderAdd({
          displayName: '  Padded Name  ',
          config: { type: 'api', apiKeyRef: 'k', model: 'gpt-4', endpoint: 'https://api.openai.com' } as never,
        });

        expect(mockCreateProvider).toHaveBeenCalledWith(
          expect.objectContaining({ displayName: 'Padded Name' }),
        );
        expect(result.provider.id).toBe('provider-new');
      });

      it('allows a distinct name that does not collide', async () => {
        mockListAll.mockReturnValueOnce([
          { id: 'existing', type: 'api', displayName: 'Claude', model: 'claude-3', isActive: true },
        ] as never);

        const result = await handleProviderAdd({
          displayName: 'GPT-4',
          config: { type: 'api', apiKeyRef: 'k', model: 'gpt-4', endpoint: 'https://api.openai.com' } as never,
        });

        expect(result.provider.id).toBe('provider-new');
        expect(mockRegister).toHaveBeenCalled();
      });
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

      expect(result).toEqual({ ok: true, models: ['model-a', 'model-b'] });
      expect(mockGetModelsForProvider).toHaveBeenCalledWith(
        'api',
        'openai',
        undefined,
      );
    });

    it('with apiKeyRef — resolves key and passes to getModelsForProvider', async () => {
      const result = await handleProviderListModels({
        type: 'api' as never,
        key: 'https://api.openai.com/v1',
        apiKeyRef: 'valid-key',
      });

      expect(result).toEqual({ ok: true, models: ['model-a', 'model-b'] });
      expect(mockGetModelsForProvider).toHaveBeenCalledWith(
        'api',
        'https://api.openai.com/v1',
        'sk-secret',
      );
    });

    // QA 2026-10-01: a ref with no stored key is an error, never the
    // static catalog presented as if the key had been checked.
    it('with a ref that holds no key — fails naming the ref, no listing', async () => {
      await expect(handleProviderListModels({
        type: 'api',
        key: 'https://api.openai.com/v1',
        apiKeyRef: 'nonexistent-key',
      })).rejects.toThrow('API key not found: nonexistent-key');
      expect(mockGetModelsForProvider).not.toHaveBeenCalled();
    });

    // F1-6: a live-fetch failure is a first-class { ok: false, reason }
    // response — never a thrown/rejected IPC call, never a silent empty
    // list. Each ModelRegistry* error class maps to its own reason code.
    describe('live-fetch failure reasons (F1-6)', () => {
      it('ModelRegistryAuthError → { ok: false, reason: "auth" }', async () => {
        mockGetModelsForProvider.mockRejectedValueOnce(
          new ModelRegistryAuthError('https://api.openai.com/v1', 401),
        );

        const result = await handleProviderListModels({
          type: 'api' as never, key: 'https://api.openai.com/v1', apiKeyRef: 'valid-key',
        });

        expect(result).toEqual({ ok: false, reason: 'auth' });
      });

      it('ModelRegistryNetworkError → { ok: false, reason: "network" }', async () => {
        mockGetModelsForProvider.mockRejectedValueOnce(
          new ModelRegistryNetworkError('https://api.openai.com/v1', { status: 500 }),
        );

        const result = await handleProviderListModels({
          type: 'api' as never, key: 'https://api.openai.com/v1', apiKeyRef: 'valid-key',
        });

        expect(result).toEqual({ ok: false, reason: 'network' });
      });

      it('ModelRegistryParseError → { ok: false, reason: "parse" }', async () => {
        mockGetModelsForProvider.mockRejectedValueOnce(
          new ModelRegistryParseError('https://api.openai.com/v1', new SyntaxError('bad json')),
        );

        const result = await handleProviderListModels({
          type: 'api' as never, key: 'https://api.openai.com/v1', apiKeyRef: 'valid-key',
        });

        expect(result).toEqual({ ok: false, reason: 'parse' });
      });

      it('an unrelated throw is NOT swallowed into a reason code — it propagates', async () => {
        mockGetModelsForProvider.mockRejectedValueOnce(new Error('totally unexpected'));

        await expect(handleProviderListModels({
          type: 'api' as never, key: 'https://api.openai.com/v1', apiKeyRef: 'valid-key',
        })).rejects.toThrow('totally unexpected');
      });
    });
  });

  describe('handleProviderListInactiveCli (B1)', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = new StructuredLogger({ console: false, level: 'debug' });
      setLoggerAccessor(() => logger);
    });

    afterEach(() => {
      clearLoggerAccessor();
    });

    it('no DB rows — returns an empty list', () => {
      mockLoadAllProviders.mockReturnValueOnce([]);
      const result = handleProviderListInactiveCli();
      expect(result.inactive).toEqual([]);
    });

    it('a stored Gemini CLI row is returned as inactive with the unsupported-command reason', () => {
      mockLoadAllProviders.mockReturnValueOnce([{
        id: 'legacy-gemini', kind: 'cli', displayName: 'Gemini CLI', persona: null,
        configJson: JSON.stringify({ type: 'cli', command: 'C:\\Tools\\gemini.cmd', args: [] }),
        roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
      }]);
      const result = handleProviderListInactiveCli();
      expect(result.inactive).toEqual([{
        id: 'legacy-gemini', displayName: 'Gemini CLI',
        command: 'C:\\Tools\\gemini.cmd', reason: 'unsupported-command',
      }]);
    });

    it('a supported CLI row (claude/codex) is not listed as inactive', () => {
      mockLoadAllProviders.mockReturnValueOnce([{
        id: 'claude-1', kind: 'cli', displayName: 'Claude', persona: null,
        configJson: JSON.stringify({ type: 'cli', command: 'claude', args: [] }),
        roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
      }]);
      const result = handleProviderListInactiveCli();
      expect(result.inactive).toEqual([]);
    });

    it('api/local rows are never listed as inactive CLI rows', () => {
      mockLoadAllProviders.mockReturnValueOnce([{
        id: 'api-1', kind: 'api', displayName: 'GPT-4', persona: null,
        configJson: JSON.stringify({ type: 'api', endpoint: 'https://api.openai.com/v1', apiKeyRef: 'k', model: 'gpt-4' }),
        roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
      }]);
      const result = handleProviderListInactiveCli();
      expect(result.inactive).toEqual([]);
    });

    it('a row with corrupted config JSON is listed with reason corrupt-config, not silently dropped (B8)', () => {
      mockLoadAllProviders.mockReturnValue([{
        // The `kind` DB column survives independently of `configJson` —
        // this row is a CLI provider whose config blob got corrupted.
        id: 'broken-1', kind: 'cli', displayName: 'Broken', persona: null,
        configJson: '{not valid json',
        roles: '[]', skillOverrides: null, isDepartmentHead: '{}',
      }]);
      expect(() => handleProviderListInactiveCli()).not.toThrow();
      const result = handleProviderListInactiveCli();
      expect(result.inactive).toEqual([{
        id: 'broken-1', displayName: 'Broken', command: null, reason: 'corrupt-config',
      }]);
      const entries = logger.getEntries({ level: 'warn' })
        .filter((e) => e.component === 'provider-handler' && e.action === 'list-inactive-cli');
      expect(entries.length).toBeGreaterThan(0);
      expect((entries[0]?.metadata as { id: string }).id).toBe('broken-1');
    });
  });

  describe('handleProviderValidate', () => {
    it('provider not found — returns invalid with message', async () => {
      // providerRegistry.get() returns `BaseProvider | undefined` in
      // production (never `null`); mockGet is typed to match.
      mockGet.mockReturnValueOnce(undefined);

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
