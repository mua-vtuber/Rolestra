import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { StructuredLogEntry } from '../../../shared/log-types';
import { StructuredLogger, createLogger } from '../structured-logger';
import { LogExporter, maskApiKeys } from '../log-exporter';

// ── Helpers ───────────────────────────────────────────────────────

/** Create a minimal valid log entry (partial, without level). */
function makeEntry(
  overrides: Partial<Omit<StructuredLogEntry, 'level'>> = {},
): Omit<StructuredLogEntry, 'level' | 'timestamp'> & { timestamp?: number } {
  return {
    component: 'test',
    action: 'test-action',
    result: 'success',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// StructuredLogger
// ══════════════════════════════════════════════════════════════════

describe('StructuredLogger', () => {
  let logger: StructuredLogger;

  beforeEach(() => {
    // Suppress console output during tests
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    logger = createLogger({ level: 'debug', console: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Level Filtering ─────────────────────────────────────────

  describe('level filtering', () => {
    it('emits entries at or above the configured level', () => {
      const warnLogger = createLogger({ level: 'warn', console: false });

      warnLogger.warn(makeEntry({ action: 'warning' }));
      warnLogger.error(makeEntry({ action: 'error' }));

      const entries = warnLogger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('warn');
      expect(entries[1].level).toBe('error');
    });

    it('filters entries below the configured level', () => {
      const warnLogger = createLogger({ level: 'warn', console: false });

      warnLogger.debug(makeEntry({ action: 'debug' }));
      warnLogger.info(makeEntry({ action: 'info' }));

      expect(warnLogger.getEntries()).toHaveLength(0);
    });

    it('emits all levels when configured as debug', () => {
      const debugLogger = createLogger({ level: 'debug', console: false });

      debugLogger.debug(makeEntry());
      debugLogger.info(makeEntry());
      debugLogger.warn(makeEntry());
      debugLogger.error(makeEntry());

      expect(debugLogger.getEntries()).toHaveLength(4);
    });

    it('emits only error when configured as error', () => {
      const errorLogger = createLogger({ level: 'error', console: false });

      errorLogger.debug(makeEntry());
      errorLogger.info(makeEntry());
      errorLogger.warn(makeEntry());
      errorLogger.error(makeEntry());

      const entries = errorLogger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
    });
  });

  // ── Timestamp Handling ──────────────────────────────────────

  describe('timestamp handling', () => {
    it('auto-fills timestamp if not provided', () => {
      const before = Date.now();
      logger.info(makeEntry());
      const after = Date.now();

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(entries[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('preserves a provided timestamp', () => {
      const customTs = 1700000000000;
      logger.info({ ...makeEntry(), timestamp: customTs });

      const entries = logger.getEntries();
      expect(entries[0].timestamp).toBe(customTs);
    });
  });

  // ── Buffer Management ───────────────────────────────────────

  describe('buffer management', () => {
    it('respects max buffer size by evicting oldest entries', () => {
      const smallLogger = createLogger({ level: 'debug', console: false }, 5);

      for (let i = 0; i < 8; i++) {
        smallLogger.info(makeEntry({ action: `action-${i}` }));
      }

      const entries = smallLogger.getEntries();
      expect(entries).toHaveLength(5);
      // Oldest entries (0, 1, 2) should be evicted
      expect(entries[0].action).toBe('action-3');
      expect(entries[4].action).toBe('action-7');
    });

    it('entryCount reflects buffer size', () => {
      logger.info(makeEntry());
      logger.warn(makeEntry());
      expect(logger.entryCount).toBe(2);
    });

    it('returns empty array when no entries', () => {
      expect(logger.getEntries()).toEqual([]);
      expect(logger.entryCount).toBe(0);
    });
  });

  // ── getEntries Filtering ────────────────────────────────────

  describe('getEntries filtering', () => {
    beforeEach(() => {
      logger.info(makeEntry({ component: 'provider', action: 'call', result: 'success', timestamp: 1000 }));
      logger.warn(makeEntry({ component: 'consensus', action: 'retry', result: 'failure', timestamp: 2000 }));
      logger.error(makeEntry({ component: 'provider', action: 'timeout', result: 'failure', timestamp: 3000 }));
      logger.info(makeEntry({ component: 'memory', action: 'search', result: 'success', timestamp: 4000 }));
    });

    it('filters by component', () => {
      const filtered = logger.getEntries({ component: 'provider' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.component === 'provider')).toBe(true);
    });

    it('filters by result', () => {
      const filtered = logger.getEntries({ result: 'failure' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.result === 'failure')).toBe(true);
    });

    it('filters by time range', () => {
      const filtered = logger.getEntries({ startTime: 1500, endTime: 3500 });
      expect(filtered).toHaveLength(2);
      expect(filtered[0].timestamp).toBe(2000);
      expect(filtered[1].timestamp).toBe(3000);
    });

    it('filters by level', () => {
      const filtered = logger.getEntries({ level: 'error' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].action).toBe('timeout');
    });

    it('combines multiple filters', () => {
      const filtered = logger.getEntries({ component: 'provider', result: 'failure' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].action).toBe('timeout');
    });

    it('returns all entries when no filter is provided', () => {
      expect(logger.getEntries()).toHaveLength(4);
    });
  });

  // ── Console Output ──────────────────────────────────────────

  describe('console output', () => {
    it('writes to console.info for info level', () => {
      logger.info(makeEntry());
      expect(console.info).toHaveBeenCalledTimes(1);
      const arg = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(() => JSON.parse(arg)).not.toThrow();
    });

    it('writes to console.error for error level', () => {
      logger.error(makeEntry());
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it('writes to console.warn for warn level', () => {
      logger.warn(makeEntry());
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('writes to console.debug for debug level', () => {
      logger.debug(makeEntry());
      expect(console.debug).toHaveBeenCalledTimes(1);
    });

    it('does not write to console when console is disabled', () => {
      const silentLogger = createLogger({ level: 'debug', console: false });
      silentLogger.info(makeEntry());
      expect(console.info).not.toHaveBeenCalled();
    });
  });

  // ── Stack Trace Handling ────────────────────────────────────

  describe('stack trace handling', () => {
    it('strips stack traces when includeStacks is false', () => {
      const noStackLogger = createLogger({ level: 'debug', console: false, includeStacks: false });

      noStackLogger.error(makeEntry({
        error: { code: 'ERR', message: 'fail', stack: 'Error\n  at foo.ts:1' },
      }));

      const entries = noStackLogger.getEntries();
      expect(entries[0].error).toBeDefined();
      expect(entries[0].error?.stack).toBeUndefined();
      expect(entries[0].error?.message).toBe('fail');
    });

    it('preserves stack traces when includeStacks is true', () => {
      const stackLogger = createLogger({ level: 'debug', console: false, includeStacks: true });

      stackLogger.error(makeEntry({
        error: { code: 'ERR', message: 'fail', stack: 'Error\n  at foo.ts:1' },
      }));

      const entries = stackLogger.getEntries();
      expect(entries[0].error?.stack).toBe('Error\n  at foo.ts:1');
    });
  });

  // ── Convenience Methods ─────────────────────────────────────

  describe('convenience methods', () => {
    it('logProviderResponse creates correct entry shape', () => {
      logger.logProviderResponse('participant-1', 250, { input: 100, output: 50, total: 150 }, 'success');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].component).toBe('provider');
      expect(entries[0].action).toBe('response');
      expect(entries[0].result).toBe('success');
      expect(entries[0].participantId).toBe('participant-1');
      expect(entries[0].latencyMs).toBe(250);
      expect(entries[0].tokenCount).toEqual({ input: 100, output: 50, total: 150 });
    });

    it('logConsensusTransition creates correct entry shape', () => {
      logger.logConsensusTransition('DISCUSSING', 'VOTING', 'VOTE_REQUESTED');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].component).toBe('consensus');
      expect(entries[0].action).toBe('transition');
      expect(entries[0].consensusState).toBe('VOTING');
      expect(entries[0].metadata).toEqual({ previousState: 'DISCUSSING', event: 'VOTE_REQUESTED' });
    });

    it('logExecution creates correct entry shape for success', () => {
      logger.logExecution('op-123', 'write-file', 'success', '/tmp/test.txt');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].component).toBe('execution');
      expect(entries[0].operationId).toBe('op-123');
      expect(entries[0].targetPath).toBe('/tmp/test.txt');
      expect(entries[0].level).toBe('info');
    });

    it('logExecution uses error level for failures', () => {
      logger.logExecution('op-456', 'delete-file', 'failure', '/tmp/nope.txt');

      const entries = logger.getEntries();
      expect(entries[0].level).toBe('error');
      expect(entries[0].result).toBe('failure');
    });

    it('logMemoryRetrieval creates correct entry shape', () => {
      logger.logMemoryRetrieval('search query', 5, 42);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].component).toBe('memory');
      expect(entries[0].action).toBe('retrieval');
      expect(entries[0].latencyMs).toBe(42);
      expect(entries[0].metadata).toEqual({ query: 'search query', resultCount: 5 });
    });
  });

  // ── Factory Function ────────────────────────────────────────

  describe('createLogger factory', () => {
    it('returns a StructuredLogger instance', () => {
      const instance = createLogger();
      expect(instance).toBeInstanceOf(StructuredLogger);
    });

    it('applies default config when no config provided', () => {
      const instance = createLogger();
      const config = instance.getConfig();
      expect(config.level).toBe('info');
      expect(config.console).toBe(true);
      expect(config.includeStacks).toBe(false);
    });

    it('merges partial config with defaults', () => {
      const instance = createLogger({ level: 'error' });
      const config = instance.getConfig();
      expect(config.level).toBe('error');
      expect(config.console).toBe(true); // default preserved
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// maskApiKeys
// ══════════════════════════════════════════════════════════════════

describe('maskApiKeys', () => {
  it('masks OpenAI-style keys (sk-...)', () => {
    const text = 'key is sk-abcdefghijklmnopqrstuvwxyz1234';
    const masked = maskApiKeys(text);
    expect(masked).not.toContain('sk-abcdefghij');
    expect(masked).toContain('MASKED');
  });

  it('masks Anthropic-style keys (sk-ant-...)', () => {
    const text = 'api_key=sk-ant-abcdef123456789012345678';
    const masked = maskApiKeys(text);
    expect(masked).not.toContain('sk-ant-abcdef');
    expect(masked).toContain('MASKED');
  });

  it('masks Google AI keys (AIza...)', () => {
    const text = 'google_key=AIzaSyB1234567890abcdefghij';
    const masked = maskApiKeys(text);
    expect(masked).not.toContain('AIzaSyB12345');
    expect(masked).toContain('MASKED');
  });

  it('returns text unchanged when no secrets present', () => {
    const text = 'just a normal log message with short tokens abc';
    expect(maskApiKeys(text)).toBe(text);
  });

  it('masks multiple keys in the same string', () => {
    const text = 'keys: sk-aaaaaaaaaaaaaaaaaaaaaaaaa and AIzaSyBbbbbbbbbbbbbbbbbbbbbbb';
    const masked = maskApiKeys(text);
    expect(masked).not.toContain('sk-aaa');
    expect(masked).not.toContain('AIzaSyBbbb');
  });
});

// ══════════════════════════════════════════════════════════════════
// LogExporter
// ══════════════════════════════════════════════════════════════════

describe('LogExporter', () => {
  let logger: StructuredLogger;
  let exporter: LogExporter;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    logger = createLogger({ level: 'debug', console: false });
    exporter = new LogExporter(logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── JSON Export ─────────────────────────────────────────────

  describe('exportAsJson', () => {
    it('exports entries as valid JSON array', () => {
      logger.info(makeEntry({ component: 'test', action: 'a1', timestamp: 1000 }));
      logger.warn(makeEntry({ component: 'test', action: 'a2', timestamp: 2000 }));

      const json = exporter.exportAsJson({ format: 'json' });
      const parsed = JSON.parse(json) as StructuredLogEntry[];

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].action).toBe('a1');
      expect(parsed[1].action).toBe('a2');
    });

    it('applies filters to JSON export', () => {
      logger.info(makeEntry({ component: 'provider', timestamp: 1000 }));
      logger.info(makeEntry({ component: 'memory', timestamp: 2000 }));

      const json = exporter.exportAsJson({ format: 'json', component: 'provider' });
      const parsed = JSON.parse(json) as StructuredLogEntry[];

      expect(parsed).toHaveLength(1);
      expect(parsed[0].component).toBe('provider');
    });

    it('masks secrets in JSON export when enabled', () => {
      logger.info(makeEntry({
        component: 'provider',
        metadata: { apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234' },
        timestamp: 1000,
      }));

      const json = exporter.exportAsJson({ format: 'json', maskSecrets: true });
      // The structured-logger already masks secrets at emit time using maskSecrets(),
      // so the API key is replaced with ***REDACTED*** before reaching the buffer.
      expect(json).not.toContain('sk-abcdefghij');
      expect(json).toContain('REDACTED');
    });

    it('produces valid empty JSON array when no entries', () => {
      const json = exporter.exportAsJson({ format: 'json' });
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  // ── Markdown Export ─────────────────────────────────────────

  describe('exportAsMarkdown', () => {
    it('includes header and summary sections', () => {
      logger.logProviderResponse('p1', 200, { input: 10, output: 20, total: 30 }, 'success');
      logger.logProviderResponse('p2', 400, { input: 30, output: 40, total: 70 }, 'failure');

      const md = exporter.exportAsMarkdown({ format: 'markdown' });

      expect(md).toContain('# Log Export');
      expect(md).toContain('**Time Range:**');
      expect(md).toContain('**Total Entries:** 2');
      expect(md).toContain('## Performance Summary');
      expect(md).toContain('Avg Latency');
      expect(md).toContain('300.0 ms'); // (200+400)/2
      expect(md).toContain('Total Tokens');
      expect(md).toContain('100'); // 30+70
      expect(md).toContain('Error Count');
      expect(md).toContain('1'); // one failure
    });

    it('groups entries by component in timeline', () => {
      logger.info(makeEntry({ component: 'provider', action: 'call', timestamp: 1000 }));
      logger.info(makeEntry({ component: 'consensus', action: 'vote', timestamp: 2000 }));
      logger.info(makeEntry({ component: 'provider', action: 'response', timestamp: 3000 }));

      const md = exporter.exportAsMarkdown({ format: 'markdown' });

      expect(md).toContain('### provider');
      expect(md).toContain('### consensus');
      // Provider entries should be grouped together
      const providerSection = md.split('### provider')[1].split('###')[0];
      expect(providerSection).toContain('call');
      expect(providerSection).toContain('response');
    });

    it('masks secrets in Markdown export when enabled', () => {
      logger.info(makeEntry({
        component: 'test',
        action: 'sk-abcdefghijklmnopqrstuvwxyz1234',
        timestamp: 1000,
      }));

      const md = exporter.exportAsMarkdown({ format: 'markdown', maskSecrets: true });
      expect(md).not.toContain('sk-abcdefghij');
      expect(md).toContain('MASKED');
    });

    it('produces valid output with no entries', () => {
      const md = exporter.exportAsMarkdown({ format: 'markdown' });
      expect(md).toContain('# Log Export');
      expect(md).toContain('No log entries found');
    });

    it('shows N/A for avg latency when no latency data', () => {
      logger.info(makeEntry({ component: 'test', timestamp: 1000 }));

      const md = exporter.exportAsMarkdown({ format: 'markdown' });
      expect(md).toContain('N/A');
    });

    it('applies result filter to Markdown export', () => {
      logger.info(makeEntry({ component: 'test', action: 'ok', result: 'success', timestamp: 1000 }));
      logger.error(makeEntry({ component: 'test', action: 'fail', result: 'failure', timestamp: 2000 }));

      const md = exporter.exportAsMarkdown({ format: 'markdown', result: 'failure' });
      expect(md).toContain('fail');
      expect(md).not.toContain(' ok ');
      expect(md).toContain('**Total Entries:** 1');
    });
  });
});
