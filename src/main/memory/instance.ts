/**
 * Singleton accessor for the MemoryFacade.
 *
 * Separated from memory-handler.ts to avoid circular imports.
 *
 * Reads MemorySettings from the config service at creation time
 * and injects all services (embedding, evolver, reflector) directly
 * into the facade constructor. No setter pattern — full DI at construction.
 */

import { getDatabase } from '../database/connection';
import { getConfigService } from '../config/instance';
import { providerRegistry } from '../providers/registry';
import { isEmbeddingModelId } from '../providers/model-registry';
import { MemoryFacade } from './facade';
import type { MemoryServices } from './facade';
import { EmbeddingService } from './embedding-service';
import { MemoryEvolver } from './evolver';
import { ReflectionEngine } from './reflector';
import type { MemoryConfig, EmbeddingProvider } from '../../shared/memory-types';
import { DEFAULT_MEMORY_CONFIG } from '../../shared/memory-types';
import type { MemorySettings } from '../../shared/config-types';
import { DEFAULT_MEMORY_SETTINGS } from '../../shared/config-types';
import { tryInitVecTable } from './hybrid-search';

let instance: MemoryFacade | null = null;

/**
 * Build a MemoryConfig from user-facing MemorySettings,
 * filling in defaults for fields not exposed in the UI.
 */
function buildMemoryConfig(ms: MemorySettings): Partial<MemoryConfig> {
  return {
    contextTotalBudget: ms.contextBudget,
    retrievalLimit: ms.retrievalLimit,
    reflectionThreshold: ms.reflectionThreshold,
    vectorEnabled: ms.vectorSearchEnabled,
    graphEnabled: ms.graphEnabled,
  };
}

/**
 * Read the current MemorySettings from the config service.
 * Returns defaults if the config service is unavailable.
 */
function readMemorySettings(): MemorySettings {
  try {
    const svc = getConfigService();
    const settings = svc.getSettings();
    return settings.memorySettings
      ? { ...DEFAULT_MEMORY_SETTINGS, ...settings.memorySettings }
      : DEFAULT_MEMORY_SETTINGS;
  } catch {
    return DEFAULT_MEMORY_SETTINGS;
  }
}

/** Default embedding model for Google AI APIs. */
const DEFAULT_GOOGLE_EMBEDDING_MODEL = 'text-embedding-004';
const DEFAULT_EMBEDDING_DIMENSION = 1536;

/**
 * Create an EmbeddingProvider adapter from a registered API provider.
 *
 * @param providerId - Registered provider ID to use for embeddings.
 * @param embeddingModel - Model identifier for OpenAI-compatible APIs.
 *   Google endpoints always use DEFAULT_GOOGLE_EMBEDDING_MODEL instead.
 */
function createEmbeddingAdapter(providerId: string, embeddingModel: string): EmbeddingProvider | null {
  const provider = providerRegistry.get(providerId);
  if (!provider) return null;

  const config = provider.config;
  if (config.type !== 'api' && config.type !== 'local') return null;

  // Local providers use their baseUrl directly
  if (config.type === 'local') {
    if (!isEmbeddingModelId(config.model)) return null;
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    return {
      modelId: `${providerId}:embedding`,
      dimension: DEFAULT_EMBEDDING_DIMENSION,
      async embed(text: string): Promise<number[] | null> {
        try {
          const res = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: config.model,
              input: text,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) return null;
          return parseOpenAIEmbeddingResponse(await res.json());
        } catch {
          return null;
        }
      },
    };
  }

  // API provider
  const endpoint = config.endpoint.replace(/\/$/, '');
  const apiKeyRef = config.apiKeyRef;
  const isGoogle = endpoint.includes('generativelanguage.googleapis.com');
  const modelName = isGoogle ? DEFAULT_GOOGLE_EMBEDDING_MODEL : embeddingModel;
  if (!isEmbeddingModelId(modelName)) return null;

  return {
    modelId: `${providerId}:${modelName}`,
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    async embed(text: string): Promise<number[] | null> {
      try {
        const svc = getConfigService();
        const apiKey = svc.getSecret(apiKeyRef);
        if (!apiKey) return null;

        if (isGoogle) {
          return await embedViaGoogleApi(endpoint, apiKey, text, modelName);
        }
        return await embedViaOpenAIApi(endpoint, apiKey, text, modelName);
      } catch {
        return null;
      }
    },
  };
}

/** Call OpenAI-compatible /embeddings endpoint. */
async function embedViaOpenAIApi(
  endpoint: string,
  apiKey: string,
  text: string,
  model: string,
): Promise<number[] | null> {
  const res = await fetch(`${endpoint}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  return parseOpenAIEmbeddingResponse(await res.json());
}

/** Call Google AI text embedding endpoint. */
async function embedViaGoogleApi(
  endpoint: string,
  apiKey: string,
  text: string,
  model: string,
): Promise<number[] | null> {
  const url = `${endpoint}/models/${model}:embedContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const embedding = data.embedding as Record<string, unknown> | undefined;
  const values = embedding?.values;
  if (Array.isArray(values) && values.length > 0 && typeof values[0] === 'number') {
    return values as number[];
  }
  return null;
}

/** Parse OpenAI-format embedding response. */
function parseOpenAIEmbeddingResponse(data: unknown): number[] | null {
  const obj = data as Record<string, unknown>;
  const dataArr = obj.data as Array<Record<string, unknown>> | undefined;
  const embedding = dataArr?.[0]?.embedding;
  if (Array.isArray(embedding) && embedding.length > 0 && typeof embedding[0] === 'number') {
    return embedding as number[];
  }
  return null;
}

/**
 * Build all memory services from settings.
 *
 * Returns the services object ready for facade construction.
 * All Phase 3-b services (embedding, evolver, reflector) are
 * wired when their provider IDs are configured.
 */
function buildServices(ms: MemorySettings): MemoryServices {
  const db = getDatabase();
  const config = { ...DEFAULT_MEMORY_CONFIG, ...buildMemoryConfig(ms) };
  const services: MemoryServices = {};

  // Embedding service
  if (ms.embeddingProviderId && ms.vectorSearchEnabled) {
    const adapter = createEmbeddingAdapter(ms.embeddingProviderId, ms.embeddingModel ?? 'text-embedding-3-small');
    if (adapter) {
      services.embeddingService = new EmbeddingService(adapter);
      console.info(`[memory] embedding provider wired: ${ms.embeddingProviderId}`);

      // Try to initialize sqlite-vec for ANN search
      tryInitVecTable(db, adapter.dimension);
    }
  }

  // Evolver (merge requires embeddings; prune is embedding-independent)
  const evolverEmbedding = services.embeddingService ?? new EmbeddingService();
  services.evolver = new MemoryEvolver(db, evolverEmbedding, config);

  // Reflector + LLM extraction (both use the same provider and callback)
  if (ms.reflectionProviderId) {
    const provider = providerRegistry.get(ms.reflectionProviderId);
    if (provider) {
      const llmFn = async (systemPrompt: string, userPrompt: string): Promise<string> => {
        let result = '';
        for await (const token of provider.streamCompletion(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          '',
          undefined,
          undefined,
        )) {
          result += token;
        }
        return result;
      };

      services.reflector = new ReflectionEngine(db, llmFn, config);
      services.llmExtractFn = llmFn;
      console.info(`[memory] reflection provider wired: ${ms.reflectionProviderId}`);
    }
  }

  return services;
}

/**
 * Get (or lazily create) the singleton MemoryFacade.
 *
 * The facade is backed by the app-wide SQLite database and uses
 * settings from the config service. All services are injected
 * at construction time.
 */
export function getMemoryFacade(): MemoryFacade {
  if (instance) return instance;

  const ms = readMemorySettings();
  const config = buildMemoryConfig(ms);
  const services = buildServices(ms);

  instance = new MemoryFacade(getDatabase(), config, services);

  return instance;
}

/**
 * Reconfigure the memory facade with updated settings.
 *
 * Called when the user saves memory settings. Creates a fresh
 * facade instance with the new configuration and all services
 * re-wired from scratch.
 */
export function reconfigureMemoryFacade(): void {
  const ms = readMemorySettings();
  const config = buildMemoryConfig(ms);
  const services = buildServices(ms);

  instance = new MemoryFacade(getDatabase(), config, services);

  console.info('[memory] facade reconfigured with updated settings');
}
