/**
 * Why adding a local Ollama model failed, as causes the renderer can name
 * (`shared/ipc-error.ts`, QA High-1).
 */
import type { IpcCausedError } from '../../../shared/ipc-error';
import type { LocalAiStatus } from '../../../shared/local-ai-types';

/** Ollama was not running with models at the resolved address when the add was attempted. */
export class LocalAiNotReadyError extends Error implements IpcCausedError {
  readonly ipcCause = 'local-ai-not-ready' as const;

  constructor(public readonly status: LocalAiStatus, public readonly endpoint: string) {
    super(`Ollama is not ready at ${endpoint}: ${status}`);
    this.name = 'LocalAiNotReadyError';
  }
}

/** Ollama is running but does not have the chosen model installed. */
export class LocalModelMissingError extends Error implements IpcCausedError {
  readonly ipcCause = 'local-model-missing' as const;

  constructor(public readonly model: string, public readonly endpoint: string) {
    super(`Model ${model} is not installed on Ollama at ${endpoint}`);
    this.name = 'LocalModelMissingError';
  }
}
