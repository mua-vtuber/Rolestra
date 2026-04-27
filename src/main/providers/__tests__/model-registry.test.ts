import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

    it('gemini — returns latest gemini models', async () => {
      const models = await getModelsForProvider('cli', 'gemini');
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-3.1-pro-preview');
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

    it('Google AI — fetches /v1beta/models?key= and strips prefix', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('api', 'https://generativelanguage.googleapis.com/v1beta', 'key-test');
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
      const callUrl = fetchSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain('?key=key-test');
      expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toBeUndefined();
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

  describe('Local (Ollama) models', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('reachable — returns model name list', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
        { status: 200 },
      ));

      const models = await getModelsForProvider('local', 'http://localhost:11434');
      expect(models).toEqual(['llama3', 'mistral']);
    });

    it('unreachable — throws ModelRegistryNetworkError', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        getModelsForProvider('local', 'http://localhost:11434'),
      ).rejects.toBeInstanceOf(ModelRegistryNetworkError);
    });

    it('non-2xx — throws ModelRegistryNetworkError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

      await expect(
        getModelsForProvider('local', 'http://localhost:11434'),
      ).rejects.toMatchObject({
        name: 'ModelRegistryNetworkError',
        status: 502,
      });
    });

    it('malformed JSON — throws ModelRegistryParseError', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('not-json{', { status: 200 }));

      await expect(
        getModelsForProvider('local', 'http://localhost:11434'),
      ).rejects.toBeInstanceOf(ModelRegistryParseError);
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

    it('local Ollama — filters to embedding-capable names', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({
          models: [
            { name: 'llama3' },
            { name: 'nomic-embed-text' },
          ],
        }),
        { status: 200 },
      ));

      const models = await getEmbeddingModelsForProvider('local', 'http://localhost:11434');
      expect(models).toEqual(['nomic-embed-text']);
    });
  });
});
