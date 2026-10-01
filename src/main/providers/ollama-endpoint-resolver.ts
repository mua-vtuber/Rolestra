/**
 * F4-Task1: resolve the effective Ollama HTTP endpoint used by the
 * model-registry catalog probe and the local-provider default.
 *
 * Priority chain (highest first):
 *   1. `settings.ollamaEndpoint` (user-set, non-empty after trim)
 *   2. `process.env.OLLAMA_HOST` (the same env var the upstream
 *      `ollama` CLI honours — keeps Rolestra consistent with whatever
 *      shell config the user already maintains for direct Ollama use)
 *   3. `OLLAMA_ENDPOINT_FALLBACK` literal (`http://localhost:11434`).
 *
 * The fallback exists only to keep first-boot dev installs working
 * without any configuration; once a user changes the setting or sets
 * the env var, the literal is never read. Per the F4 contract, the
 * literal is *never* used as a silent substitute for missing data —
 * callers always receive a real URL string.
 */

import type { SettingsConfig } from '../../shared/config-types';

/** The upstream `ollama serve` default and the fallback for first-boot installs. */
export const OLLAMA_ENDPOINT_FALLBACK = 'http://localhost:11434';

/** Standard env var honoured by the upstream `ollama` CLI. */
export const OLLAMA_HOST_ENV_VAR = 'OLLAMA_HOST';

/**
 * Resolve the effective Ollama endpoint URL using the documented
 * priority chain. The function is pure — pass `process.env` (or a
 * test stub) to make the env layer injectable.
 */
export function resolveOllamaEndpoint(
  settings: Pick<SettingsConfig, 'ollamaEndpoint'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromSettings = settings.ollamaEndpoint?.trim() ?? '';
  if (fromSettings.length > 0) return fromSettings;
  const fromEnv = env[OLLAMA_HOST_ENV_VAR]?.trim() ?? '';
  if (fromEnv.length > 0) return fromEnv;
  return OLLAMA_ENDPOINT_FALLBACK;
}

/** Port the `ollama` CLI uses when `OLLAMA_HOST` names no port and no scheme. */
export const OLLAMA_DEFAULT_PORT = '11434';

/** Host the `ollama` CLI uses when `OLLAMA_HOST` names only a port (`:11500`). */
export const OLLAMA_DEFAULT_HOST = '127.0.0.1';

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turns a resolved endpoint into the base URL Ollama requests go to, reading
 * a scheme-less value the way the `ollama` CLI reads `OLLAMA_HOST`:
 * `host:port` → `http://host:port`, `host` → `http://host:11434`,
 * `:port` → `http://127.0.0.1:port`. A value with a scheme is kept as
 * written (its own default port, any reverse-proxy path), minus a trailing
 * slash. Returns null when the value is not an http(s) address or carries
 * credentials — the caller reports that instead of guessing.
 */
export function toOllamaBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const hasScheme = URL_SCHEME_PATTERN.test(trimmed);
  const hostPart = !hasScheme && trimmed.startsWith(':') ? `${OLLAMA_DEFAULT_HOST}${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(hasScheme ? hostPart : `http://${hostPart}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname.length === 0 || url.username.length > 0 || url.password.length > 0) return null;
  if (!hasScheme && url.port.length === 0) url.port = OLLAMA_DEFAULT_PORT;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

