import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliProcessManager } from '../cli-process';
import { buildCmdCommandLine } from '../windows-command';
import {
  asAbsolutePath,
  unsafeMarkAbsolute,
  type AbsolutePath,
} from '../../../../shared/absolute-path';

// ---------------------------------------------------------------------------
// Mock child_process.execFile for ping tests
// ---------------------------------------------------------------------------

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

// resolveWindowsCommand itself is covered in `windows-command.test.ts`; here we
// only assert that CliProcessManager routes its spawns through it.

// ===========================================================================
// CliProcessManager Windows resolution wiring
// ===========================================================================

describe('CliProcessManager Windows resolution wiring', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('per-turn spawn goes through resolveWindowsCommand (cmd.exe on Windows)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const cp = await import('node:child_process');
    const mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    mockExecFile.mockReturnValue({ on: vi.fn() });

    const manager = new CliProcessManager();
    const cwd = asAbsolutePath(
      mkdtempSync(path.join(tmpdir(), 'rolestra-cli-wire-')),
      'test.cwd',
    );
    try {
      manager.spawnPerTurn(
        {
          command: 'claude.cmd',
          args: [],
          inputFormat: 'pipe',
          outputFormat: 'raw-stdout',
          sessionStrategy: 'per-turn',
          hangTimeout: { first: 1000, subsequent: 1000 },
          cwd,
        },
        ['--add-dir', 'C:\\some dir'],
      );

      expect(mockExecFile).toHaveBeenCalledWith(
        'cmd.exe',
        [buildCmdCommandLine('claude.cmd', ['--add-dir', 'C:\\some dir'])],
        // The verbatim flag must travel with the pre-built command line; if it
        // is dropped, libuv quotes the line a second time and F01 returns.
        expect.objectContaining({ shell: false, windowsVerbatimArguments: true }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// CliProcessManager.kill
// ===========================================================================

describe('CliProcessManager.kill', () => {
  let manager: CliProcessManager;

  beforeEach(() => {
    manager = new CliProcessManager();
  });

  it('sends SIGTERM to a live process', () => {
    const proc = {
      killed: false,
      kill: vi.fn(),
      on: vi.fn((_event: string, cb: () => void) => {
        // Simulate immediate exit
        cb();
      }),
    };
    manager.process = proc as any;

    manager.kill();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('sets up SIGKILL timer after SIGTERM', () => {
    vi.useFakeTimers();

    const exitCallbacks: Array<() => void> = [];
    const proc = {
      killed: false,
      kill: vi.fn(),
      on: vi.fn((_event: string, cb: () => void) => {
        exitCallbacks.push(cb);
      }),
    };
    manager.process = proc as any;

    manager.kill();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');

    // Advance time but don't trigger exit
    vi.advanceTimersByTime(3000);

    // SIGKILL should be attempted (but proc.killed is still false from our mock)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    vi.useRealTimers();
  });

  it('cancels SIGKILL timer when process exits promptly', () => {
    vi.useFakeTimers();

    let exitCallback: (() => void) | null = null;
    const proc = {
      killed: false,
      kill: vi.fn(),
      on: vi.fn((_event: string, cb: () => void) => {
        exitCallback = cb;
      }),
    };
    manager.process = proc as any;

    manager.kill();

    // Simulate process exit before SIGKILL timer
    exitCallback!();

    // Advance past the force-kill timer
    vi.advanceTimersByTime(5000);

    // Should only have SIGTERM, not SIGKILL
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    vi.useRealTimers();
  });

  it('does nothing when no process is assigned', () => {
    // manager.process is null by default — should not throw
    expect(() => manager.kill()).not.toThrow();
  });

  it('does nothing for already killed process', () => {
    const proc = {
      killed: true,
      kill: vi.fn(),
      on: vi.fn(),
    };
    manager.process = proc as any;

    manager.kill();

    expect(proc.kill).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CliProcessManager.ping
// ===========================================================================

describe('CliProcessManager.ping', () => {
  let manager: CliProcessManager;
  let mockExecFile: ReturnType<typeof vi.fn>;

  function makeConfig(overrides: Partial<import('../cli-provider').CliRuntimeConfig> = {}): import('../cli-provider').CliRuntimeConfig {
    return {
      command: 'claude',
      args: [],
      inputFormat: 'stdin-json',
      outputFormat: 'stream-json',
      sessionStrategy: 'persistent',
      hangTimeout: { first: 30000, subsequent: 15000 },
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    const cp = await import('node:child_process');
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    manager = new CliProcessManager();
  });

  it('resolves true on successful exit', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, 'v1.0.0', '');
      },
    );

    const result = await manager.ping(makeConfig({ command: 'claude' }));
    expect(result).toBe(true);
  });

  it('resolves false on ENOENT (command not found)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        const err = Object.assign(new Error('spawn ENOENT'), {
          code: 'ENOENT',
          killed: false,
          signal: null,
        });
        cb(err);
      },
    );

    const result = await manager.ping(makeConfig({ command: 'nonexistent-command' }));
    expect(result).toBe(false);
  });

  it('resolves false on EACCES (permission denied)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        const err = Object.assign(new Error('permission denied'), {
          code: 'EACCES',
          killed: false,
          signal: null,
        });
        cb(err);
      },
    );

    const result = await manager.ping(makeConfig({ command: 'protected-command' }));
    expect(result).toBe(false);
  });

  it('resolves false when process is killed (timeout)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        const err = Object.assign(new Error('process killed'), {
          killed: true,
          signal: 'SIGTERM' as const,
        });
        cb(err);
      },
    );

    const result = await manager.ping(makeConfig({ command: 'slow-command' }));
    expect(result).toBe(false);
  });

  it('resolves false on a non-zero exit code', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        const err = Object.assign(new Error('exit code 1'), {
          code: 1,
          killed: false,
          signal: null,
        });
        cb(err);
      },
    );

    const result = await manager.ping(makeConfig({ command: 'quirky-cli' }));
    expect(result).toBe(false);
  });
});

// QA Medium-1: the same probe, naming why it failed.
describe('CliProcessManager.check', () => {
  let manager: CliProcessManager;
  let mockExecFile: ReturnType<typeof vi.fn>;
  const config = {
    command: 'claude', args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
    sessionStrategy: 'persistent', hangTimeout: { first: 30000, subsequent: 15000 },
  } as import('../cli-provider').CliRuntimeConfig;

  function failWith(fields: Record<string, unknown>): void {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(Object.assign(new Error('failed'), { killed: false, signal: null, ...fields }));
      },
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    const cp = await import('node:child_process');
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    manager = new CliProcessManager();
  });

  it('reports a non-zero exit rather than treating a failed wrapper as a working CLI', async () => {
    failWith({ code: 1 });
    expect(await manager.check(config)).toEqual({ code: 'cli-failed', detail: 'exit=1' });
  });

  it('reports signal termination and unclassified execution failures', async () => {
    failWith({ signal: 'SIGTERM' });
    expect(await manager.check(config)).toEqual({ code: 'cli-failed', detail: 'signal=SIGTERM' });
    failWith({});
    expect(await manager.check(config)).toEqual({ code: 'cli-failed', detail: null });
  });

  it.runIf(process.platform === 'win32')('rejects a missing Windows command through the real cmd.exe wrapper', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    mockExecFile.mockImplementation(actual.execFile);

    const failure = await manager.check({ ...config, command: 'rolestra-missing-cli-935812' });

    expect(mockExecFile).toHaveBeenCalledWith('cmd.exe', expect.any(Array), expect.any(Object), expect.any(Function));
    expect(failure).toEqual({ code: 'cli-failed', detail: 'exit=1' });
  });

  it('says the command was not found, could not run, or timed out', async () => {
    failWith({ code: 'ENOENT' });
    expect(await manager.check(config)).toEqual({ code: 'cli-not-found', detail: 'ENOENT' });
    failWith({ code: 'EACCES' });
    expect(await manager.check(config)).toEqual({ code: 'cli-failed', detail: 'EACCES' });
    failWith({ killed: true, signal: 'SIGTERM' });
    expect(await manager.check(config)).toEqual({ code: 'timeout', detail: null });
  });
});

// ===========================================================================
// CliProcessManager cwd enforcement
// ===========================================================================

describe('CliProcessManager cwd enforcement', () => {
  let manager: CliProcessManager;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let cwd: AbsolutePath;
  let filePath: AbsolutePath;

  function makeConfig(overrides: Partial<import('../cli-provider').CliRuntimeConfig> = {}): import('../cli-provider').CliRuntimeConfig {
    return {
      command: 'echo',
      args: [],
      inputFormat: 'pipe',
      outputFormat: 'raw-stdout',
      sessionStrategy: 'per-turn',
      hangTimeout: { first: 1000, subsequent: 1000 },
      cwd,
      ...overrides,
    };
  }

  beforeEach(async () => {
    const cp = await import('node:child_process');
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    manager = new CliProcessManager();
    cwd = asAbsolutePath(
      mkdtempSync(path.join(tmpdir(), 'rolestra-cli-cwd-')),
      'test.cwd',
    );
    filePath = asAbsolutePath(path.join(cwd, 'not-a-dir.txt'), 'test.filePath');
    writeFileSync(filePath, 'file');
    mockExecFile.mockReturnValue({
      on: vi.fn(),
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('passes resolved cwd to per-turn execFile', () => {
    manager.spawnPerTurn(makeConfig(), ['hello']);

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: path.resolve(cwd),
        shell: false,
        windowsHide: true,
      }),
    );
  });

  it('rejects missing cwd before spawning', () => {
    // brand 를 통과하지 못하는 값을 일부러 만든다 — spawn 직전 runtime 가드가
    // 살아 있는지 보는 테스트다. 타입만 믿고 가드를 지우면, 브랜드가 없는
    // 옛 호출자가 하나라도 남아 있을 때 빈 cwd 가 그대로 spawn 으로 간다.
    const emptyCwd = unsafeMarkAbsolute('');
    expect(() => manager.spawnPerTurn(makeConfig({ cwd: emptyCwd }), [])).toThrow(
      /cwd required/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects file cwd before spawning', () => {
    expect(() => manager.spawnPerTurn(makeConfig({ cwd: filePath }), [])).toThrow(
      /not a directory/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
