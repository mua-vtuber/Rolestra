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
