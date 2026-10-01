/**
 * Local Ollama detection for the AI add dialog (spec
 * 2026-10-01-messenger-redesign.md R6-3).
 *
 * Two requests within one time budget ({@link OLLAMA_DETECTION_TIMEOUT_MS}):
 *   1. `GET /api/version` — Ollama's own endpoint. A JSON body with a
 *      `version` string is the evidence that the server IS Ollama. An HTTP
 *      error (or a redirect, which is never followed) is reported as "the
 *      server answered with an error", a 2xx answer without a version as
 *      "not Ollama".
 *   2. `GET /api/tags` — the installed models.
 *
 * Every outcome is a status with a cause (`local-ai-types.ts`); a failure
 * is never turned into an empty model list.
 */
import type { LocalAiDetection } from '../../../shared/local-ai-types';
import { OLLAMA_DETECTION_TIMEOUT_MS } from '../../../shared/timeouts';
import { httpDetail, networkErrorCode } from '../connection-failure';
import { toOllamaBaseUrl } from '../ollama-endpoint-resolver';

const VERSION_PATH = '/api/version';
const TAGS_PATH = '/api/tags';
const CONNECTION_REFUSED_CODE = 'ECONNREFUSED';

type Fetched =
  | { kind: 'response'; status: number; ok: boolean; body: unknown }
  | { kind: 'no-answer'; detection: Extract<LocalAiDetection, { status: 'not-responding' }> };

/** A body that is not JSON is `undefined` here — the caller decides what that means. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function get(endpoint: string, path: string, signal: AbortSignal): Promise<Fetched> {
  try {
    // A redirect is never followed off the resolved address (QA Minor 2);
    // 'manual' returns the 3xx itself, so it is reported by its status
    // instead of looking like a failed connection.
    const response = await fetch(`${endpoint}${path}`, { signal, redirect: 'manual' });
    const text = await response.text();
    return { kind: 'response', status: response.status, ok: response.ok, body: parseJson(text) };
  } catch (error) {
    if (signal.aborted) {
      return { kind: 'no-answer', detection: { status: 'not-responding', endpoint, cause: 'timeout', detail: null } };
    }
    const code = networkErrorCode(error);
    return {
      kind: 'no-answer',
      detection: {
        status: 'not-responding',
        endpoint,
        cause: code === CONNECTION_REFUSED_CODE ? 'refused' : 'unreachable',
        detail: code,
      },
    };
  }
}

function ollamaVersion(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const version = (body as { version?: unknown }).version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

function modelNames(body: unknown): string[] | null {
  if (body === null || typeof body !== 'object') return null;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;
  const names: string[] = [];
  for (const model of models) {
    const name = model !== null && typeof model === 'object' ? (model as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || name.length === 0) return null;
    names.push(name);
  }
  return names;
}

/**
 * Detects Ollama at `rawEndpoint` (the resolver's settings → `OLLAMA_HOST`
 * → default value, read like `OLLAMA_HOST`). `timeoutMs` bounds the whole
 * detection.
 */
export async function detectOllama(
  rawEndpoint: string,
  timeoutMs: number = OLLAMA_DETECTION_TIMEOUT_MS,
): Promise<LocalAiDetection> {
  const endpoint = toOllamaBaseUrl(rawEndpoint);
  if (endpoint === null) return { status: 'invalid-endpoint', endpoint: rawEndpoint.trim() };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const versionAnswer = await get(endpoint, VERSION_PATH, controller.signal);
    if (versionAnswer.kind === 'no-answer') return versionAnswer.detection;
    if (!versionAnswer.ok) {
      return { status: 'unrecognized', endpoint, cause: 'http-error', detail: httpDetail(versionAnswer.status) };
    }
    const version = ollamaVersion(versionAnswer.body);
    if (version === null) return { status: 'unrecognized', endpoint, cause: 'not-ollama', detail: null };

    const tagsAnswer = await get(endpoint, TAGS_PATH, controller.signal);
    if (tagsAnswer.kind === 'no-answer') return tagsAnswer.detection;
    if (!tagsAnswer.ok) {
      return { status: 'unrecognized', endpoint, cause: 'bad-model-list', detail: httpDetail(tagsAnswer.status) };
    }
    const models = modelNames(tagsAnswer.body);
    if (models === null) return { status: 'unrecognized', endpoint, cause: 'bad-model-list', detail: null };
    return models.length === 0
      ? { status: 'no-models', endpoint, version }
      : { status: 'running', endpoint, version, models };
  } finally {
    clearTimeout(timer);
  }
}
