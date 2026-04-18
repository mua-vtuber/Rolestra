import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveWindowsCommand, escapeWindowsArg, CliProcessManager } from '../cli-process';

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

// ===========================================================================
// escapeWindowsArg
// ===========================================================================

describe('escapeWindowsArg', () => {
  it('returns arg unchanged when no metacharacters', () => {
    expect(escapeWindowsArg('simple')).toBe('simple');
    expect(escapeWindowsArg('--flag')).toBe('--flag');
  });

  it('wraps args with spaces in double quotes', () => {
    expect(escapeWindowsArg('hello world')).toBe('"hello world"');
  });

  it('escapes embedded double quotes', () => {
    expect(escapeWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });
});

// ===========================================================================
// resolveWindowsCommand
// ===========================================================================

describe('resolveWindowsCommand', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('wraps .cmd files with cmd.exe /C', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude.cmd', ['--version']);
      expect(resolvedCommand).toBe('cmd.exe');
      expect(resolvedArgs).toEqual(['/C', 'claude.cmd', '--version']);
    });

    it('wraps .bat files with cmd.exe /C', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('setup.bat', ['--install']);
      expect(resolvedCommand).toBe('cmd.exe');
      expect(resolvedArgs).toEqual(['/C', 'setup.bat', '--install']);
    });

    it('wraps .ps1 files with pwsh.exe', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('script.ps1', ['-Param', 'val']);
      expect(resolvedCommand).toBe('pwsh.exe');
      expect(resolvedArgs).toEqual(['-NoProfile', '-File', 'script.ps1', '-Param', 'val']);
    });

    it('passes .exe files through directly', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude.exe', ['--help']);
      expect(resolvedCommand).toBe('claude.exe');
      expect(resolvedArgs).toEqual(['--help']);
    });

    it('passes .com files through directly', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('tool.com', ['-v']);
      expect(resolvedCommand).toBe('tool.com');
      expect(resolvedArgs).toEqual(['-v']);
    });

    it('wraps bare command names with cmd.exe /C for PATH resolution', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude', ['--version']);
      expect(resolvedCommand).toBe('cmd.exe');
      expect(resolvedArgs).toEqual(['/C', 'claude', '--version']);
    });

    it('wraps unknown extensions with cmd.exe /C', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('tool.xyz', ['arg']);
      expect(resolvedCommand).toBe('cmd.exe');
      expect(resolvedArgs).toEqual(['/C', 'tool.xyz', 'arg']);
    });

    it('is case-insensitive for extensions', () => {
      const { resolvedCommand: cmd1 } = resolveWindowsCommand('CLAUDE.CMD', []);
      expect(cmd1).toBe('cmd.exe');

      const { resolvedCommand: cmd2 } = resolveWindowsCommand('Script.PS1', []);
      expect(cmd2).toBe('pwsh.exe');

      const { resolvedCommand: cmd3 } = resolveWindowsCommand('Tool.EXE', []);
      expect(cmd3).toBe('Tool.EXE');
    });

    it('preserves all original args', () => {
      const args = ['--flag1', 'value1', '--flag2', 'value2'];
      const { resolvedArgs } = resolveWindowsCommand('test.cmd', args);
      expect(resolvedArgs).toEqual(['/C', 'test.cmd', ...args]);
    });

    it('routes through wsl.exe when wslDistro is set', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude', ['--version'], 'Ubuntu');
      expect(resolvedCommand).toBe('wsl.exe');
      expect(resolvedArgs).toEqual(['-d', 'Ubuntu', '--', 'claude', '--version']);
    });
  });

  describe('on non-Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    it('returns command unchanged for .cmd files', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude.cmd', ['--version']);
      expect(resolvedCommand).toBe('claude.cmd');
      expect(resolvedArgs).toEqual(['--version']);
    });

    it('returns command unchanged for bare names', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('claude', ['--help']);
      expect(resolvedCommand).toBe('claude');
      expect(resolvedArgs).toEqual(['--help']);
    });

    it('returns command unchanged for .exe files', () => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand('tool.exe', ['-v']);
      expect(resolvedCommand).toBe('tool.exe');
      expect(resolvedArgs).toEqual(['-v']);
    });
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

  it('resolves true on non-zero exit code (CLI exists but --version failed)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        // Non-zero exit but no string error code means the binary ran
        const err = Object.assign(new Error('exit code 1'), {
          killed: false,
          signal: null,
        });
        cb(err);
      },
    );

    const result = await manager.ping(makeConfig({ command: 'quirky-cli' }));
    expect(result).toBe(true);
  });
});
