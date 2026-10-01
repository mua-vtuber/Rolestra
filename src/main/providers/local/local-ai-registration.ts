/**
 * Local Ollama detection and adding a model as a local AI (spec
 * 2026-10-01-messenger-redesign.md R6-3).
 *
 * Main resolves the Ollama address itself (`ollama-endpoint-resolver.ts`:
 * settings → `OLLAMA_HOST` → default); the renderer never sends one. Adding
 * a model re-runs detection at that address and registers the AI only when
 * Ollama is running there with that model installed. Only this path sets
 * `confirmedServer: 'ollama'` — the evidence behind the "로컬 (Ollama)" line.
 */
import type { LocalAiDetection } from '../../../shared/local-ai-types';
import type { ProviderInfo } from '../../../shared/provider-types';
import { getConfigService } from '../../config/instance';
import { resolveOllamaEndpoint } from '../ollama-endpoint-resolver';
import { registerProvider } from '../provider-registration';
import { LocalAiNotReadyError, LocalModelMissingError } from './local-ai-errors';
import { detectOllama } from './ollama-detector';

function resolvedEndpoint(): string {
  return resolveOllamaEndpoint(getConfigService().getSettings());
}

export function detectConfiguredOllama(): Promise<LocalAiDetection> {
  return detectOllama(resolvedEndpoint());
}

export async function addOllamaModel(displayName: string, model: string): Promise<ProviderInfo> {
  const detection = await detectConfiguredOllama();
  if (detection.status !== 'running') throw new LocalAiNotReadyError(detection.status, detection.endpoint);
  if (!detection.models.includes(model)) throw new LocalModelMissingError(model, detection.endpoint);
  return registerProvider(displayName, {
    type: 'local',
    baseUrl: detection.endpoint,
    model,
    confirmedServer: 'ollama',
  });
}
