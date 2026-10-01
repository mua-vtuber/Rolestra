/**
 * QA Medium-1 (2026-10-01): a connection check says WHY it failed, so the
 * settings AI tab can show the real cause instead of a fixed hint. Checked
 * against real HTTP servers on 127.0.0.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiProvider } from '../api/api-provider';
import { LocalProvider } from '../local/local-provider';
import type { ApiProviderConfig, LocalProviderConfig } from '../../../shared/provider-types';

type Route = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function serve(routes: Record<string, Route>): Promise<string> {
  const server = createServer((request, response) => {
    const route = routes[request.url ?? ''];
    if (route) route(request, response);
    else response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

async function closedAddress(): Promise<string> {
  const base = await serve({});
  const server = servers.pop();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  return base;
}

function status(code: number, body: unknown = {}): Route {
  return (_request, response) => {
    response.writeHead(code, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
}

function api(endpoint: string, resolveApiKey: (ref: string) => Promise<string> = async () => 'sk-test'): ApiProvider {
  const config: ApiProviderConfig = { type: 'api', endpoint, apiKeyRef: 'provider-x', model: 'm' };
  return new ApiProvider({ id: 'api-1', displayName: 'Api', model: 'm', config, resolveApiKey });
}

function local(config: LocalProviderConfig): LocalProvider {
  return new LocalProvider({ id: 'local-1', displayName: 'Local', model: config.model, config });
}

describe('ApiProvider.checkConnection', () => {
  it('passes when the models endpoint answers', async () => {
    const base = await serve({ '/v1/models': status(200, { data: [] }) });
    expect(await api(`${base}/v1`).checkConnection()).toBeNull();
  });

  it('names a rejected key, another HTTP error, and an unreachable server', async () => {
    const auth = await serve({ '/v1/models': status(401) });
    expect(await api(`${auth}/v1`).checkConnection()).toEqual({ code: 'auth', detail: 'HTTP 401' });
    const broken = await serve({ '/v1/models': status(500) });
    expect(await api(`${broken}/v1`).checkConnection()).toEqual({ code: 'http-error', detail: 'HTTP 500' });
    const closed = await closedAddress();
    expect(await api(`${closed}/v1`).checkConnection()).toEqual({ code: 'network', detail: 'ECONNREFUSED' });
  });

  it('names a missing key without any request', async () => {
    const base = await serve({ '/v1/models': status(200) });
    const provider = api(`${base}/v1`, async (ref) => { throw new Error(`API key not found: ${ref}`); });
    expect(await provider.checkConnection()).toEqual({ code: 'key-missing', detail: null });
  });

  it('keeps the last failure on the provider after warm-up', async () => {
    const base = await serve({ '/v1/models': status(403) });
    const provider = api(`${base}/v1`);
    await provider.warmup();
    expect(provider.connectionFailure).toEqual({ code: 'auth', detail: 'HTTP 403' });
    expect(provider.getStatus()).toBe('error');
  });
});

describe('LocalProvider.checkConnection', () => {
  const ollama = (models: string[]): Record<string, Route> => ({
    '/api/version': status(200, { version: '0.9.0' }),
    '/api/tags': status(200, { models: models.map((name) => ({ name })) }),
  });

  it('checks a confirmed Ollama with the Ollama detector, by cause', async () => {
    const running = await serve(ollama(['gemma4:e4b']));
    expect(await local({ type: 'local', baseUrl: running, model: 'gemma4:e4b', confirmedServer: 'ollama' })
      .checkConnection()).toBeNull();
    expect(await local({ type: 'local', baseUrl: running, model: 'llama3:8b', confirmedServer: 'ollama' })
      .checkConnection()).toEqual({ code: 'local-model-missing', detail: 'llama3:8b' });
    const closed = await closedAddress();
    expect(await local({ type: 'local', baseUrl: closed, model: 'm', confirmedServer: 'ollama' })
      .checkConnection()).toEqual({ code: 'local-not-running', detail: 'ECONNREFUSED' });
    const other = await serve({ '/api/version': status(200, { service: 'another-server' }) });
    expect(await local({ type: 'local', baseUrl: other, model: 'm', confirmedServer: 'ollama' })
      .checkConnection()).toEqual({ code: 'local-not-ollama', detail: null });
  });

  it.each([302, 401, 403, 404, 500])('keeps Ollama HTTP %i distinct from a non-Ollama response', async (code) => {
    const base = await serve({ '/api/version': status(code) });
    const provider = local({ type: 'local', baseUrl: base, model: 'm', confirmedServer: 'ollama' });
    await provider.warmup();
    expect(provider.connectionFailure).toEqual({ code: 'http-error', detail: `HTTP ${code}` });
    expect(provider.getStatus()).toBe('not-installed');
  });

  it('checks any other local server through its models endpoint', async () => {
    const server = await serve({ '/v1/models': status(200, { data: [] }) });
    expect(await local({ type: 'local', baseUrl: server, model: 'm' }).checkConnection()).toBeNull();
    const closed = await closedAddress();
    expect(await local({ type: 'local', baseUrl: closed, model: 'm' }).checkConnection())
      .toEqual({ code: 'network', detail: 'ECONNREFUSED' });
  });
});
