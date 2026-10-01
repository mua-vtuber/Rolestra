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
  toOllamaBaseUrl,
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

/**
 * 2026-10-01 R6-3: the resolved value is read the way the `ollama` CLI reads
 * `OLLAMA_HOST` — a value without a scheme is http on port 11434, an empty
 * host is 127.0.0.1 — and turned into the base URL detection calls.
 */
describe('toOllamaBaseUrl', () => {
  it('keeps a full URL and drops a trailing slash', () => {
    expect(toOllamaBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(toOllamaBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(toOllamaBaseUrl('  http://127.0.0.1:11500  ')).toBe('http://127.0.0.1:11500');
  });

  it('reads a scheme-less value as http on the Ollama port, like OLLAMA_HOST', () => {
    expect(toOllamaBaseUrl('127.0.0.1:11500')).toBe('http://127.0.0.1:11500');
    expect(toOllamaBaseUrl('my-host')).toBe('http://my-host:11434');
    expect(toOllamaBaseUrl(':11500')).toBe('http://127.0.0.1:11500');
  });

  it('keeps a reverse-proxy path and the scheme default port when a scheme is given', () => {
    expect(toOllamaBaseUrl('https://proxy.example/ollama/')).toBe('https://proxy.example/ollama');
    expect(toOllamaBaseUrl('http://my-host')).toBe('http://my-host');
  });

  it('returns null for a value that is not an http(s) address', () => {
    expect(toOllamaBaseUrl('')).toBeNull();
    expect(toOllamaBaseUrl('   ')).toBeNull();
    expect(toOllamaBaseUrl('ftp://files.example')).toBeNull();
    expect(toOllamaBaseUrl('http://user:secret@host:11434')).toBeNull();
    expect(toOllamaBaseUrl('http://')).toBeNull();
  });
});
