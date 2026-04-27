/**
 * F4-Task1: ollama-endpoint-resolver — verify the settings → env → fallback
 * priority chain that production callers rely on. Each branch is tested
 * with a minimal injected env so the suite is hermetic against the host's
 * actual `OLLAMA_HOST`.
 */
import { describe, it, expect } from 'vitest';

import {
  OLLAMA_ENDPOINT_FALLBACK,
  OLLAMA_HOST_ENV_VAR,
  resolveOllamaEndpoint,
} from '../ollama-endpoint-resolver';

describe('resolveOllamaEndpoint', () => {
  it('returns the user setting when non-empty', () => {
    const out = resolveOllamaEndpoint(
      { ollamaEndpoint: 'http://my-server:9999' },
      {},
    );
    expect(out).toBe('http://my-server:9999');
  });

  it('trims whitespace from the setting before honouring it', () => {
    const out = resolveOllamaEndpoint(
      { ollamaEndpoint: '  http://trimmed:11434  ' },
      {},
    );
    expect(out).toBe('http://trimmed:11434');
  });

  it('falls through to OLLAMA_HOST when the setting is empty', () => {
    const out = resolveOllamaEndpoint(
      { ollamaEndpoint: '' },
      { [OLLAMA_HOST_ENV_VAR]: 'http://env-host:42' },
    );
    expect(out).toBe('http://env-host:42');
  });

  it('falls through to OLLAMA_HOST when the setting is whitespace-only', () => {
    const out = resolveOllamaEndpoint(
      { ollamaEndpoint: '   ' },
      { [OLLAMA_HOST_ENV_VAR]: 'http://env-host:42' },
    );
    expect(out).toBe('http://env-host:42');
  });

  it('falls back to the literal default when neither setting nor env is set', () => {
    const out = resolveOllamaEndpoint({ ollamaEndpoint: '' }, {});
    expect(out).toBe(OLLAMA_ENDPOINT_FALLBACK);
    expect(out).toBe('http://localhost:11434');
  });

  it('priority chain — settings beats env beats fallback', () => {
    const out = resolveOllamaEndpoint(
      { ollamaEndpoint: 'http://from-settings:11434' },
      { [OLLAMA_HOST_ENV_VAR]: 'http://from-env:11434' },
    );
    expect(out).toBe('http://from-settings:11434');
  });
});
