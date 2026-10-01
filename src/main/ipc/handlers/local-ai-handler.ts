/**
 * `provider:detect-local` and `provider:add-local` — the local AI part of
 * the AI add dialog (spec 2026-10-01-messenger-redesign.md R6-3). The work
 * lives in `providers/local/local-ai-registration.ts`.
 */
import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import { addOllamaModel, detectConfiguredOllama } from '../../providers/local/local-ai-registration';

export async function handleProviderDetectLocal(): Promise<IpcResponse<'provider:detect-local'>> {
  return { detection: await detectConfiguredOllama() };
}

export async function handleProviderAddLocal(
  data: IpcRequest<'provider:add-local'>,
): Promise<IpcResponse<'provider:add-local'>> {
  return { provider: await addOllamaModel(data.displayName, data.model) };
}
