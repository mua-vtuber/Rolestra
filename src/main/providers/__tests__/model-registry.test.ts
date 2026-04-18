import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelsForProvider } from '../model-registry';

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

    it('network failure — falls back to hardcoded API_MODELS', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const models = await getModelsForProvider('api', 'https://api.openai.com/v1', 'sk-test');
      expect(models.length).toBeGreaterThan(0);
    });

    it('401 auth error — falls back to hardcoded models', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const models = await getModelsForProvider('api', 'https://api.openai.com/v1', 'bad-key');
      expect(models.length).toBeGreaterThan(0);
    });

    it('no apiKey provided — falls back to hardcoded models', async () => {
      const models = await getModelsForProvider('api', 'https://api.openai.com/v1');
      expect(models.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('unknown endpoint with no apiKey — returns empty array', async () => {
      const models = await getModelsForProvider('api', 'https://custom-api.example.com/v1');
      expect(models).toEqual([]);
    });
  });
});
