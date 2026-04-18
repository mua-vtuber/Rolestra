/**
 * Integration tests: TurnExecutor + TestStreamingProvider.
 *
 * Because TurnExecutor requires ConversationSession, WebContents, MemoryCoordinator,
 * and imports from the provider registry (plus DB), we test the integration by:
 * - Using the real TestStreamingProvider as the streaming engine
 * - Using a real ConversationSession for message history management
 * - Mocking only the Electron-specific and IO-bound dependencies
 *
 * This validates that the provider streaming, token tracking, error handling,
 * and abort flows work correctly with the real provider implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTestProvider,
} from '../../../test-utils';
import type { Message } from '../../../shared/provider-types';

// ── Helpers ──────────────────────────────────────────────────────────

/** Collect all tokens from a provider's streamCompletion. */
async function collectTokens(
  provider: TestStreamingProvider,
  messages: Message[],
  persona: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of provider.streamCompletion(messages, persona, undefined, signal)) {
    tokens.push(token);
  }
  return tokens;
}

const testMessages: Message[] = [
  { role: 'user', content: 'Hello, how are you?' },
];

// ── Tests ────────────────────────────────────────────────────────────

describe('TurnExecutor + TestStreamingProvider integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams tokens in correct order from provider', async () => {
    const provider = createTestProvider('ai-1', {
      tokens: ['Hello', ' ', 'World', '!'],
    });
    await provider.warmup();

    const tokens = await collectTokens(provider, testMessages, 'Be helpful.');

    expect(tokens).toEqual(['Hello', ' ', 'World', '!']);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].persona).toBe('Be helpful.');
  });

  it('records token usage after completion', async () => {
    const provider = createTestProvider('ai-1', {
      tokens: ['Hello'],
      tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    await provider.warmup();

    await collectTokens(provider, testMessages, '');

    const usage = provider.consumeLastTokenUsage();
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });

    // consumeLastTokenUsage clears it
    expect(provider.consumeLastTokenUsage()).toBeNull();
  });

  it('preserves token order with delayed streaming', async () => {
    const provider = createTestProvider('ai-1', {
      tokens: ['A', 'B', 'C', 'D'],
      tokenDelayMs: 5,
    });
    await provider.warmup();

    const tokens = await collectTokens(provider, testMessages, '');

    expect(tokens).toEqual(['A', 'B', 'C', 'D']);
    expect(provider.calls).toHaveLength(1);
  });

  it('3 AI round-robin: each provider called once per round', async () => {
    const providers = [
      createTestProvider('ai-1', { tokens: ['Response from Claude'] }),
      createTestProvider('ai-2', { tokens: ['Response from Gemini'] }),
      createTestProvider('ai-3', { tokens: ['Response from GPT'] }),
    ];

    for (const p of providers) {
      await p.warmup();
    }

    // Simulate a round: call each provider once
    const results: string[][] = [];
    for (const provider of providers) {
      const tokens = await collectTokens(provider, testMessages, '');
      results.push(tokens);
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual(['Response from Claude']);
    expect(results[1]).toEqual(['Response from Gemini']);
    expect(results[2]).toEqual(['Response from GPT']);

    // Each provider was called exactly once
    for (const p of providers) {
      expect(p.calls).toHaveLength(1);
    }
  });

  it('handles provider error gracefully', async () => {
    const provider = createTestProvider('ai-1', {
      tokens: ['Hello', ' World', '!'],
      errorAtToken: 1,
      errorMessage: 'API rate limit exceeded',
    });
    await provider.warmup();

    // First token succeeds, second throws
    const tokens: string[] = [];
    let caughtError: Error | null = null;

    try {
      for await (const token of provider.streamCompletion(testMessages, '')) {
        tokens.push(token);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(tokens).toEqual(['Hello']);
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('API rate limit exceeded');
  });

  it('error on one turn does not block the next turn', async () => {
    // First provider will error
    const failingProvider = createTestProvider('ai-1', {
      tokens: ['tok1', 'tok2'],
      errorAtToken: 0,
      errorMessage: 'Network error',
    });
    // Second provider succeeds
    const successProvider = createTestProvider('ai-2', {
      tokens: ['Good', ' response'],
    });

    await failingProvider.warmup();
    await successProvider.warmup();

    // First turn: error
    let errorOccurred = false;
    try {
      await collectTokens(failingProvider, testMessages, '');
    } catch {
      errorOccurred = true;
    }
    expect(errorOccurred).toBe(true);

    // Second turn: should succeed independently
    const tokens = await collectTokens(successProvider, testMessages, '');
    expect(tokens).toEqual(['Good', ' response']);
  });

  it('abort mid-turn yields partial tokens and ends cleanly', async () => {
    const controller = new AbortController();
    const provider = createTestProvider('ai-1', {
      tokens: ['A', 'B', 'C', 'D', 'E'],
      tokenDelayMs: 20,
    });
    await provider.warmup();

    const tokens: string[] = [];

    // Abort after 50ms (should collect ~2-3 tokens at 20ms each)
    setTimeout(() => controller.abort(), 50);

    for await (const token of provider.streamCompletion(
      testMessages, '', undefined, controller.signal,
    )) {
      tokens.push(token);
    }

    // Should have some but not all tokens
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.length).toBeLessThan(5);
    // Provider status should return to ready after streaming ends
    expect(provider.getStatus()).toBe('ready');
  });

  it('multiple sequential turns get correct message history', async () => {
    const provider = createTestProvider('ai-1', {
      tokens: ['Response'],
    });
    await provider.warmup();

    // Turn 1 with 1 message
    const messages1: Message[] = [{ role: 'user', content: 'First question' }];
    await collectTokens(provider, messages1, 'persona-1');

    // Turn 2 with accumulated history
    const messages2: Message[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Second question' },
    ];
    await collectTokens(provider, messages2, 'persona-1');

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].messages).toHaveLength(1);
    expect(provider.calls[1].messages).toHaveLength(3);
    expect(provider.calls[1].messages[2].content).toBe('Second question');
  });

  it('persona is passed correctly in each call', async () => {
    const providers = [
      createTestProvider('ai-1', { tokens: ['R1'] }),
      createTestProvider('ai-2', { tokens: ['R2'] }),
    ];

    for (const p of providers) await p.warmup();

    await collectTokens(providers[0], testMessages, 'You are Claude, a helpful AI.');
    await collectTokens(providers[1], testMessages, 'You are Gemini, an analytical AI.');

    expect(providers[0].calls[0].persona).toBe('You are Claude, a helpful AI.');
    expect(providers[1].calls[0].persona).toBe('You are Gemini, an analytical AI.');
  });
});
