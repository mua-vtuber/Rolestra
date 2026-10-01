import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { StructuredLogEntry } from '../../../shared/log-types';
import { StructuredLogger, createLogger } from '../structured-logger';

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

  // ── File output (A2) ────────────────────────────────────────
  describe('file output', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-logger-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes JSON lines to the configured file path', () => {
      const filePath = path.join(tmpDir, 'rolestra.log');
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB: 10, maxFiles: 5 } });

      fileLogger.info(makeEntry({ action: 'first' }));
      fileLogger.info(makeEntry({ action: 'second' }));

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).action).toBe('first');
      expect(JSON.parse(lines[1]!).action).toBe('second');
    });

    it('masks secrets in file output the same way as the buffer', () => {
      const filePath = path.join(tmpDir, 'rolestra.log');
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB: 10, maxFiles: 5 } });

      fileLogger.error(makeEntry({
        error: { code: 'ERR', message: 'failed with key sk-ant-abcdefghijklmnopqrstuvwx' },
      }));

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
      expect(content).toContain('***REDACTED***');
    });

    it('creates the log directory when it does not exist yet', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'logs');
      const filePath = path.join(nestedDir, 'rolestra.log');
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB: 10, maxFiles: 5 } });

      fileLogger.info(makeEntry());

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('rotates the log file once the size cap is exceeded, keeping at most maxFiles generations', () => {
      const filePath = path.join(tmpDir, 'rolestra.log');
      // A tiny cap (in bytes, expressed as a fractional MB) forces rotation
      // on nearly every write so the test does not need megabytes of fixture data.
      const maxSizeMB = 200 / (1024 * 1024);
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB, maxFiles: 3 } });

      for (let i = 0; i < 10; i += 1) {
        fileLogger.info(makeEntry({ action: `action-${i}`, metadata: { padding: 'x'.repeat(80) } }));
      }

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rolestra.1.log'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rolestra.2.log'))).toBe(true);
      // maxFiles=3 means generations 0,1,2 only — no 4th generation should exist.
      expect(fs.existsSync(path.join(tmpDir, 'rolestra.3.log'))).toBe(false);
    });

    it('seeds the byte counter from the existing file size at construction (a single stat, not per write)', () => {
      const filePath = path.join(tmpDir, 'rolestra.log');
      const maxSizeMB = 100 / (1024 * 1024);
      // Pre-seed the file near the cap so the very first write on a FRESH
      // logger instance must already rotate — this only works if the
      // constructor seeded fileBytesWritten from a real stat().
      fs.writeFileSync(filePath, 'x'.repeat(90));
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB, maxFiles: 2 } });

      fileLogger.info(makeEntry({ metadata: { padding: 'y'.repeat(50) } }));

      expect(fs.existsSync(path.join(tmpDir, 'rolestra.1.log'))).toBe(true);
      const rotated = fs.readFileSync(path.join(tmpDir, 'rolestra.1.log'), 'utf-8');
      expect(rotated).toBe('x'.repeat(90));
    });

    it('reports a file write failure to the console exactly once', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // The log file's directory exists (so ensureFileDirectory/fileReady
      // succeeds at construction), but the "file" path is itself a
      // directory — every appendFileSync against it fails with EISDIR,
      // exercising the write-time failure path (not the mkdir-time one).
      const filePath = path.join(tmpDir, 'rolestra.log');
      fs.mkdirSync(filePath);
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB: 10, maxFiles: 5 } });

      fileLogger.info(makeEntry({ action: 'one' }));
      fileLogger.info(makeEntry({ action: 'two' }));
      fileLogger.info(makeEntry({ action: 'three' }));

      const fileErrorCalls = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('[structured-logger] file write failed'),
      );
      expect(fileErrorCalls).toHaveLength(1);
      expect(fileErrorCalls[0]?.[0]).toContain(filePath);
      errorSpy.mockRestore();
    });

    // ── Review follow-up #2a: rotation failure must not stop logging ────
    it('keeps appending to the current file when rotation itself fails, reporting the failure exactly once', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const filePath = path.join(tmpDir, 'rolestra.log');
      const maxSizeMB = 200 / (1024 * 1024);
      const fileLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB, maxFiles: 3 } });

      // Make the rotation target a NON-EMPTY directory instead of a regular
      // file, so `renameSync(rolestra.log, rolestra.1.log)` throws (Windows:
      // EPERM: this simulates the file being locked by another process,
      // e.g. an editor, without actually needing a second process).
      const rotationTarget = path.join(tmpDir, 'rolestra.1.log');
      fs.mkdirSync(rotationTarget);
      fs.writeFileSync(path.join(rotationTarget, 'blocker.txt'), 'x');

      // Every one of these writes would otherwise trigger rotation (each
      // padded entry alone exceeds maxSizeMB) — if a rotation failure ever
      // stopped writes, later entries would be missing from the file.
      for (let i = 0; i < 5; i += 1) {
        fileLogger.info(makeEntry({ action: `action-${i}`, metadata: { padding: 'x'.repeat(80) } }));
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);
      // All 5 entries must have been appended despite rotation never
      // succeeding — logging keeps working, just without rotation.
      expect(lines).toHaveLength(5);
      expect(lines.map((line) => (JSON.parse(line) as { action: string }).action))
        .toEqual(['action-0', 'action-1', 'action-2', 'action-3', 'action-4']);

      const rotationErrorCalls = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('[structured-logger] log rotation failed'),
      );
      // Reported exactly once even though every single write above hit the
      // same rotation failure — not retried (and re-reported) per line.
      expect(rotationErrorCalls).toHaveLength(1);
      expect(rotationErrorCalls[0]?.[0]).toContain(filePath);
      errorSpy.mockRestore();
    });

    // ── Review follow-up #2b: mkdir failure must be reported once ───────
    it('reports a log-directory creation failure to the console exactly once', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Put a regular FILE where the log directory needs to be — mkdirSync
      // with { recursive: true } fails against an existing non-directory
      // path component (Windows: EEXIST; POSIX: ENOTDIR).
      const blockerPath = path.join(tmpDir, 'logs-blocker');
      fs.writeFileSync(blockerPath, '');
      const filePath = path.join(blockerPath, 'nested', 'rolestra.log');

      // Two separate logger instances hitting the same failure — each
      // instance reports once (the "once" guard is per-instance state),
      // and neither logger crashes or throws on construction or on a
      // subsequent write attempt (file logging is simply disabled).
      const firstLogger = createLogger({ console: false, file: { path: filePath, maxSizeMB: 10, maxFiles: 5 } });
      firstLogger.info(makeEntry({ action: 'one' }));
      firstLogger.info(makeEntry({ action: 'two' }));

      const directoryErrorCalls = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('[structured-logger] log directory unavailable'),
      );
      expect(directoryErrorCalls).toHaveLength(1);
      expect(directoryErrorCalls[0]?.[0]).toContain(blockerPath);
      expect(fs.existsSync(filePath)).toBe(false);
      errorSpy.mockRestore();
    });
  });
});
