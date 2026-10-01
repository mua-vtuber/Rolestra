import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api-provider';
import type { ApiProviderConfig } from '../../../../shared/provider-types';
import { collectTokens, mockSSEResponse } from '../../../../test-utils';

function provider(endpoint: string, model: string): ApiProvider {
  const config: ApiProviderConfig = {
    type: 'api', endpoint, model, apiKeyRef: 'test-ref',
  };
  return new ApiProvider({
    id: 'contract-test', displayName: 'Contract test', model, config,
    resolveApiKey: async () => 'test-key',
  });
}

describe('native API contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates the configured Anthropic model without generating tokens and rejects 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);

    expect(await provider('https://api.anthropic.com/v1', 'claude-test').ping()).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models/claude-test',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('validates the configured Google model with native API key auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    expect(await provider('https://generativelanguage.googleapis.com/v1beta', 'gemini-test').ping()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-goog-api-key': 'test-key' },
      }),
    );
  });

  it('streams Codex models through OpenAI Responses with usage and no unsupported temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSSEResponse([
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.output_text.delta","delta":" Codex"}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    expect(await collectTokens(api.streamCompletion(
      [{ role: 'user', content: 'Hi' }], 'Be concise',
      { temperature: 0.5, maxTokens: 128 },
    ))).toEqual(['Hello', ' Codex']);
    expect(api.consumeLastTokenUsage()).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 11 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-5.3-codex', instructions: 'Be concise',
      input: [{ role: 'user', content: 'Hi' }],
      stream: true, store: false, max_output_tokens: 128,
    });
  });

  it('surfaces Responses stream failure events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEResponse([
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"upstream failed"}}}',
    ])));
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    await expect(collectTokens(api.streamCompletion([{ role: 'user', content: 'Hi' }], '')))
      .rejects.toThrow('upstream failed');
  });

  it('rejects a truncated Responses stream without a completion event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEResponse([
      'data: {"type":"response.output_text.delta","delta":"partial"}',
    ])));
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    await expect(collectTokens(api.streamCompletion([{ role: 'user', content: 'Hi' }], '')))
      .rejects.toThrow('without completion');
  });

  it('finishes and cancels a Responses stream when completion arrives before socket close', async () => {
    const encoder = new TextEncoder();
    const cancel = vi.fn();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        const wire = [
          'data: {"type":"response.output_text.delta","delta":"chunked"}\n',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}\n',
        ].join('');
        for (let i = 0; i < wire.length; i += 7) {
          controller.enqueue(encoder.encode(wire.slice(i, i + 7)));
        }
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    let timeoutId: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      collectTokens(api.streamCompletion([{ role: 'user', content: 'Hi' }], '')),
      new Promise<'timeout'>(resolve => { timeoutId = setTimeout(() => resolve('timeout'), 1000); }),
    ]);
    clearTimeout(timeoutId!);
    if (result === 'timeout') streamController.close();
    expect(result).toEqual(['chunked']);
    expect(api.consumeLastTokenUsage()).toEqual({ inputTokens: 2, outputTokens: 1, totalTokens: 3 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an open Responses stream after a failure event', async () => {
    const cancel = vi.fn();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"response.failed","response":{"error":{"message":"failed"}}}\n',
        ));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    let timeoutId: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      collectTokens(api.streamCompletion([{ role: 'user', content: 'Hi' }], ''))
        .then(() => null, (error: unknown) => error),
      new Promise<'timeout'>(resolve => { timeoutId = setTimeout(() => resolve('timeout'), 1000); }),
    ]);
    clearTimeout(timeoutId!);
    if (result === 'timeout') streamController.close();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('failed');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('normalizes text content blocks for Responses and rejects unsupported block types', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSSEResponse([
      'data: {"type":"response.completed","response":{"usage":null}}',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const api = provider('https://api.openai.com/v1', 'gpt-5.3-codex');

    await collectTokens(api.streamCompletion([
      { role: 'user', content: [{ type: 'text', data: 'Part one' }, { type: 'text', data: 'Part two' }] },
    ], ''));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).input).toEqual([{ role: 'user', content: 'Part one\nPart two' }]);
    await expect(collectTokens(api.streamCompletion([
      { role: 'user', content: [{ type: 'image', data: 'not-a-wire-image' }] },
    ], ''))).rejects.toThrow('Unsupported content block');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps OpenAI-compatible proxies on Chat Completions even with a Codex model name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSSEResponse(['data: [DONE]']));
    vi.stubGlobal('fetch', fetchMock);
    const api = provider('https://proxy.example/v1', 'gpt-5.3-codex');

    await collectTokens(api.streamCompletion([{ role: 'user', content: 'Hi' }], ''));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example/v1/chat/completions');
  });
});
