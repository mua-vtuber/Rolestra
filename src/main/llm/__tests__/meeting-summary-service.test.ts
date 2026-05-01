/**
 * MeetingSummaryService — R10 Task 11 land, R11-Task9 capability filter
 * 정식화 (gating literal `'streaming'` → `'summarize'`).
 *
 * Coverage:
 *   - happy path: ready provider with summarize capability returns a summary
 *   - preferred provider id wins when ready + capable
 *   - falls back to the next ready provider when preferred is missing capability
 *   - returns {summary:null, providerId:null} when no ready provider exists
 *   - empty content short-circuits (no provider call)
 *   - provider that throws → null result + warn log
 *   - output truncation when stream exceeds the cap
 *   - empty stream → null result
 *   - R11-Task9: provider with only 'streaming' (no 'summarize') is skipped
 *   - R11-Task9: not-ready provider with 'summarize' is skipped
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MeetingSummaryService,
  type LlmCostAuditSink,
} from '../meeting-summary-service';
import type { BaseProvider } from '../../providers/provider-interface';
import type { ProviderInfo } from '../../../shared/provider-types';

interface FakeProviderOpts {
  id: string;
  ready?: boolean;
  capabilities?: string[];
  stream?: AsyncGenerator<string>;
  streamThrows?: Error;
  /** R11-Task8: usage value returned from consumeLastTokenUsage(). */
  usage?: { inputTokens: number; outputTokens: number } | null;
  /** R11-Task8: throw from consumeLastTokenUsage(). */
  usageThrows?: Error;
}

function makeProvider(opts: FakeProviderOpts): BaseProvider {
  // R11-Task9: default capability now matches the production providers —
  // both 'streaming' and 'summarize'. Tests that need to exercise the
  // capability filter override `capabilities` explicitly.
  const caps = new Set<string>(opts.capabilities ?? ['streaming', 'summarize']);
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
    consumeLastTokenUsage: () => {
      if (opts.usageThrows) throw opts.usageThrows;
      return opts.usage ?? null;
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
            roles: [],
            skill_overrides: null,
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

  // ── R11-Task9: 'summarize' capability filter coverage ──────────────

  it('skips providers that have streaming but not summarize (R11-Task9)', async () => {
    // streaming-only provider must be filtered out — proves the literal
    // really swapped from 'streaming' to 'summarize'.
    const streamingOnly = makeProvider({
      id: 'streaming-only',
      capabilities: ['streaming'],
    });
    const summarizer = makeProvider({
      id: 'summarizer',
      capabilities: ['streaming', 'summarize'],
    });
    const svc = new MeetingSummaryService({
      providerRegistry: makeRegistry([streamingOnly, summarizer]),
    });
    const result = await svc.summarize('body');
    expect(result.providerId).toBe('summarizer');
  });

  it('preferred provider with only streaming falls back to summarize-capable peer', async () => {
    const preferredStreamingOnly = makeProvider({
      id: 'pref',
      capabilities: ['streaming'],
    });
    const summarizer = makeProvider({
      id: 'sum',
      capabilities: ['streaming', 'summarize'],
    });
    const svc = new MeetingSummaryService({
      providerRegistry: makeRegistry([preferredStreamingOnly, summarizer]),
    });
    const result = await svc.summarize('body', { preferredProviderId: 'pref' });
    expect(result.providerId).toBe('sum');
  });

  it('returns null when only streaming-capable providers exist', async () => {
    const a = makeProvider({ id: 'a', capabilities: ['streaming'] });
    const b = makeProvider({ id: 'b', capabilities: ['streaming'] });
    const svc = new MeetingSummaryService({ providerRegistry: makeRegistry([a, b]) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await svc.summarize('body');
    expect(result).toEqual({ summary: null, providerId: null });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips a not-ready provider that DOES have summarize', async () => {
    const offlineButCapable = makeProvider({
      id: 'offline',
      ready: false,
      capabilities: ['streaming', 'summarize'],
    });
    const onlineSummarizer = makeProvider({ id: 'online' });
    const svc = new MeetingSummaryService({
      providerRegistry: makeRegistry([offlineButCapable, onlineSummarizer]),
    });
    const result = await svc.summarize('body');
    expect(result.providerId).toBe('online');
  });

  it('preferred provider that is not-ready falls back even if summarize-capable', async () => {
    const offlineSummarizer = makeProvider({
      id: 'pref',
      ready: false,
      capabilities: ['streaming', 'summarize'],
    });
    const fallback = makeProvider({ id: 'fallback' });
    const svc = new MeetingSummaryService({
      providerRegistry: makeRegistry([offlineSummarizer, fallback]),
    });
    const result = await svc.summarize('body', { preferredProviderId: 'pref' });
    expect(result.providerId).toBe('fallback');
  });

  // ── R11-Task8: cost audit sink integration ─────────────────────────

  describe('cost audit sink (R11-Task8)', () => {
    function fakeSink(): {
      append: ReturnType<typeof vi.fn>;
    } & LlmCostAuditSink {
      const append = vi.fn(
        (_input: {
          meetingId: string | null;
          providerId: string;
          tokenIn: number;
          tokenOut: number;
        }) => undefined,
      );
      return { append };
    }

    it('appends one row with the meetingId + provider tokens on success', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 1000, outputTokens: 250 },
      });
      const sink = fakeSink();
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      const result = await svc.summarize('body', { meetingId: 'meeting-1' });
      expect(result.providerId).toBe('p');
      expect(sink.append).toHaveBeenCalledTimes(1);
      expect(sink.append).toHaveBeenCalledWith({
        meetingId: 'meeting-1',
        providerId: 'p',
        tokenIn: 1000,
        tokenOut: 250,
      });
    });

    it('passes meetingId=null when the caller omits it (smoke / classifier)', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 5, outputTokens: 5 },
      });
      const sink = fakeSink();
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      await svc.summarize('body');
      expect(sink.append).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: null }),
      );
    });

    it('skips the append when consumeLastTokenUsage returns null (no usage reported)', async () => {
      const provider = makeProvider({ id: 'p', usage: null });
      const sink = fakeSink();
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      await svc.summarize('body');
      expect(sink.append).not.toHaveBeenCalled();
    });

    it('skips the append when both token counts are zero', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      const sink = fakeSink();
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      await svc.summarize('body');
      expect(sink.append).not.toHaveBeenCalled();
    });

    it('does not throw when the sink itself throws (best-effort)', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      const sink: LlmCostAuditSink = {
        append: () => {
          throw new Error('disk full');
        },
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      const result = await svc.summarize('body', { meetingId: 'm-1' });
      expect(result.providerId).toBe('p');
      expect(warnSpy).toHaveBeenCalledWith(
        '[meeting-summary] cost audit append failed',
        expect.objectContaining({ providerId: 'p' }),
      );
    });

    it('does not throw when consumeLastTokenUsage itself throws', async () => {
      const provider = makeProvider({
        id: 'p',
        usageThrows: new Error('usage broken'),
      });
      const sink = fakeSink();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      const result = await svc.summarize('body');
      expect(result.providerId).toBe('p');
      expect(sink.append).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[meeting-summary] consumeLastTokenUsage threw',
        expect.objectContaining({ providerId: 'p' }),
      );
    });

    it('skips the append entirely when no sink is wired (back-compat)', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 10, outputTokens: 10 },
      });
      const consumeSpy = vi.spyOn(provider, 'consumeLastTokenUsage');
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
      });
      const result = await svc.summarize('body');
      expect(result.providerId).toBe('p');
      // The optional sink branch returns early before consuming usage
      // so a provider whose summary worked still has its usage available
      // for whatever the caller wants to do with it.
      expect(consumeSpy).not.toHaveBeenCalled();
    });

    it('does not append when summary content is empty (no provider call at all)', async () => {
      const provider = makeProvider({
        id: 'p',
        usage: { inputTokens: 10, outputTokens: 10 },
      });
      const sink = fakeSink();
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        costAuditSink: sink,
      });
      await svc.summarize('   ');
      expect(sink.append).not.toHaveBeenCalled();
    });
  });

  // ── R12-S Task 10 — 자동 선택 + 카탈로그 prompt + 사용자 명시 throw ───
  describe('R12-S — getSummaryModelSettings + skill catalog wire', () => {
    it('auto-selects Anthropic Haiku via resolveSummaryProvider when settings is null', async () => {
      // Order: gemini-flash 먼저 등록 → haiku 두 번째. 자동 선택은 Haiku 우선.
      const flash = makeProvider({ id: 'flash' });
      const haiku = makeProvider({ id: 'haiku' });
      const registry = makeRegistry([flash, haiku]);
      // listAll 의 model 필드는 makeRegistry 가 'm' 으로 채우므로
      // resolver 가 model regex 로 인식하도록 override.
      const origListAll = registry.listAll;
      registry.listAll = () =>
        origListAll().map((info) =>
          info.id === 'haiku'
            ? { ...info, model: 'claude-haiku-4-5' }
            : info.id === 'flash'
              ? { ...info, model: 'gemini-2.5-flash' }
              : info,
        );
      const svc = new MeetingSummaryService({
        providerRegistry: registry,
        getSummaryModelSettings: () => ({ summaryModelProviderId: null }),
      });
      const result = await svc.summarize('body');
      expect(result.providerId).toBe('haiku');
    });

    it('honours user-specified summary provider over auto-selection', async () => {
      const haiku = makeProvider({ id: 'haiku' });
      const flash = makeProvider({ id: 'flash' });
      const registry = makeRegistry([haiku, flash]);
      const origListAll = registry.listAll;
      registry.listAll = () =>
        origListAll().map((info) =>
          info.id === 'haiku'
            ? { ...info, model: 'claude-haiku-4-5' }
            : { ...info, model: 'gemini-2.5-flash' },
        );
      const svc = new MeetingSummaryService({
        providerRegistry: registry,
        getSummaryModelSettings: () => ({ summaryModelProviderId: 'flash' }),
      });
      const result = await svc.summarize('body');
      expect(result.providerId).toBe('flash');
    });

    it('uses the meeting-summary catalog prompt as system prompt', async () => {
      let capturedMessages: unknown[] = [];
      const provider = makeProvider({ id: 'p' });
      vi.spyOn(provider, 'streamCompletion').mockImplementation(
        function* (msgs: unknown) {
          capturedMessages = msgs as unknown[];
          yield 'mocked summary line';
        } as unknown as BaseProvider['streamCompletion'],
      );
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([provider]),
        getSummaryModelSettings: () => ({ summaryModelProviderId: null }),
      });
      await svc.summarize('body');
      const allText = JSON.stringify(capturedMessages);
      expect(allText).toContain('한 단락');
      expect(allText).toContain('메타 코멘트나 머리말 없이');
    });

    it('throws when user-specified provider lacks summarize capability', async () => {
      const weird = makeProvider({ id: 'weird', capabilities: ['streaming'] });
      const svc = new MeetingSummaryService({
        providerRegistry: makeRegistry([weird]),
        getSummaryModelSettings: () => ({ summaryModelProviderId: 'weird' }),
      });
      await expect(svc.summarize('body')).rejects.toThrow(/weird/);
    });
  });
});
