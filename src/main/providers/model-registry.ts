/**
 * Model registry for CLI, API, and Local providers.
 *
 * CLI and API fallback lists are hardcoded. API providers attempt
 * real-time model listing when an API key is provided; on failure
 * they fall back to the static list.
 */

import type { ProviderType } from '../../shared/provider-types';

/** Anthropic API version header. */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Models available per CLI command key (normalized basename, lowercase). */
const CLI_MODELS: Record<string, string[]> = {
  claude: [
    'opus',
    'sonnet',
    'haiku',
  ],
  gemini: [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  codex: [
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex',
    'gpt-5.1',
    'gpt-5-codex',
    'gpt-5-codex-mini',
    'gpt-5',
  ],
};

/** Fallback models per API endpoint URL (used when live fetch fails). */
const API_MODELS_FALLBACK: Record<string, string[]> = {
  'https://api.openai.com/v1': ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  'https://api.anthropic.com/v1': [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-20250514',
    'claude-haiku-4-5-20251001',
  ],
  'https://generativelanguage.googleapis.com/v1beta': [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ],
};

/**
 * Normalize a CLI command path to its base key.
 * e.g. "/usr/local/bin/claude" → "claude", "C:\\Users\\bin\\gemini.exe" → "gemini"
 */
function normalizeCommand(command: string): string {
  const normalized = command.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  return base.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
}

/** Detect endpoint type from URL. */
function isAnthropicEndpoint(endpoint: string): boolean {
  return endpoint.includes('anthropic.com');
}

function isGoogleEndpoint(endpoint: string): boolean {
  return endpoint.includes('generativelanguage.googleapis.com');
}

type GoogleModelInfo = {
  name: string;
  supportedGenerationMethods?: string[];
};

function isEmbeddingModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('embedding')) return true;
  if (id.includes('embed-') || id.includes('-embed')) return true;
  if (id.startsWith('text-embedding')) return true;
  return false;
}

function filterGoogleModelsByMethod(models: GoogleModelInfo[], method: string): string[] {
  return models
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes(method))
    .map((m) => m.name.replace(/^models\//, ''));
}

/**
 * Fetch models from an API endpoint using the provider's models API.
 * Returns null on failure (caller should use fallback).
 */
async function fetchApiModels(endpoint: string, apiKey: string): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    let res: Response;

    if (isAnthropicEndpoint(endpoint)) {
      res = await fetch(`${endpoint}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        signal: controller.signal,
      });
    } else if (isGoogleEndpoint(endpoint)) {
      res = await fetch(`${endpoint}/models?key=${encodeURIComponent(apiKey)}`, {
        signal: controller.signal,
      });
    } else {
      res = await fetch(`${endpoint}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    }

    if (res.status === 401 || res.status === 403) {
      return [];
    }
    if (!res.ok) return null;

    const body = await res.json();

    if (isGoogleEndpoint(endpoint)) {
      const models = (body as { models?: { name: string }[] }).models ?? [];
      return models.map((m) => m.name.replace(/^models\//, ''));
    }

    const data = (body as { data?: { id: string }[] }).data ?? [];
    return data.map((m) => m.id);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch Google models with supportedGenerationMethods metadata.
 * Returns null on failure; empty array on auth failure.
 */
async function fetchGoogleModelsDetailed(endpoint: string, apiKey: string): Promise<GoogleModelInfo[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${endpoint}/models?key=${encodeURIComponent(apiKey)}`, {
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return [];
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: GoogleModelInfo[] };
    return body.models ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch installed Ollama models by querying its local API.
 * Returns an empty array if Ollama is unreachable.
 */
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/api/tags';
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get models for a provider type and key.
 *
 * @param type    - Provider type ('cli', 'api', 'local')
 * @param key     - For CLI: command path. For API: endpoint URL. For Local: base URL.
 * @param apiKey  - Resolved API key (only for 'api' type). If omitted, returns empty array.
 * @returns Array of model identifiers.
 */
export async function getModelsForProvider(
  type: ProviderType,
  key: string,
  apiKey?: string,
): Promise<string[]> {
  if (type === 'cli') {
    return CLI_MODELS[normalizeCommand(key)] ?? [];
  }
  if (type === 'api') {
    if (apiKey) {
      if (isGoogleEndpoint(key)) {
        const detailed = await fetchGoogleModelsDetailed(key, apiKey);
        if (detailed !== null && detailed.length > 0) {
          const filtered = filterGoogleModelsByMethod(detailed, 'generateContent');
          if (filtered.length > 0) return filtered;
          return [];
        }
      } else {
        const live = await fetchApiModels(key, apiKey);
        if (live !== null && live.length > 0) {
          return live.filter((m) => !isEmbeddingModelId(m));
        }
      }
    }
    // Fallback to hardcoded (no key, auth failure, or empty response)
    return API_MODELS_FALLBACK[key] ?? [];
  }
  if (type === 'local') {
    return fetchOllamaModels(key || 'http://localhost:11434');
  }
  return [];
}

/**
 * Get embedding-capable models for a provider.
 *
 * Only returns models that are likely to support embedding APIs.
 * For Google, filters by supportedGenerationMethods=embedContent.
 */
export async function getEmbeddingModelsForProvider(
  type: ProviderType,
  key: string,
  apiKey?: string,
): Promise<string[]> {
  if (type === 'api') {
    if (!apiKey) return [];
    if (isGoogleEndpoint(key)) {
      const detailed = await fetchGoogleModelsDetailed(key, apiKey);
      if (detailed !== null && detailed.length > 0) {
        return filterGoogleModelsByMethod(detailed, 'embedContent');
      }
      return [];
    }
    const live = await fetchApiModels(key, apiKey);
    if (live !== null && live.length > 0) {
      return live.filter((m) => isEmbeddingModelId(m));
    }
    return [];
  }
  if (type === 'local') {
    const models = await fetchOllamaModels(key || 'http://localhost:11434');
    return models.filter((m) => isEmbeddingModelId(m));
  }
  return [];
}

export { isEmbeddingModelId };
