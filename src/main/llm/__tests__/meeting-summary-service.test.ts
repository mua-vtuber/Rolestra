/**
 * MeetingSummaryService — R10 Task 11.
 *
 * Coverage:
 *   - happy path: ready provider with streaming capability returns a summary
 *   - preferred provider id wins when ready + capable
 *   - falls back to the next ready provider when preferred is missing capability
 *   - returns {summary:null, providerId:null} when no ready provider exists
 *   - empty content short-circuits (no provider call)
 *   - provider that throws → null result + warn log
 *   - output truncation when stream exceeds the cap
 *   - empty stream → null result
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingSummaryService } from '../meeting-summary-service';
import type { BaseProvider } from '../../providers/provider-interface';
import type { ProviderInfo } from '../../../shared/provider-types';

interface FakeProviderOpts {
  id: string;
  ready?: boolean;
  capabilities?: string[];
  stream?: AsyncGenerator<string>;
  streamThrows?: Error;
}

function makeProvider(opts: FakeProviderOpts): BaseProvider {
  const caps = new Set<string>(opts.capabilities ?? ['streaming']);
  const ready = opts.ready ?? true;
  const provider = {
    id: opts.id,
    capabilities: caps,
    isReady: () => ready,
    streamCompletion: async function* (): AsyncGenerator<string> {
      if (opts.streamThrows) throw opts.streamThrows;
      if (opts.stream) {
        for await (const chunk of opts.stream) yield chunk;
      } else {
        yield 'mocked summary line';
      }
    },
  };
  return provider as unknown as BaseProvider;
}

function makeRegistry(providers: BaseProvider[]) {
  const byId = new Map<string, BaseProvider>(providers.map((p) => [p.id, p]));
  return {
    get: (id: string) => byId.get(id),
    listAll: (): ProviderInfo[] =>
      providers.map(
        (p) =>
          ({
            id: p.id,
            type: 'api' as const,
            displayName: p.id,
            model: 'm',
            capabilities: Array.from(p.capabilities) as ProviderInfo['capabilities'],
            status: p.isReady() ? 'ready' : 'not-installed',
            config: { type: 'api' as const, endpoint: '', apiKeyRef: '', model: 'm' },
          }) satisfies ProviderInfo,
      ),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('MeetingSummaryService', () => {
  it('returns the provider summary on the happy path', async () => {
    const provider = makeProvider({ id: 'p-1' });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([provider]) });
    const result = await svc.summarize('meeting body content here');
    expect(result.summary).toBe('mocked summary line');
    expect(result.providerId).toBe('p-1');
  });

  it('honours preferredProviderId when that provider is ready + capable', async () => {
    const a = makeProvider({ id: 'a' });
    const b = makeProvider({ id: 'b' });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([a, b]) });
    const result = await svc.summarize('body', { preferredProviderId: 'b' });
    expect(result.providerId).toBe('b');
  });

  it('falls back to the next capable provider when preferred lacks the capability', async () => {
    const a = makeProvider({ id: 'a', capabilities: [] });
    const b = makeProvider({ id: 'b' });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([a, b]) });
    const result = await svc.summarize('body', { preferredProviderId: 'a' });
    expect(result.providerId).toBe('b');
  });

  it('returns null when no provider has the capability', async () => {
    const a = makeProvider({ id: 'a', capabilities: [] });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([a]) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await svc.summarize('body');
    expect(result).toEqual({ summary: null, providerId: null });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('short-circuits on empty content (no provider call)', async () => {
    const provider = makeProvider({ id: 'p' });
    const stream = vi.spyOn(provider, 'streamCompletion');
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([provider]) });
    const result = await svc.summarize('   ');
    expect(result).toEqual({ summary: null, providerId: null });
    expect(stream).not.toHaveBeenCalled();
  });

  it('returns null when the provider throws (no rethrow)', async () => {
    const provider = makeProvider({
      id: 'p',
      streamThrows: new Error('provider crashed'),
    });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([provider]) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await svc.summarize('body');
    expect(result).toEqual({ summary: null, providerId: null });
    expect(warnSpy).toHaveBeenCalledWith(
      '[meeting-summary] provider call failed',
      expect.objectContaining({ providerId: 'p' }),
    );
  });

  it('returns null on an empty stream', async () => {
    const empty: AsyncGenerator<string> = (async function* () {})();
    const provider = makeProvider({ id: 'p', stream: empty });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([provider]) });
    const result = await svc.summarize('body');
    expect(result).toEqual({ summary: null, providerId: null });
  });

  it('truncates very long output at the safety cap', async () => {
    // Long stream: 5,000 chars in one chunk. The service reads up to ~4,000.
    const big = 'A'.repeat(5_000);
    const stream: AsyncGenerator<string> = (async function* () {
      yield big;
    })();
    const provider = makeProvider({ id: 'p', stream });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([provider]) });
    const result = await svc.summarize('body');
    expect(result.providerId).toBe('p');
    expect(result.summary).not.toBeNull();
    // Bounded — never balloons to the full 5,000 chars.
    expect(result.summary!.length).toBeLessThanOrEqual(5_000);
  });
});
