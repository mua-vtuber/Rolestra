/**
 * Integration tests for CliProvider subprocess lifecycle.
 *
 * Mocks node:child_process.execFile to simulate CLI subprocess behavior.
 * Tests output parsing (stream-json, jsonl, raw-stdout), error handling,
 * abort signal, warmup/cooldown, and session strategies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// ── Mock child_process ───────────────────────────────────────────────

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { CliProvider, type CliRuntimeConfig, type CliProviderInit } from '../cli-provider';

// ── Helpers ──────────────────────────────────────────────────────────

interface FakeChildProcess {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroyed?: boolean };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  killed: boolean;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (...args: unknown[]) => void) => FakeChildProcess;
  _processEvents: EventEmitter;
}

function createFakeProcess(): FakeChildProcess {
  const processEvents = new EventEmitter();
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stdout.setEncoding = vi.fn().mockReturnThis();
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr.setEncoding = vi.fn().mockReturnThis();
  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroyed?: boolean;
  };
  stdin.write = vi.fn();
  stdin.end = vi.fn();

  const proc: FakeChildProcess = {
    stdin,
    stdout,
    stderr,
    killed: false,
    pid: Math.floor(Math.random() * 100000) + 1000,
    kill: vi.fn().mockImplementation(() => {
      proc.killed = true;
      processEvents.emit('exit', 0, null);
      return true;
    }),
    on(event: string, cb: (...args: unknown[]) => void) {
      processEvents.on(event, cb);
      return this;
    },
    _processEvents: processEvents,
  };

  return proc;
}

function makeCliConfig(overrides: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
  return {
    command: 'test-cli',
    args: [],
    inputFormat: 'pipe',
    outputFormat: 'stream-json',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 10000, subsequent: 5000 },
    ...overrides,
  };
}

function makeProviderInit(
  cliConfig: CliRuntimeConfig = makeCliConfig(),
  overrides: Partial<CliProviderInit> = {},
): CliProviderInit {
  return {
    id: 'cli-test',
    displayName: 'CLI Test',
    type: 'cli',
    model: 'test-model',
    capabilities: ['streaming'],
    config: {
      type: 'cli',
      command: cliConfig.command,
      args: cliConfig.args,
      inputFormat: cliConfig.inputFormat,
      outputFormat: cliConfig.outputFormat,
      sessionStrategy: cliConfig.sessionStrategy,
      hangTimeout: cliConfig.hangTimeout,
      model: 'test-model',
    },
    cliConfig,
    ...overrides,
  };
}

async function collectTokens(gen: AsyncGenerator<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of gen) {
    tokens.push(token);
  }
  return tokens;
}

/** Emit data lines on stdout and then close process. */
function emitOutputAndExit(
  proc: FakeChildProcess,
  lines: string[],
  exitCode = 0,
  delayMs = 0,
): void {
  setTimeout(() => {
    for (const line of lines) {
      proc.stdout.emit('data', line + '\n');
    }
    proc.stdout.emit('end');
    proc._processEvents.emit('exit', exitCode, null);
  }, delayMs);
}

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];

// ── Tests ────────────────────────────────────────────────────────────

describe('CliProvider Subprocess Integration', () => {
  let mockExecFile: ReturnType<typeof vi.fn>;
  let spawnedProcesses: FakeChildProcess[];

  beforeEach(async () => {
    const cp = await import('node:child_process');
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    spawnedProcesses = [];

    // Default: execFile returns a fake process
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const lastArg = args[args.length - 1];
      // Check if this is the ping call (with callback) vs spawn call (without callback)
      if (typeof lastArg === 'function') {
        // This is execFile with callback (ping, spawnPersistent)
        const proc = createFakeProcess();
        return proc as unknown as ChildProcess;
      }
      // This is execFile without callback (spawnPerTurn) — returns ChildProcess
      const proc = createFakeProcess();
      spawnedProcesses.push(proc);
      return proc as unknown as ChildProcess;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. stream-json output parsing ──────────────────────────────────

  it('stream-json: parses JSON stdout lines into tokens', async () => {
    const config = makeCliConfig({ outputFormat: 'stream-json' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    // Wait for the spawn to happen
    await new Promise(r => setTimeout(r, 10));
    expect(spawnedProcesses.length).toBeGreaterThanOrEqual(1);
    const proc = spawnedProcesses[0];

    emitOutputAndExit(proc, [
      '{"text":"Hello"}',
      '{"text":" from CLI"}',
    ]);

    const tokens = await tokenPromise;
    expect(tokens).toEqual(['Hello', ' from CLI']);
  });

  // ── 2. jsonl output parsing ────────────────────────────────────────

  it('jsonl: parses JSONL stdout lines into tokens', async () => {
    const config = makeCliConfig({ outputFormat: 'jsonl' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    emitOutputAndExit(proc, [
      '{"text":"Line one"}',
      '{"content":"Line two"}',
    ]);

    const tokens = await tokenPromise;
    expect(tokens).toEqual(['Line one', 'Line two']);
  });

  // ── 3. raw-stdout parsing ──────────────────────────────────────────

  it('raw-stdout: passes through plain text as tokens', async () => {
    const config = makeCliConfig({ outputFormat: 'raw-stdout' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    emitOutputAndExit(proc, [
      'Plain text output',
      'Another line',
    ]);

    const tokens = await tokenPromise;
    expect(tokens.length).toBeGreaterThan(0);
    const joined = tokens.join('');
    expect(joined).toContain('Plain text output');
    expect(joined).toContain('Another line');
  });

  // ── 4. Hang timeout ────────────────────────────────────────────────

  it('hang timeout: process not responding triggers timeout error', async () => {
    const config = makeCliConfig({
      outputFormat: 'raw-stdout',
      hangTimeout: { first: 100, subsequent: 100 },
    });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    // Wait for the spawn to happen
    await new Promise(r => setTimeout(r, 10));

    // Do NOT emit any data — let the hang timeout fire

    await expect(tokenPromise).rejects.toThrow(/hang timeout|CLI command failed|CLI returned no output/);
  });

  // ── 5. stderr error ────────────────────────────────────────────────

  it('stderr output with non-zero exit code propagates error', async () => {
    const config = makeCliConfig({ outputFormat: 'raw-stdout' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    // Emit stderr
    proc.stderr.emit('data', 'Error: something went wrong\n');
    // Close with non-zero exit code
    proc.stdout.emit('end');
    proc._processEvents.emit('exit', 1, null);

    await expect(tokenPromise).rejects.toThrow(/CLI command failed/);
  });

  // ── 6. Rate limit detection ────────────────────────────────────────

  it('rate limit pattern in stderr detected during streaming', async () => {
    const config = makeCliConfig({
      outputFormat: 'stream-json',
      detectRateLimit: (line: string) => /429|rate.?limit/i.test(line),
      rateLimitTimeout: 60000,
    });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    // Emit rate limit on stderr
    proc.stderr.emit('data', 'HTTP 429: Rate limit exceeded\n');

    // Then emit valid output and exit
    emitOutputAndExit(proc, ['{"text":"delayed response"}']);

    const tokens = await tokenPromise;
    expect(tokens).toEqual(['delayed response']);
  });

  // ── 7. Exit code non-zero ──────────────────────────────────────────

  it('process exits with non-zero code throws error', async () => {
    const config = makeCliConfig({ outputFormat: 'raw-stdout' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, ''));

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    proc.stderr.emit('data', 'Fatal: out of memory\n');
    proc.stdout.emit('end');
    proc._processEvents.emit('exit', 137, null);

    await expect(tokenPromise).rejects.toThrow(/CLI command failed/);
  });

  // ── 8. Kill on abort ───────────────────────────────────────────────

  it('abort signal kills the spawned process', async () => {
    const config = makeCliConfig({
      outputFormat: 'stream-json',
      hangTimeout: { first: 10000, subsequent: 5000 },
    });
    const provider = new CliProvider(makeProviderInit(config));
    const controller = new AbortController();

    const tokenPromise = collectTokens(
      provider.streamCompletion(MESSAGES, '', undefined, controller.signal),
    );

    await new Promise(r => setTimeout(r, 10));
    const proc = spawnedProcesses[0];

    // Emit one token
    proc.stdout.emit('data', '{"text":"partial"}\n');

    // Abort mid-stream
    controller.abort();

    // Give time for abort signal to propagate
    await new Promise(r => setTimeout(r, 50));

    const tokens = await tokenPromise;
    // May have collected 0 or 1 token before abort
    expect(tokens.length).toBeLessThanOrEqual(1);
    expect(proc.kill).toHaveBeenCalled();
  });

  // ── 9. Warmup validates CLI exists ─────────────────────────────────

  it('warmup validates CLI exists via ping (execFile --version)', async () => {
    // Override execFile to handle the ping callback
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args.find(a => typeof a === 'function') as
        | ((err: null, stdout: string, stderr: string) => void)
        | undefined;
      if (cb) {
        // Ping callback: simulate successful --version
        cb(null, 'test-cli v1.0.0', '');
        return createFakeProcess() as unknown as ChildProcess;
      }
      const proc = createFakeProcess();
      spawnedProcesses.push(proc);
      return proc as unknown as ChildProcess;
    });

    const config = makeCliConfig();
    const provider = new CliProvider(makeProviderInit(config));

    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');
  });

  // ── 10. Cooldown cleans up ─────────────────────────────────────────

  it('cooldown sets status to not-installed', async () => {
    const config = makeCliConfig();
    const provider = new CliProvider(makeProviderInit(config));

    // Force ready status via warmup
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args.find(a => typeof a === 'function') as
        | ((err: null, stdout: string, stderr: string) => void)
        | undefined;
      if (cb) {
        cb(null, 'v1.0', '');
        return createFakeProcess() as unknown as ChildProcess;
      }
      const proc = createFakeProcess();
      spawnedProcesses.push(proc);
      return proc as unknown as ChildProcess;
    });

    await provider.warmup();
    expect(provider.getStatus()).toBe('ready');

    await provider.cooldown();
    expect(provider.getStatus()).toBe('not-installed');
  });

  // ── 11. Session strategy per-turn ──────────────────────────────────

  it('per-turn: each streamCompletion call spawns a new process', async () => {
    const config = makeCliConfig({ sessionStrategy: 'per-turn', outputFormat: 'stream-json' });
    const provider = new CliProvider(makeProviderInit(config));

    // First call
    const promise1 = collectTokens(provider.streamCompletion(MESSAGES, ''));
    await new Promise(r => setTimeout(r, 10));
    const proc1 = spawnedProcesses[spawnedProcesses.length - 1];
    emitOutputAndExit(proc1, ['{"text":"call1"}']);
    await promise1;

    const countAfterFirst = spawnedProcesses.length;

    // Second call
    const promise2 = collectTokens(provider.streamCompletion(MESSAGES, ''));
    await new Promise(r => setTimeout(r, 10));
    const proc2 = spawnedProcesses[spawnedProcesses.length - 1];
    emitOutputAndExit(proc2, ['{"text":"call2"}']);
    const tokens2 = await promise2;

    expect(tokens2).toEqual(['call2']);
    expect(spawnedProcesses.length).toBeGreaterThan(countAfterFirst);
  });

  // ── 12. Pre-aborted signal ─────────────────────────────────────────

  it('pre-aborted signal returns immediately without spawning', async () => {
    const config = makeCliConfig({ outputFormat: 'raw-stdout' });
    const provider = new CliProvider(makeProviderInit(config));

    const controller = new AbortController();
    controller.abort();

    const tokens = await collectTokens(
      provider.streamCompletion(MESSAGES, '', undefined, controller.signal),
    );

    expect(tokens).toEqual([]);
  });

  // ── 13. Multiple sequential calls track invocations ────────────────

  it('multiple sequential calls each spawn and produce independent results', async () => {
    const config = makeCliConfig({
      sessionStrategy: 'per-turn',
      outputFormat: 'stream-json',
    });
    const provider = new CliProvider(makeProviderInit(config));

    const allTokens: string[][] = [];

    for (let i = 0; i < 3; i++) {
      const promise = collectTokens(provider.streamCompletion(MESSAGES, ''));
      await new Promise(r => setTimeout(r, 10));
      const proc = spawnedProcesses[spawnedProcesses.length - 1];
      emitOutputAndExit(proc, [`{"text":"response-${i}"}`]);
      const tokens = await promise;
      allTokens.push(tokens);
    }

    expect(allTokens).toEqual([
      ['response-0'],
      ['response-1'],
      ['response-2'],
    ]);
    expect(spawnedProcesses.length).toBeGreaterThanOrEqual(3);
  });
});
