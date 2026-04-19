import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCli, buildSpawnEnv, escapeWindowsArg } from '../cli-spawn';
import { _resetShellEnvCacheForTests } from '../shell-env';

// ── Shared tmp dir ─────────────────────────────────────────────
let cwd: string;
let cwdFilePath: string;

beforeAll(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'rolestra-cli-spawn-'));
  cwdFilePath = path.join(cwd, 'not-a-dir.txt');
  writeFileSync(cwdFilePath, 'file, not a directory');
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

// Keep the platform branch deterministic per test.
const ORIGINAL_PLATFORM = process.platform;
beforeEach(() => {
  _resetShellEnvCacheForTests();
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
});

// ── runCli: cwd validation ─────────────────────────────────────
describe('runCli: cwd validation', () => {
  it('throws when cwd is missing', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: undefined as unknown as string }),
    ).rejects.toThrow(/cwd required/);
  });

  it('throws when cwd does not exist', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: '/non/existent/path/xyz-rolestra' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('throws when cwd is a file, not a directory', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: cwdFilePath }),
    ).rejects.toThrow(/not a directory/);
  });
});

// ── runCli: end-to-end execution ───────────────────────────────
describe('runCli: execution', () => {
  it('runs `node -v` successfully', async () => {
    const r = await runCli({ command: 'node', args: ['-v'], cwd });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^v\d+/);
  });

  it('spawns with the resolved cwd', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
      cwd,
    });
    expect(stdout.trim()).toBe(path.resolve(cwd));
  });

  it('env overrides take effect in the child', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: [
        '-e',
        'console.log(process.env.ROLESTRA_PROJECT_SLUG + "|" + process.env.MY_VAR)',
      ],
      cwd,
      env: { MY_VAR: 'custom', ROLESTRA_PROJECT_SLUG: 'slug-x' },
    });
    expect(stdout.trim()).toBe('slug-x|custom');
  });
});

// ── buildSpawnEnv: merge priority ──────────────────────────────
describe('buildSpawnEnv: merge priority', () => {
  it('overrides win over process.env (non-darwin)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    _resetShellEnvCacheForTests();

    process.env.ROLESTRA_TEST_ONLY = 'from-process';
    try {
      const env = await buildSpawnEnv({ ROLESTRA_TEST_ONLY: 'from-override' });
      expect(env.ROLESTRA_TEST_ONLY).toBe('from-override');
    } finally {
      delete process.env.ROLESTRA_TEST_ONLY;
    }
  });

  it('process.env values flow through when not overridden', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    _resetShellEnvCacheForTests();

    process.env.ROLESTRA_PASSTHROUGH = 'hello';
    try {
      const env = await buildSpawnEnv({});
      expect(env.ROLESTRA_PASSTHROUGH).toBe('hello');
    } finally {
      delete process.env.ROLESTRA_PASSTHROUGH;
    }
  });

  it('shell-env overlay wins over process.env, overrides win over shell-env (darwin)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    _resetShellEnvCacheForTests();

    // Intercept the dynamic import of shell-env so we do not actually spawn
    // a login shell.
    vi.doMock('shell-env', () => ({
      shellEnv: vi.fn().mockResolvedValue({
        ROLESTRA_BASE: 'from-process-should-lose',
        ROLESTRA_SHELL_ONLY: 'from-shell',
        ROLESTRA_OVERRIDE_TARGET: 'from-shell-should-lose',
      }),
    }));

    process.env.ROLESTRA_BASE = 'from-process';
    try {
      const env = await buildSpawnEnv({ ROLESTRA_OVERRIDE_TARGET: 'from-override' });
      // shell-env layered on top of process.env
      expect(env.ROLESTRA_BASE).toBe('from-process-should-lose');
      // shell-env-only key visible
      expect(env.ROLESTRA_SHELL_ONLY).toBe('from-shell');
      // overrides always win
      expect(env.ROLESTRA_OVERRIDE_TARGET).toBe('from-override');
    } finally {
      delete process.env.ROLESTRA_BASE;
      vi.doUnmock('shell-env');
      _resetShellEnvCacheForTests();
    }
  });

  it('non-darwin skips shell-env entirely — override still wins, no shell-only keys leak in', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    _resetShellEnvCacheForTests();

    // If shell-env were accidentally invoked we would see this throw mapped
    // into a warn; but getShellEnv returns {} synchronously-by-logic on
    // non-darwin, so this mock must NEVER be consulted.
    const shellEnvMock = vi.fn();
    vi.doMock('shell-env', () => ({ shellEnv: shellEnvMock }));

    try {
      const env = await buildSpawnEnv({ ROLESTRA_FOO: 'bar' });
      expect(env.ROLESTRA_FOO).toBe('bar');
      expect(shellEnvMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('shell-env');
      _resetShellEnvCacheForTests();
    }
  });
});

// ── Windows arg escaping ──────────────────────────────────────
describe('escapeWindowsArg', () => {
  it('passes plain arg through unchanged', () => {
    expect(escapeWindowsArg('simple')).toBe('simple');
  });

  it('quotes arg containing whitespace', () => {
    expect(escapeWindowsArg('hello world')).toBe('"hello world"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeWindowsArg('a "quoted" b')).toBe('"a ""quoted"" b"');
  });

  it('quotes arg containing cmd metacharacters', () => {
    expect(escapeWindowsArg('a&b')).toBe('"a&b"');
    expect(escapeWindowsArg('a|b')).toBe('"a|b"');
    expect(escapeWindowsArg('a>b')).toBe('"a>b"');
  });

  it('rejects args containing % (env expansion risk)', () => {
    expect(() => escapeWindowsArg('%PATH%')).toThrow(/env expansion/i);
    expect(() => escapeWindowsArg('foo%bar')).toThrow(/env expansion/i);
  });
});
