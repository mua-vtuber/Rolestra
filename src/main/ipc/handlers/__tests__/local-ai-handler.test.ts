/**
 * 2026-10-01 R6-3: `provider:detect-local` and `provider:add-local`. Main
 * resolves the Ollama address itself (settings → OLLAMA_HOST → default),
 * the renderer sends none, and only main can mark a local AI as a
 * confirmed Ollama server.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settings, mockRegisterProvider } = vi.hoisted(() => ({
  settings: { ollamaEndpoint: '' },
  mockRegisterProvider: vi.fn(async (displayName: string, config: unknown) => ({
    id: 'local-new', displayName, config,
  })),
}));

vi.mock('../../../config/instance', () => ({
  getConfigService: () => ({ getSettings: () => settings }),
}));

vi.mock('../../../providers/provider-registration', () => ({ registerProvider: mockRegisterProvider }));

import { LocalAiNotReadyError, LocalModelMissingError } from '../../../providers/local/local-ai-errors';
import { handleProviderAddLocal, handleProviderDetectLocal } from '../local-ai-handler';

const servers: Server[] = [];

async function startOllama(models: string[]): Promise<string> {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/version') response.end(JSON.stringify({ version: '0.9.0' }));
    else if (request.url === '/api/tags') response.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    else response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.ollamaEndpoint = '';
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('provider:detect-local', () => {
  it('detects at the address main resolved from settings', async () => {
    const base = await startOllama(['gemma4:e4b']);
    settings.ollamaEndpoint = base;
    expect(await handleProviderDetectLocal()).toEqual({
      detection: { status: 'running', endpoint: base, version: '0.9.0', models: ['gemma4:e4b'] },
    });
  });
});

describe('provider:add-local', () => {
  it('registers the chosen model at the resolved address, marked as confirmed Ollama', async () => {
    const base = await startOllama(['gemma4:e4b', 'llama3:8b']);
    settings.ollamaEndpoint = base;
    const result = await handleProviderAddLocal({ displayName: 'gemma4:e4b', model: 'llama3:8b' });
    expect(mockRegisterProvider).toHaveBeenCalledWith('gemma4:e4b', {
      type: 'local', baseUrl: base, model: 'llama3:8b', confirmedServer: 'ollama',
    });
    expect(result.provider.id).toBe('local-new');
  });

  it('refuses a model the server does not have', async () => {
    settings.ollamaEndpoint = await startOllama(['gemma4:e4b']);
    const failure = handleProviderAddLocal({ displayName: 'x', model: 'missing:latest' });
    await expect(failure).rejects.toBeInstanceOf(LocalModelMissingError);
    await expect(failure).rejects.toThrow(/missing:latest/);
    expect(mockRegisterProvider).not.toHaveBeenCalled();
  });

  it('refuses when Ollama is not running there, naming the status', async () => {
    const base = await startOllama([]);
    settings.ollamaEndpoint = base;
    const failure = handleProviderAddLocal({ displayName: 'x', model: 'gemma4:e4b' });
    await expect(failure).rejects.toBeInstanceOf(LocalAiNotReadyError);
    await expect(failure).rejects.toThrow(/no-models/);
    expect(mockRegisterProvider).not.toHaveBeenCalled();
  });
});
