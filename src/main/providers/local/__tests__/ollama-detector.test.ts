/**
 * 2026-10-01 R6-3: Ollama detection reports what the local server actually
 * answered, by cause, against a real HTTP server on 127.0.0.1 — never an
 * empty model list in place of a failure.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { detectOllama } from '../ollama-detector';

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

function json(body: unknown, status = 200): Route {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
}

const VERSION = json({ version: '0.9.0' });

describe('detectOllama', () => {
  it('reports a running Ollama with its installed models', async () => {
    const base = await serve({
      '/api/version': VERSION,
      '/api/tags': json({ models: [{ name: 'gemma4:e4b' }, { name: 'llama3:8b' }] }),
    });
    expect(await detectOllama(base)).toEqual({
      status: 'running', endpoint: base, version: '0.9.0', models: ['gemma4:e4b', 'llama3:8b'],
    });
  });

  it('reads a scheme-less address the way OLLAMA_HOST is read', async () => {
    const base = await serve({ '/api/version': VERSION, '/api/tags': json({ models: [{ name: 'm' }] }) });
    const detection = await detectOllama(base.replace('http://', ''));
    expect(detection).toMatchObject({ status: 'running', endpoint: base });
  });

  it('reports zero models as its own status, not as a failure or a filler list', async () => {
    const base = await serve({ '/api/version': VERSION, '/api/tags': json({ models: [] }) });
    expect(await detectOllama(base)).toEqual({ status: 'no-models', endpoint: base, version: '0.9.0' });
  });

  it('says nothing answers when the connection is refused', async () => {
    const base = await serve({});
    await new Promise<void>((resolve) => {
      const server = servers.pop();
      server?.close(() => resolve());
    });
    expect(await detectOllama(base)).toEqual({
      status: 'not-responding', endpoint: base, cause: 'refused', detail: 'ECONNREFUSED',
    });
  });

  it('gives up after its timeout instead of hanging', async () => {
    const base = await serve({ '/api/version': () => { /* never answers */ } });
    const started = Date.now();
    const detection = await detectOllama(base, 150);
    expect(detection).toEqual({ status: 'not-responding', endpoint: base, cause: 'timeout', detail: null });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('says the server is not Ollama when the version endpoint answers with an HTTP error', async () => {
    const base = await serve({});
    expect(await detectOllama(base)).toEqual({
      status: 'unrecognized', endpoint: base, cause: 'http-error', detail: 'HTTP 404',
    });
  });

  // QA Minor 2: a redirect is never followed off the local address.
  it('reports a redirect by its status and never follows it', async () => {
    let followed = 0;
    const elsewhere = await serve({ '/api/version': (_request, response) => {
      followed += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: '9.9.9' }));
    } });
    const base = await serve({ '/api/version': (_request, response) => {
      response.writeHead(302, { location: `${elsewhere}/api/version` });
      response.end();
    } });
    expect(await detectOllama(base)).toEqual({
      status: 'unrecognized', endpoint: base, cause: 'http-error', detail: 'HTTP 302',
    });
    expect(followed).toBe(0);
  });

  it('says the server is not Ollama when the version answer is not Ollama-shaped', async () => {
    const lmStudioLike = await serve({ '/api/version': json({ object: 'list', data: [] }) });
    expect(await detectOllama(lmStudioLike)).toEqual({
      status: 'unrecognized', endpoint: lmStudioLike, cause: 'not-ollama', detail: null,
    });
    const html = await serve({ '/api/version': (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>hello</html>');
    } });
    expect(await detectOllama(html)).toMatchObject({ status: 'unrecognized', cause: 'not-ollama' });
  });

  it('reports an unreadable model list by cause instead of an empty list', async () => {
    const malformed = await serve({ '/api/version': VERSION, '/api/tags': json({ models: 'none' }) });
    expect(await detectOllama(malformed)).toEqual({
      status: 'unrecognized', endpoint: malformed, cause: 'bad-model-list', detail: null,
    });
    const failing = await serve({ '/api/version': VERSION, '/api/tags': json({ error: 'boom' }, 500) });
    expect(await detectOllama(failing)).toEqual({
      status: 'unrecognized', endpoint: failing, cause: 'bad-model-list', detail: 'HTTP 500',
    });
  });

  it('refuses an address that is not http(s) without any request', async () => {
    expect(await detectOllama('ftp://files.example')).toEqual({
      status: 'invalid-endpoint', endpoint: 'ftp://files.example',
    });
  });
});
