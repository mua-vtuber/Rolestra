import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MODEL_REGISTRY_FETCH_TIMEOUT_MS } from '../../../shared/timeouts';
import {
  getEmbeddingModelsForProvider,
  getModelsForProvider,
  ModelRegistryAuthError,
  ModelRegistryNetworkError,
  ModelRegistryParseError,
} from '../model-registry';

describe('model-registry', () => {
  describe('CLI models', () => {
    it('claude — returns alias-based model list', async () => {
      const models = await getModelsForProvider('cli', 'claude');
      expect(models).toContain('opus');
      expect(models).toContain('sonnet');
      expect(models).toContain('haiku');
      expect(models).not.toContain('claude-opus-4-20250514');
    });

    it('gemini CLI — no supported models', async () => {
      const models = await getModelsForProvider('cli', 'gemini');
      expect(models).toEqual([]);
    });

    it('codex — returns latest codex models', async () => {
      const models = await getModelsForProvider('cli', 'codex');
      expect(models).toContain('gpt-5.3-codex');
      expect(models).not.toContain('o3-mini');
    });

    it('normalizes Windows paths', async () => {
      const models = await getModelsForProvider('cli', 'C:\\Users\\bin\\claude.exe');
      expect(models).toContain('opus');
    });

    it('unknown CLI — returns empty array', async () => {
      const models = await getModelsForProvider('cli', 'unknown-tool');
      expect(models).toEqual([]);
    });
  });

  describe('API models (live fetch)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('OpenAI — fetches /v1/models and extracts model IDs', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('Anthropic — fetches /v1/models with correct headers', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{ id: 'claude-opus-4-6' }, { id: 'claude-sonnet-4-6' }] }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('api', 'https://api.anthropic.com/v1', 'sk-test');
      expect(models).toContain('claude-opus-4-6');
      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0];
      const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test');
    });

    it('Google AI — lists chat models with the API key in a header, never in the URL', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('api', 'https://generativelanguage.googleapis.com/v1beta', 'key-test');
      expect(models).toEqual(['gemini-3.1-pro-preview', 'gemini-3.8-flash']);
      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
      expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual({ 'x-goog-api-key': 'key-test' });
    });

    it('OpenRouter — fetches /api/v1/models like OpenAI format', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{ id: 'anthropic/claude-3.5-sonnet' }] }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('api', 'https://openrouter.ai/api/v1', 'or-test');
      expect(models).toContain('anthropic/claude-3.5-sonnet');
    });

    it('network failure — throws ModelRegistryNetworkError', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test'),
      ).rejects.toBeInstanceOf(ModelRegistryNetworkError);
    });

    it('non-2xx (HTTP 500) — throws ModelRegistryNetworkError with status', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      await expect(
        getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test'),
      ).rejects.toMatchObject({
        name: 'ModelRegistryNetworkError',
        status: 500,
      });
    });

    it('401 auth error — throws ModelRegistryAuthError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        getModelsForProvider('api', 'https://api.openai.com/v1', 'bad-key'),
      ).rejects.toMatchObject({
        name: 'ModelRegistryAuthError',
        status: 401,
      });
    });

    it('403 auth error — throws ModelRegistryAuthError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

      await expect(
        getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test'),
      ).rejects.toBeInstanceOf(ModelRegistryAuthError);
    });

    it('malformed JSON — throws ModelRegistryParseError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('not-json{', { status: 200 }));

      await expect(
        getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test'),
      ).rejects.toBeInstanceOf(ModelRegistryParseError);
    });

    it('Google 401 — throws ModelRegistryAuthError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        getModelsForProvider(
          'api',
          'https://generativelanguage.googleapis.com/v1beta',
          'bad-key',
        ),
      ).rejects.toBeInstanceOf(ModelRegistryAuthError);
    });

    it('no apiKey provided — returns static catalog (no fetch)', async () => {
      const models = await getModelsForProvider('api', 'https://api.openai.com/v1');
      expect(models.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('unknown endpoint with no apiKey — returns empty array', async () => {
      const models = await getModelsForProvider('api', 'https://custom-api.example.com/v1');
      expect(models).toEqual([]);
    });
  });

  describe('Google chat model eligibility and pagination', () => {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta';
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    it.each([
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3-flash-preview',
    ])('offers only the reviewed chat model returned by this API key: %s', async (modelId) => {
      fetchSpy.mockResolvedValueOnce(Response.json({
        models: [{ name: `models/${modelId}`, supportedGenerationMethods: ['generateContent'] }],
      }));

      expect(await getModelsForProvider('api', endpoint, 'key-test')).toEqual([modelId]);
    });

    it('excludes retired, unreviewed, alias, and non-chat models even with generateContent', async () => {
      const excludedModelIds = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3-pro-preview',
        'gemini-3.1-flash-lite-preview',
        'gemini-flash-latest',
        'gemini-pro-latest',
        'gemini-3.8-flash-image',
        'gemini-3.1-flash-image-preview',
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-flash-native-audio-preview-12-2025',
        'gemini-robotics-er-1.5-preview',
        'deep-research-pro-preview-12-2025',
        'gemini-embedding-001',
        'imagen-4.0-generate-001',
        'veo-3.1-generate-preview',
        'gemini-4-unreviewed',
      ];
      fetchSpy.mockResolvedValueOnce(Response.json({
        models: [
          ...excludedModelIds.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })),
          { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      }));

      expect(await getModelsForProvider('api', endpoint, 'key-test'))
        .toEqual(['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
    });

    it('requires generateContent on an otherwise reviewed chat model', async () => {
      fetchSpy.mockResolvedValueOnce(Response.json({
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['countTokens'] },
          { name: 'models/gemini-3.7-flash' },
          { name: 'models/gemini-3.6-flash', supportedGenerationMethods: [] },
        ],
      }));

      expect(await getModelsForProvider('api', endpoint, 'key-test')).toEqual([]);
    });

    it('does not suggest unverified static models when no API key is provided', async () => {
      expect(await getModelsForProvider('api', endpoint)).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('leaves OpenAI-compatible model catalogs independent of the Google chat policy', async () => {
      fetchSpy.mockResolvedValueOnce(Response.json({ data: [{ id: 'google/gemini-2.5-pro' }] }));

      expect(await getModelsForProvider('api', 'https://openrouter.ai/api/v1', 'key-test'))
        .toEqual(['google/gemini-2.5-pro']);
    });

    it('follows page tokens, preserving API order and deduplicating chat models', async () => {
      fetchSpy
        .mockResolvedValueOnce(Response.json({
          models: [{ name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }],
          nextPageToken: 'page/2+=',
        }))
        .mockResolvedValueOnce(Response.json({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
          ],
        }));

      expect(await getModelsForProvider('api', endpoint, 'key-test'))
        .toEqual(['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const secondUrl = new URL(fetchSpy.mock.calls[1][0] as string);
      expect(secondUrl.searchParams.get('pageToken')).toBe('page/2+=');
      expect(secondUrl.searchParams.get('pageSize')).toBe('1000');
      expect(secondUrl.searchParams.has('key')).toBe(false);
      expect((fetchSpy.mock.calls[1][1] as RequestInit).headers).toEqual({ 'x-goog-api-key': 'key-test' });
    });

    it('does not substitute a static catalog for an empty live response', async () => {
      fetchSpy.mockResolvedValueOnce(Response.json({}));

      expect(await getModelsForProvider('api', endpoint, 'key-test')).toEqual([]);
    });

    it.each([401, 403, 429, 500])('propagates HTTP %s on later pages instead of a partial list', async (status) => {
      fetchSpy
        .mockResolvedValueOnce(Response.json({
          models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }],
          nextPageToken: 'next',
        }))
        .mockResolvedValueOnce(new Response('upstream failure', { status }));

      await expect(getModelsForProvider('api', endpoint, 'key-test')).rejects.toMatchObject({
        name: status === 401 || status === 403 ? 'ModelRegistryAuthError' : 'ModelRegistryNetworkError',
        status,
      });
    });

    it('propagates a network failure on a later page instead of a partial list', async () => {
      fetchSpy
        .mockResolvedValueOnce(Response.json({ models: [], nextPageToken: 'next' }))
        .mockRejectedValueOnce(new Error('Connection reset'));

      await expect(getModelsForProvider('api', endpoint, 'key-test'))
        .rejects.toBeInstanceOf(ModelRegistryNetworkError);
    });

    it('rejects repeated continuation tokens instead of looping', async () => {
      fetchSpy.mockImplementation(async () => Response.json({ models: [], nextPageToken: 'repeated' }));

      await expect(getModelsForProvider('api', endpoint, 'key-test'))
        .rejects.toBeInstanceOf(ModelRegistryParseError);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('shares one timeout across all pages', async () => {
      vi.useFakeTimers();
      fetchSpy
        .mockImplementationOnce(() => new Promise<Response>((resolve) => {
          setTimeout(() => resolve(Response.json({ models: [], nextPageToken: 'next' })), 3000);
        }))
        .mockImplementationOnce((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }));
      const models = getModelsForProvider('api', endpoint, 'key-test');
      const rejected = expect(models).rejects.toBeInstanceOf(ModelRegistryNetworkError);

      await Promise.all([
        rejected,
        vi.advanceTimersByTimeAsync(MODEL_REGISTRY_FETCH_TIMEOUT_MS),
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const firstSignal = (fetchSpy.mock.calls[0][1] as RequestInit).signal;
      expect((fetchSpy.mock.calls[1][1] as RequestInit).signal).toBe(firstSignal);
    });

    it.each([
      { label: 'null body', body: null },
      { label: 'array body', body: [] },
      { label: 'string body', body: 'invalid' },
      { label: 'non-array models', body: { models: {} } },
      { label: 'null models', body: { models: null } },
      { label: 'null model', body: { models: [null] } },
      { label: 'missing name', body: { models: [{ supportedGenerationMethods: ['generateContent'] }] } },
      { label: 'non-string name', body: { models: [{ name: 123, supportedGenerationMethods: ['generateContent'] }] } },
      { label: 'non-array methods', body: { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: 'generateContent' }] } },
      { label: 'non-string method', body: { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: [123] }] } },
      { label: 'non-string token', body: { models: [], nextPageToken: 123 } },
    ])('reports malformed $label as a registry parse error', async ({ body }) => {
      fetchSpy.mockResolvedValueOnce(Response.json(body));

      await expect(getModelsForProvider('api', endpoint, 'key-test'))
        .rejects.toBeInstanceOf(ModelRegistryParseError);
    });

    it('propagates malformed JSON on later pages instead of a partial list', async () => {
      fetchSpy
        .mockResolvedValueOnce(Response.json({ models: [], nextPageToken: 'next' }))
        .mockResolvedValueOnce(new Response('{malformed', { status: 200 }));

      await expect(getModelsForProvider('api', endpoint, 'key-test'))
        .rejects.toBeInstanceOf(ModelRegistryParseError);
    });
  });

  describe('Embedding models', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('OpenAI — filters embedding-capable model IDs', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-4o' },
            { id: 'text-embedding-3-small' },
            { id: 'text-embedding-3-large' },
          ],
        }),
        { status: 200 },
      ));

      const models = await getEmbeddingModelsForProvider(
        'api',
        'https://api.openai.com/v1',
        'sk-test',
      );
      expect(models).toEqual(['text-embedding-3-small', 'text-embedding-3-large']);
    });

    it('no apiKey — returns empty array (no static catalog for embeddings)', async () => {
      const models = await getEmbeddingModelsForProvider('api', 'https://api.openai.com/v1');
      expect(models).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('auth failure — throws ModelRegistryAuthError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        getEmbeddingModelsForProvider(
          'api',
          'https://api.openai.com/v1',
          'bad-key',
        ),
      ).rejects.toBeInstanceOf(ModelRegistryAuthError);
    });

    it('Google — keeps embedding eligibility method-based across all pages', async () => {
      fetchSpy
        .mockResolvedValueOnce(Response.json({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'embeddings-next',
        }))
        .mockResolvedValueOnce(Response.json({
          models: [{ name: 'models/new-embedding-model', supportedGenerationMethods: ['embedContent'] }],
        }));

      expect(await getEmbeddingModelsForProvider('api', 'https://generativelanguage.googleapis.com/v1beta', 'key-test'))
        .toEqual(['gemini-embedding-001', 'new-embedding-model']);
    });

  });
});
