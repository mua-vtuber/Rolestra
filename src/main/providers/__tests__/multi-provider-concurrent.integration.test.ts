/**
 * Integration tests for concurrent multi-provider streaming.
 *
 * Uses TestStreamingProvider to verify:
 * - 2 providers stream simultaneously via Promise.all
 * - 3 providers registered, each gets its own tokens
 * - Abort one mid-stream, others complete
 * - Different token counts per provider
 * - Provider error during concurrent streaming doesn't affect others
 */

import { describe, it, expect } from 'vitest';
import {
  createTestProvider,
  collectTokens,
} from '../../../test-utils';

// ── Tests ────────────────────────────────────────────────────────────

describe('Multi-Provider Concurrent Integration', () => {
  const MESSAGES = [{ role: 'user' as const, content: 'test' }];

  // ── 1. Two providers stream simultaneously ─────────────────────────

  it('2 providers stream simultaneously using Promise.all', async () => {
    const providerA = createTestProvider('concurrent-a', {
      tokens: ['Alpha', ' One'],
      tokenDelayMs: 5,
    });
    const providerB = createTestProvider('concurrent-b', {
      tokens: ['Beta', ' Two'],
      tokenDelayMs: 5,
    });

    const [tokensA, tokensB] = await Promise.all([
      collectTokens(providerA.streamCompletion(MESSAGES, '')),
      collectTokens(providerB.streamCompletion(MESSAGES, '')),
    ]);

    expect(tokensA).toEqual(['Alpha', ' One']);
    expect(tokensB).toEqual(['Beta', ' Two']);
  });

  // ── 2. Three providers each get their own tokens ───────────────────

  it('3 providers stream all, each gets its own tokens', async () => {
    const p1 = createTestProvider('multi-1', { tokens: ['A', 'B'] });
    const p2 = createTestProvider('multi-2', { tokens: ['X', 'Y', 'Z'] });
    const p3 = createTestProvider('multi-3', { tokens: ['One'] });

    const [t1, t2, t3] = await Promise.all([
      collectTokens(p1.streamCompletion(MESSAGES, '')),
      collectTokens(p2.streamCompletion(MESSAGES, '')),
      collectTokens(p3.streamCompletion(MESSAGES, '')),
    ]);

    expect(t1).toEqual(['A', 'B']);
    expect(t2).toEqual(['X', 'Y', 'Z']);
    expect(t3).toEqual(['One']);
  });

  // ── 3. One aborted mid-stream, others continue ────────────────────

  it('one provider aborted mid-stream, others continue and complete', async () => {
    const controller = new AbortController();

    const normalProvider = createTestProvider('keep-going', {
      tokens: ['Still', ' alive'],
      tokenDelayMs: 5,
    });
    const abortedProvider = createTestProvider('aborted', {
      tokens: ['Will', ' be', ' cut'],
      tokenDelayMs: 20,
    });

    // Abort the second provider after a short delay
    setTimeout(() => controller.abort(), 10);

    const [normalTokens, abortedTokens] = await Promise.all([
      collectTokens(normalProvider.streamCompletion(MESSAGES, '')),
      collectTokens(abortedProvider.streamCompletion(MESSAGES, '', undefined, controller.signal)),
    ]);

    expect(normalTokens).toEqual(['Still', ' alive']);
    // Aborted provider may have partial or no tokens
    expect(abortedTokens.length).toBeLessThan(3);
  });

  // ── 4. Different token counts per provider ─────────────────────────

  it('different token counts per provider, verify each collects correct tokens', async () => {
    const short = createTestProvider('short', { tokens: ['hi'] });
    const long = createTestProvider('long', {
      tokens: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    });

    const [shortTokens, longTokens] = await Promise.all([
      collectTokens(short.streamCompletion(MESSAGES, '')),
      collectTokens(long.streamCompletion(MESSAGES, '')),
    ]);

    expect(shortTokens).toHaveLength(1);
    expect(longTokens).toHaveLength(10);
    expect(shortTokens).toEqual(['hi']);
    expect(longTokens).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  });

  // ── 5. Error in one provider doesn't affect others ─────────────────

  it('provider error during concurrent streaming does not affect others', async () => {
    const goodProvider = createTestProvider('good', {
      tokens: ['Works', ' fine'],
    });
    const errorProvider = createTestProvider('error', {
      tokens: ['Before', ' crash'],
      errorAtToken: 1,
      errorMessage: 'Simulated failure',
    });

    const results = await Promise.allSettled([
      collectTokens(goodProvider.streamCompletion(MESSAGES, '')),
      collectTokens(errorProvider.streamCompletion(MESSAGES, '')),
    ]);

    // Good provider succeeds
    expect(results[0].status).toBe('fulfilled');
    if (results[0].status === 'fulfilled') {
      expect(results[0].value).toEqual(['Works', ' fine']);
    }

    // Error provider rejects
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect((results[1].reason as Error).message).toContain('Simulated failure');
    }
  });
});
