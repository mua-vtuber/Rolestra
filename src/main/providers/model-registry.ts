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
import type { ModelListType } from '../../shared/provider-types';
import { MODEL_REGISTRY_FETCH_TIMEOUT_MS } from '../../shared/timeouts';
import { API_SERVICE_ENDPOINTS } from '../../shared/api-service-catalog';

/** Anthropic API version header. */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Models available per CLI command key (normalized basename, lowercase). */
const CLI_MODELS: Record<string, string[]> = {
  claude: [
    'opus',
    'sonnet',
    'haiku',
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
 * F4-Task8: canonical API endpoint URLs surfaced as named constants so
 * (i) the static-catalog keys reference a single source of truth and
 * (ii) self-hosted / proxy deployments can spot the canonical URLs at
 * a glance. Self-hosters do *not* override these constants — they pass
 * a custom URL via `ApiProviderConfig.endpoint`, which routes through
 * the live-fetch path (any non-canonical URL skips the static catalog
 * and requires an API key for model listing).
 *
 * F1 (spec 2026-09-29-ai-setup-and-character.md §F1-2): the literal
 * URL values now live in `src/shared/api-service-catalog.ts` — the
 * renderer needs the same URLs to auto-fill the connect-address field
 * for a chosen service, and it cannot import from `main`. These three
 * exports are kept (re-exported from the shared module) so no other
 * file in this codebase needs to change its import path.
 */
export const OPENAI_API_ENDPOINT = API_SERVICE_ENDPOINTS.openai;
export const ANTHROPIC_API_ENDPOINT = API_SERVICE_ENDPOINTS.anthropic;
export const GOOGLE_GENAI_API_ENDPOINT = API_SERVICE_ENDPOINTS.google;

/**
 * Static catalog returned when no API key is configured. Once the user
 * provides a key, live fetch takes over; failures throw rather than
 * silently substituting these entries.
 */
const API_MODELS_STATIC_CATALOG: Record<string, string[]> = {
  [OPENAI_API_ENDPOINT]: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  [ANTHROPIC_API_ENDPOINT]: [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-20250514',
    'claude-haiku-4-5-20251001',
  ],
  [GOOGLE_GENAI_API_ENDPOINT]: [
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
 * e.g. "/usr/local/bin/claude" → "claude", "C:\\Users\\bin\\codex.exe" → "codex"
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
  const timeout = setTimeout(() => controller.abort(), MODEL_REGISTRY_FETCH_TIMEOUT_MS);
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
  const timeout = setTimeout(() => controller.abort(), MODEL_REGISTRY_FETCH_TIMEOUT_MS);
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
 * Get models for a provider type and key.
 *
 * @param type    - 'cli' or 'api'. Local (Ollama) models are listed by
 *                  `providers/local/ollama-detector.ts` instead.
 * @param key     - For CLI: command path. For API: endpoint URL.
 * @param apiKey  - Resolved API key (only for 'api' type). When omitted
 *                  for an API endpoint, returns the static catalog as a
 *                  known-stale list. When provided, attempts live fetch
 *                  and propagates ModelRegistry* errors on failure.
 * @returns Array of model identifiers.
 *
 * @throws ModelRegistryAuthError / ModelRegistryNetworkError /
 *         ModelRegistryParseError when an apiKey is provided and the
 *         live fetch fails.
 */
export async function getModelsForProvider(
  type: ModelListType,
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
  type: ModelListType,
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
  return [];
}

export { isEmbeddingModelId };
