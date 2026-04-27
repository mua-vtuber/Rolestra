/**
 * Model registry for CLI, API, and Local providers.
 *
 * CLI lists are hardcoded (CLIs ship with a fixed alias set). API
 * endpoints attempt real-time model listing when a key is provided;
 * fetch / auth / parse failures surface as specific Error subclasses
 * (ModelRegistryAuthError / ModelRegistryNetworkError /
 * ModelRegistryParseError) so callers can distinguish "wrong key" from
 * "service down" from "stale catalog". When no API key is supplied,
 * the static catalog is returned as a known-stale catalog (legitimate
 * UX — user has not chosen to fetch live yet).
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

/**
 * Static catalog returned when no API key is configured. Once the user
 * provides a key, live fetch takes over; failures throw rather than
 * silently substituting these entries.
 */
const API_MODELS_STATIC_CATALOG: Record<string, string[]> = {
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
 * Authentication failure (HTTP 401/403). Distinct from a network
 * outage — the caller should prompt the user to verify the API key.
 */
export class ModelRegistryAuthError extends Error {
  readonly endpoint: string;
  readonly status: number;

  constructor(endpoint: string, status: number) {
    super(
      `Model registry authentication failed for ${endpoint} (HTTP ${status}). ` +
      `Verify the API key is correct and has model:list permission.`,
    );
    this.name = 'ModelRegistryAuthError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

/**
 * Network failure (DNS, connection, timeout, non-2xx response other
 * than auth). Distinct from a parse error — the caller should surface
 * "service unreachable" rather than "bad response".
 */
export class ModelRegistryNetworkError extends Error {
  readonly endpoint: string;
  readonly status?: number;

  constructor(endpoint: string, options: { status?: number; cause?: unknown }) {
    const reason = options.status !== undefined
      ? `HTTP ${options.status}`
      : options.cause instanceof Error
        ? options.cause.message
        : String(options.cause ?? 'unknown network failure');
    super(`Model registry network failure for ${endpoint}: ${reason}`);
    this.name = 'ModelRegistryNetworkError';
    this.endpoint = endpoint;
    this.status = options.status;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Response parse failure (malformed JSON, missing expected shape).
 * Distinct from a network error — the caller should surface "bad
 * response from upstream" rather than retry.
 */
export class ModelRegistryParseError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, cause?: unknown) {
    const reason = cause instanceof Error
      ? cause.message
      : String(cause ?? 'invalid JSON');
    super(`Model registry parse failure for ${endpoint}: ${reason}`);
    this.name = 'ModelRegistryParseError';
    this.endpoint = endpoint;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

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
 * Issue a fetch and convert auth / network / parse failures into the
 * specific Error subclasses. The caller receives a parsed JSON body
 * on success; any other outcome throws.
 */
async function fetchJson<T>(
  endpoint: string,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (cause) {
    throw new ModelRegistryNetworkError(endpoint, { cause });
  }

  if (res.status === 401 || res.status === 403) {
    throw new ModelRegistryAuthError(endpoint, res.status);
  }
  if (!res.ok) {
    throw new ModelRegistryNetworkError(endpoint, { status: res.status });
  }

  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new ModelRegistryParseError(endpoint, cause);
  }
}

/**
 * Fetch models from an API endpoint using the provider's models API.
 *
 * @throws ModelRegistryAuthError on HTTP 401/403
 * @throws ModelRegistryNetworkError on connection failure / non-2xx / abort
 * @throws ModelRegistryParseError on malformed JSON
 */
async function fetchApiModels(endpoint: string, apiKey: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    let body: unknown;
    if (isAnthropicEndpoint(endpoint)) {
      body = await fetchJson<unknown>(
        endpoint,
        `${endpoint}/models`,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
        },
        controller.signal,
      );
    } else if (isGoogleEndpoint(endpoint)) {
      body = await fetchJson<unknown>(
        endpoint,
        `${endpoint}/models?key=${encodeURIComponent(apiKey)}`,
        {},
        controller.signal,
      );
    } else {
      body = await fetchJson<unknown>(
        endpoint,
        `${endpoint}/models`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } },
        controller.signal,
      );
    }

    if (isGoogleEndpoint(endpoint)) {
      const models = (body as { models?: { name: string }[] }).models ?? [];
      return models.map((m) => m.name.replace(/^models\//, ''));
    }

    const data = (body as { data?: { id: string }[] }).data ?? [];
    return data.map((m) => m.id);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch Google models with supportedGenerationMethods metadata.
 *
 * @throws ModelRegistryAuthError on HTTP 401/403
 * @throws ModelRegistryNetworkError on connection failure / non-2xx / abort
 * @throws ModelRegistryParseError on malformed JSON
 */
async function fetchGoogleModelsDetailed(endpoint: string, apiKey: string): Promise<GoogleModelInfo[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = await fetchJson<{ models?: GoogleModelInfo[] }>(
      endpoint,
      `${endpoint}/models?key=${encodeURIComponent(apiKey)}`,
      {},
      controller.signal,
    );
    return body.models ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch installed Ollama models by querying its local API.
 *
 * @throws ModelRegistryNetworkError when Ollama is unreachable / non-2xx / abort
 * @throws ModelRegistryParseError on malformed JSON
 *
 * Note: Ollama runs locally and does not authenticate, so 401/403 are
 * not expected; if they occur fetchJson still raises an auth error and
 * the caller will see a clear message.
 */
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/api/tags';
    const body = await fetchJson<{ models?: { name: string }[] }>(
      baseUrl,
      url,
      {},
      controller.signal,
    );
    return (body.models ?? []).map((m) => m.name);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get models for a provider type and key.
 *
 * @param type    - Provider type ('cli', 'api', 'local')
 * @param key     - For CLI: command path. For API: endpoint URL. For Local: base URL.
 * @param apiKey  - Resolved API key (only for 'api' type). When omitted
 *                  for an API endpoint, returns the static catalog as a
 *                  known-stale list. When provided, attempts live fetch
 *                  and propagates ModelRegistry* errors on failure.
 * @returns Array of model identifiers.
 *
 * @throws ModelRegistryAuthError / ModelRegistryNetworkError /
 *         ModelRegistryParseError when an apiKey is provided and the
 *         live fetch fails. Local provider failures throw the same
 *         error types.
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
        return filterGoogleModelsByMethod(detailed, 'generateContent');
      }
      const live = await fetchApiModels(key, apiKey);
      return live.filter((m) => !isEmbeddingModelId(m));
    }
    return API_MODELS_STATIC_CATALOG[key] ?? [];
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
 *
 * @throws ModelRegistry* errors on live fetch failure (same contract
 *         as getModelsForProvider).
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
      return filterGoogleModelsByMethod(detailed, 'embedContent');
    }
    const live = await fetchApiModels(key, apiKey);
    return live.filter((m) => isEmbeddingModelId(m));
  }
  if (type === 'local') {
    const models = await fetchOllamaModels(key || 'http://localhost:11434');
    return models.filter((m) => isEmbeddingModelId(m));
  }
  return [];
}

export { isEmbeddingModelId };
