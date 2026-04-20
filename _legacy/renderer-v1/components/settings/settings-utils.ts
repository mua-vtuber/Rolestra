/**
 * Shared utilities for Settings — CLI auto-detection cache, API provider list, helpers.
 */

import type { ProviderConfig } from '../../../shared/provider-types';
import type { DetectedCli } from '../../../shared/ipc-types';

// ── Known API providers for dropdown ──────────────────────────────────

export const API_PROVIDERS = [
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1' },
  { label: 'Google AI', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
] as const;

// ── CLI auto-detection cache ──────────────────────────────────────────

const CLI_AUTO_DETECT_MAX_ATTEMPTS = 3;

export const cliAutoDetectCache: {
  attempts: number;
  completed: boolean;
  detected: DetectedCli[];
  inFlight: Promise<void> | null;
} = {
  attempts: 0,
  completed: false,
  detected: [],
  inFlight: null,
};

export async function runAutoCliDetection(): Promise<void> {
  if (cliAutoDetectCache.completed) return;
  if (cliAutoDetectCache.inFlight) {
    await cliAutoDetectCache.inFlight;
    return;
  }
  if (typeof window === 'undefined' || !window.arena?.invoke) return;

  cliAutoDetectCache.inFlight = (async () => {
    let detected: DetectedCli[] = [];
    const remaining = CLI_AUTO_DETECT_MAX_ATTEMPTS - cliAutoDetectCache.attempts;
    const tries = Math.max(0, remaining);

    for (let i = 0; i < tries; i++) {
      cliAutoDetectCache.attempts += 1;
      try {
        const result = await window.arena.invoke('provider:detect-cli', undefined);
        detected = result.detected;
      } catch (err) {
        console.warn('[provider:detect-cli] error:', err);
        detected = [];
      }
      if (detected.length > 0) break;
    }

    cliAutoDetectCache.detected = detected;
    cliAutoDetectCache.completed = true;
  })();

  try {
    await cliAutoDetectCache.inFlight;
  } finally {
    cliAutoDetectCache.inFlight = null;
  }
}

// Kick off CLI detection on app startup (module load) once.
void runAutoCliDetection();

// ── Helpers ───────────────────────────────────────────────────────────

export function getCommandKey(command: string): string {
  const normalized = command.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  return base.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
}

export function getDefaultCliConfig(command: string, model: string): ProviderConfig {
  const commandKey = getCommandKey(command);
  switch (commandKey) {
    case 'claude':
      return {
        type: 'cli',
        command,
        args: ['--output-format', 'stream-json', '--verbose'],
        inputFormat: 'stdin-json',
        outputFormat: 'stream-json',
        sessionStrategy: 'persistent',
        hangTimeout: { first: 120_000, subsequent: 60_000 },
        model,
      };
    case 'gemini':
      return {
        type: 'cli',
        command,
        args: ['--output-format', 'stream-json'],
        inputFormat: 'pipe',
        outputFormat: 'stream-json',
        sessionStrategy: 'per-turn',
        hangTimeout: { first: 60_000, subsequent: 30_000 },
        model,
      };
    case 'codex':
      return {
        type: 'cli',
        command,
        args: ['exec', '--json', '-'],
        inputFormat: 'pipe',
        outputFormat: 'jsonl',
        sessionStrategy: 'per-turn',
        hangTimeout: { first: 60_000, subsequent: 30_000 },
        model,
      };
    default:
      return {
        type: 'cli',
        command,
        args: [],
        inputFormat: 'stdin-json',
        outputFormat: 'stream-json',
        sessionStrategy: 'persistent',
        hangTimeout: { first: 30_000, subsequent: 60_000 },
        model,
      };
  }
}
