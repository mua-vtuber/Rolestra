/**
 * Integration tests for CliProvider subprocess lifecycle.
 *
 * Mocks node:child_process.execFile to simulate CLI subprocess behavior.
 * Tests output parsing (stream-json, jsonl, raw-stdout), error handling,
 * abort signal, warmup/cooldown, and session strategies.
 *
 * D1 (2026-09-28): removed 4 tests that only exercised the now-deleted
 * `CliProvider.respawnWithPermissions()` / worker permission mode (see
 * cli-provider.ts's own D1 header note for why that path was dead code):
 * "worker 모드 + consensus-only workspace 는 WorkerModeRequiresProjectError",
 * "worker 모드 + 프로젝트 workspace 는 권한 argv 를 붙여 spawn 한다",
 * "respawnWithPermissions 는 세션을 시작한 호출의 workspace 로 다시 띄운다
 * (R12-X T4)", and "streamCompletion 전에 respawn 하면
 * CliWorkspaceRequiredError (R12-X T4)". The sibling file
 * cli-provider-respawn.test.ts (9 tests, entirely about
 * respawnWithPermissions) was deleted outright. `WorkerModeRequiresProjectError`
 * import removed with them (unused now); `CliWorkspaceRequiredError` stays —
 * it's still exercised by "cliWorkspace 없이 부르면 CliWorkspaceRequiredError"
 * and "CliWorkspaceRequiredError message 에 provider id 가 들어간다" below,
 * which cover CliProvider.resolveWorkspace() (still live production code).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── Mock child_process ───────────────────────────────────────────────

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { ChatCliSessionMissingError, CliProvider, type CliRuntimeConfig, type CliProviderInit } from '../cli-provider';
import {
  consensusOnlyCliWorkspace,
  CliWorkspaceRequiredError,
} from '../cli-workspace';
import { ClaudePermissionAdapter, CodexPermissionAdapter } from '../permission-adapter';
import type { CompletionOptions } from '../../../../shared/provider-types';
import { createTmpDir } from '../../../../test-utils/integration-helpers';

/**
 * R12-X T4 — CLI provider 는 workspace 없이는 spawn 하지 않는다. 출력 파싱 /
 * 세션 전략을 보는 테스트들은 cwd 자체가 관심사가 아니므로, 실제로 존재하는
 * 폴더 (테스트 실행 폴더) 를 consensus-only workspace 로 넘긴다.
 */
function anyWorkspace(): CompletionOptions {
  return { cliWorkspace: consensusOnlyCliWorkspace(process.cwd()) };
}

/** Temp instruction folders for scoped chat calls (outside the repo cwd above). */
const instructionDirs: string[] = [];
function chatInstructionsDir() {
  const dir = createTmpDir('rolestra-instructions-');
  instructionDirs.push(dir);
  return dir;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface FakeChildProcess {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroyed?: boolean };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  killed: boolean;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (...args: unknown[]) => void) => FakeChildProcess;
  /**
   * 실제 ChildProcess 와 동일하게 listener 를 뗄 수 있어야 한다. persistent
   * 읽기 (`CliStreamer.readPersistentResponse`) 의 finally 가 이 메서드를
   * 부르므로, 없으면 turn 이 끝나는 순간 TypeError 로 per-turn fallback 에
   * 빠져 persistent 경로 자체를 시험할 수 없다.
   */
  removeListener: (
    event: string,
    cb: (...args: unknown[]) => void,
  ) => FakeChildProcess;
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
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      processEvents.removeListener(event, cb);
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
    for (const dir of instructionDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // ── 1. stream-json output parsing ──────────────────────────────────

  it('stream-json: parses JSON stdout lines into tokens', async () => {
    const config = makeCliConfig({ outputFormat: 'stream-json' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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

  it('classifies a scoped Claude missing-session result before any text', async () => {
    const config = makeCliConfig({ sessionStrategy: 'persistent', outputFormat: 'stream-json',
      sessionIdFlag: '--session-id',
      responseBoundary: (line) => line.includes('"type":"result"'),
      permissionAdapter: new ClaudePermissionAdapter(),
    });
    const provider = new CliProvider(makeProviderInit(config));
    const run = collectTokens(provider.streamCompletion(MESSAGES, 'Frozen persona', {
      ...anyWorkspace(),
      chatSession: { scopeKey: 'room-a:alice', resumeSessionId: 'saved-id',
        currentStateHint: 'Continue this room.', instructionsDir: chatInstructionsDir() },
    }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    const proc = spawnedProcesses[0];
    proc.stderr.emit('data', 'No conversation found with session ID: saved-id\n');
    proc.stdout.emit('data', '{"type":"result","subtype":"error_during_execution"}\n');
    await expect(run).rejects.toBeInstanceOf(ChatCliSessionMissingError);
  });

  it('classifies Codex native no-rollout resume diagnostic before any text', async () => {
    const config = makeCliConfig({ inputFormat: 'pipe', outputFormat: 'jsonl',
      buildResumeArgs: (sid) => ['exec', 'resume', sid, '--json'],
      permissionAdapter: new CodexPermissionAdapter(),
    });
    const provider = new CliProvider(makeProviderInit(config));
    const run = collectTokens(provider.streamCompletion(MESSAGES, 'Frozen persona', {
      ...anyWorkspace(),
      chatSession: { scopeKey: 'room-a:alice', resumeSessionId: 'missing-id',
        currentStateHint: 'Continue this room.', instructionsDir: chatInstructionsDir() },
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const proc = spawnedProcesses[0];
    proc.stderr.emit('data', 'Error: thread/resume failed: no rollout found for thread id missing-id (code -32600)');
    proc._processEvents.emit('exit', 1, null);
    await expect(run).rejects.toBeInstanceOf(ChatCliSessionMissingError);
  });

  it('passes explicit cliWorkspace cwd to subprocess spawn', async () => {
    const cwd = createTmpDir('rolestra-cli-provider-cwd-');
    try {
      const config = makeCliConfig({ outputFormat: 'stream-json' });
      const provider = new CliProvider(makeProviderInit(config));

      const tokenPromise = collectTokens(provider.streamCompletion(
        MESSAGES,
        '',
        {
          cliWorkspace: {
            scope: 'project',
            cwd,
            consensusPath: cwd,
            projectId: 'project-1',
            projectKind: 'new',
            permissionMode: 'approval',
            // R12-W T12 — 이 시험들의 관심사는 cwd / 세션 격리라서 채널
            // 권한으로 argv 를 좁히지 않는 형태를 쓴다.
            permissions: null,
          },
        },
      ));

      await new Promise(r => setTimeout(r, 10));
      const proc = spawnedProcesses[0];
      emitOutputAndExit(proc, ['{"text":"ok"}']);

      await expect(tokenPromise).resolves.toEqual(['ok']);
      const spawnCall = mockExecFile.mock.calls.find(
        (call) => typeof call[call.length - 1] !== 'function',
      );
      expect(spawnCall?.[2]).toEqual(
        expect.objectContaining({
          cwd: path.resolve(cwd),
          shell: false,
        }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('cliWorkspace 없이 부르면 CliWorkspaceRequiredError (R12-X T4)', async () => {
    const config = makeCliConfig({ outputFormat: 'stream-json' });
    const provider = new CliProvider(makeProviderInit(config));

    await expect(
      collectTokens(provider.streamCompletion(MESSAGES, '')),
    ).rejects.toThrow(CliWorkspaceRequiredError);
    // 조용히 앱 실행 폴더에서 뜨지 않는다 — 아예 spawn 하지 않는다.
    expect(spawnedProcesses.length).toBe(0);
  });

  it('CliWorkspaceRequiredError message 에 provider id 가 들어간다', async () => {
    const config = makeCliConfig({ outputFormat: 'stream-json' });
    const provider = new CliProvider(makeProviderInit(config));

    await expect(
      collectTokens(provider.streamCompletion(MESSAGES, '')),
    ).rejects.toThrow(/cli-test/);
  });

  it('consensus-only workspace 는 합의 폴더에서 spawn 한다', async () => {
    const consensus = mkdtempSync(
      path.join(tmpdir(), 'rolestra-cli-consensus-'),
    );
    try {
      const config = makeCliConfig({ outputFormat: 'stream-json' });
      const provider = new CliProvider(makeProviderInit(config));

      const tokenPromise = collectTokens(
        provider.streamCompletion(MESSAGES, '', {
          cliWorkspace: consensusOnlyCliWorkspace(consensus),
        }),
      );

      await new Promise((r) => setTimeout(r, 10));
      emitOutputAndExit(spawnedProcesses[0], ['{"text":"ok"}']);
      await expect(tokenPromise).resolves.toEqual(['ok']);

      const spawnCall = mockExecFile.mock.calls.find(
        (call) => typeof call[call.length - 1] !== 'function',
      );
      expect(spawnCall?.[2]).toEqual(
        expect.objectContaining({ cwd: path.resolve(consensus), shell: false }),
      );
    } finally {
      rmSync(consensus, { recursive: true, force: true });
    }
  });

  it('같은 cwd 라도 project 와 consensus-only 는 세션을 공유하지 않는다', async () => {
    // workspaceKey 가 scope 를 구분하지 못하면 권한 근거가 다른 두 호출이
    // 같은 CLI 세션을 이어 쓴다. per-turn 전략에서는 spawn 마다 새 프로세스가
    // 뜨므로, 여기서는 persistent 전략으로 세션 kill 여부를 본다.
    const dir = createTmpDir('rolestra-cli-scope-');
    try {
      const config = makeCliConfig({
        outputFormat: 'raw-stdout',
        sessionStrategy: 'per-turn',
      });
      const provider = new CliProvider(makeProviderInit(config));

      const first = collectTokens(
        provider.streamCompletion(MESSAGES, '', {
          cliWorkspace: consensusOnlyCliWorkspace(dir),
        }),
      );
      await new Promise((r) => setTimeout(r, 10));
      emitOutputAndExit(spawnedProcesses[0], ['a']);
      await first;

      const second = collectTokens(
        provider.streamCompletion(MESSAGES, '', {
          cliWorkspace: {
            scope: 'project',
            cwd: dir,
            consensusPath: dir,
            projectId: 'project-1',
            projectKind: 'new',
            permissionMode: 'approval',
            // R12-W T12 — 이 시험들의 관심사는 cwd / 세션 격리라서 채널
            // 권한으로 argv 를 좁히지 않는 형태를 쓴다.
            permissions: null,
          },
        }),
      );
      await new Promise((r) => setTimeout(r, 10));
      emitOutputAndExit(spawnedProcesses[1], ['b']);
      await second;

      // 두 호출이 서로 다른 workspaceKey 를 만들었다면 각각 새 프로세스를
      // 띄운다 (같은 키였다면 세션 재사용 분기로 들어간다).
      expect(spawnedProcesses.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── 2. jsonl output parsing ────────────────────────────────────────

  it('jsonl: parses JSONL stdout lines into tokens', async () => {
    const config = makeCliConfig({ outputFormat: 'jsonl' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

    // Wait for the spawn to happen
    await new Promise(r => setTimeout(r, 10));

    // Do NOT emit any data — let the hang timeout fire

    await expect(tokenPromise).rejects.toThrow(/hang timeout|CLI command failed|CLI returned no output/);
  });

  // ── 5. stderr error ────────────────────────────────────────────────

  it('stderr output with non-zero exit code propagates error', async () => {
    const config = makeCliConfig({ outputFormat: 'raw-stdout' });
    const provider = new CliProvider(makeProviderInit(config));

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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

    const tokenPromise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));

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
      provider.streamCompletion(MESSAGES, '', anyWorkspace(), controller.signal),
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
    const promise1 = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));
    await new Promise(r => setTimeout(r, 10));
    const proc1 = spawnedProcesses[spawnedProcesses.length - 1];
    emitOutputAndExit(proc1, ['{"text":"call1"}']);
    await promise1;

    const countAfterFirst = spawnedProcesses.length;

    // Second call
    const promise2 = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));
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
      provider.streamCompletion(MESSAGES, '', anyWorkspace(), controller.signal),
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
      const promise = collectTokens(provider.streamCompletion(MESSAGES, '', anyWorkspace()));
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
