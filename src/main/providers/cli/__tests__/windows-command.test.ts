/**
 * windows-command 단위 테스트 + 실제 spawn 회귀 테스트 (health F01).
 *
 * 검증:
 *   - resolveWindowsCommand 분기 형태 (.cmd / .bat / .ps1 / .exe / bare / wsl)
 *   - cmd.exe 분기가 명령줄을 직접 조립하고 windowsVerbatimArguments 를 켜는지
 *   - 통과 불가능한 인수(개행, 짝 안 맞는 큰따옴표 뒤의 & | < >)는
 *     CliArgUnsafeForCmdError 로 즉시 실패
 *   - Windows 실환경: 경로에 공백이 있는 디렉토리의 npm shim 모양 `.cmd` 를
 *     통해 자식 프로세스가 받은 argv 가 따옴표 추가 없이 원본과 동일한지
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  CliArgUnsafeForCmdError,
  assertArgsSafeForCmd,
  buildCmdCommandLine,
  resolveOnWindowsPath,
  resolveWindowsCommand,
} from '../windows-command';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';

/**
 * A bare name no PATH entry can ever match — keeps the "unresolvable falls
 * back to cmd.exe" assertions independent of what the host has installed.
 */
const UNRESOLVABLE = 'rolestra-no-such-cli-9d3f';

/**
 * Run `fn` with PATH pinned to `dir` and PATHEXT to a known list, so
 * resolution assertions do not depend on the host's environment.
 */
function withPath(dir: string, fn: () => void): void {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  process.env.PATH = dir;
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  try {
    fn();
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
  }
}

// ===========================================================================
// assertArgsSafeForCmd
// ===========================================================================

describe('assertArgsSafeForCmd', () => {
  it('accepts spaces, parens, backslashes, unicode, percent and bang', () => {
    expect(() =>
      assertArgsSafeForCmd('claude', [
        '--add-dir',
        'C:\\some dir\\with (parens)',
        'plain',
        '한글 인수',
        'a%b',
        '%PATH%',
        'a!b',
        '',
      ]),
    ).not.toThrow();
  });

  it('accepts a double quote on its own', () => {
    expect(() => assertArgsSafeForCmd('node', ['-e', 'console.log("a" + "b")'])).not.toThrow();
  });

  it('accepts every cmd metacharacter when the quotes around it are balanced', () => {
    // No quote is opened anywhere in this argv, so every caret escape works.
    expect(() =>
      assertArgsSafeForCmd('claude', ['a|b', 'a&b', 'a<b', 'a>b', 'a^b', 'a"b"c|d']),
    ).not.toThrow();
    // `a|b"c` leaves the quote state open, so it may only be the last argument.
    expect(() => assertArgsSafeForCmd('claude', ['a|b', 'a|b"c'])).not.toThrow();
  });

  it('rejects a metacharacter sitting after an unbalanced quote, with the index', () => {
    try {
      assertArgsSafeForCmd('claude', ['--flag', 'a"b|c']);
      expect.unreachable('expected CliArgUnsafeForCmdError');
    } catch (err) {
      expect(err).toBeInstanceOf(CliArgUnsafeForCmdError);
      const e = err as CliArgUnsafeForCmdError;
      expect(e.command).toBe('claude');
      expect(e.argIndex).toBe(1);
      expect(e.arg).toBe('a"b|c');
      expect(e.reason).toMatch(/quote state is open/);
    }
  });

  it('rejects each metacharacter inside an unbalanced quote region', () => {
    for (const arg of ['a"b&c', 'a"b|c', 'a"b<c', 'a"b>c', 'a"b^c', 'a"b"c"d|e']) {
      expect(() => assertArgsSafeForCmd('claude', [arg])).toThrow(CliArgUnsafeForCmdError);
    }
  });

  // cmd.exe parses the command line as one string and never resets its quote
  // state at an argument boundary, so screening each argument in isolation
  // lets an odd quote in one argument expose a metacharacter in a later one.
  it('carries the quote state across arguments, not per argument', () => {
    // Both shapes pass a per-argument scan (each later arg has no quote of
    // its own) yet die at spawn time. Measured on Windows 11 / Node 24.
    try {
      assertArgsSafeForCmd('claude', ['--print', 'He said "hello', '--resume', 'a|b']);
      expect.unreachable('expected CliArgUnsafeForCmdError');
    } catch (err) {
      expect(err).toBeInstanceOf(CliArgUnsafeForCmdError);
      const e = err as CliArgUnsafeForCmdError;
      // The blame lands on the argument that actually carries the metacharacter.
      expect(e.argIndex).toBe(3);
      expect(e.arg).toBe('a|b');
    }

    expect(() => assertArgsSafeForCmd('claude', ['a"b', 'c|d'])).toThrow(CliArgUnsafeForCmdError);
    expect(() => assertArgsSafeForCmd('claude', ['a"b', 'plain', 'c|d'])).toThrow(
      CliArgUnsafeForCmdError,
    );
  });

  it('reopens the quote state so a later balanced argument is accepted again', () => {
    // The odd quote in arg 0 is closed by arg 1, leaving arg 2 in an even
    // state where a caret escape works normally.
    expect(() => assertArgsSafeForCmd('claude', ['a"b', 'c"d', 'e|f'])).not.toThrow();
    expect(() => assertArgsSafeForCmd('claude', ['a|b', 'c"d'])).not.toThrow();
    expect(() => assertArgsSafeForCmd('claude', ['a"b"c', 'd|e'])).not.toThrow();
  });

  // `<` and `^` do not fail the spawn - they corrupt the value in silence,
  // which is why screening must reject them instead of trusting the spawn.
  it('rejects the silently-corrupting metacharacters too', () => {
    expect(() => assertArgsSafeForCmd('claude', ['a"b', 'c<d'])).toThrow(CliArgUnsafeForCmdError);
    expect(() => assertArgsSafeForCmd('claude', ['a"b', 'c^d'])).toThrow(CliArgUnsafeForCmdError);
  });

  it('rejects CR and LF', () => {
    expect(() => assertArgsSafeForCmd('claude', ['a\nb'])).toThrow(/line break/);
    expect(() => assertArgsSafeForCmd('claude', ['a\rb'])).toThrow(/line break/);
  });
});

// ===========================================================================
// buildCmdCommandLine
// ===========================================================================

describe('buildCmdCommandLine', () => {
  it('quotes the target so a path with spaces survives cmd.exe /S stripping', () => {
    const line = buildCmdCommandLine('C:\\shim test dir\\echo-args.cmd', []);
    expect(line).toBe('/S /C ""C:\\shim test dir\\echo-args.cmd""');
  });

  it('quotes each argument and caret-escapes what cmd.exe would act on', () => {
    const line = buildCmdCommandLine('c.cmd', ['--add-dir', 'a & b']);
    expect(line).toBe('/S /C ""c.cmd" ^"--add-dir^" ^"a ^& b^""');
  });

  it('doubles a trailing backslash run so it cannot escape the closing quote', () => {
    const line = buildCmdCommandLine('c.cmd', ['C:\\dir\\']);
    expect(line).toBe('/S /C ""c.cmd" ^"C:\\dir\\\\^""');
  });
});

// ===========================================================================
// resolveOnWindowsPath
// ===========================================================================

describe('resolveOnWindowsPath', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'rolestra-pathlookup-'));
    writeFileSync(path.join(fixtureDir, 'rolestra-fake-exe.EXE'), '');
    writeFileSync(path.join(fixtureDir, 'rolestra-fake-cmd.CMD'), '@echo off\r\n');
  });

  afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

  it('finds a name by appending each PATHEXT entry in order', () => {
    withPath(fixtureDir, () => {
      expect(resolveOnWindowsPath('rolestra-fake-exe')).toBe(
        path.join(fixtureDir, 'rolestra-fake-exe.EXE'),
      );
      expect(resolveOnWindowsPath('rolestra-fake-cmd')).toBe(
        path.join(fixtureDir, 'rolestra-fake-cmd.CMD'),
      );
    });
  });

  it('returns null for a name nothing on PATH matches', () => {
    withPath(fixtureDir, () => {
      expect(resolveOnWindowsPath(UNRESOLVABLE)).toBeNull();
    });
  });

  it('returns null for a name that already carries a path separator', () => {
    withPath(fixtureDir, () => {
      expect(resolveOnWindowsPath(path.join(fixtureDir, 'rolestra-fake-exe.EXE'))).toBeNull();
    });
  });
});

// ===========================================================================
// resolveWindowsCommand
// ===========================================================================

describe('resolveWindowsCommand', () => {
  const originalPlatform = process.platform;
  let fixtureDir: string;

  beforeEach(() => {
    // Two real files so PATHEXT resolution has something to find: one that
    // must take the direct-launch branch, one that must take cmd.exe.
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'rolestra-pathext-'));
    writeFileSync(path.join(fixtureDir, 'rolestra-fake-exe.EXE'), '');
    writeFileSync(path.join(fixtureDir, 'rolestra-fake-cmd.CMD'), '@echo off\r\n');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('sends a .cmd file through cmd.exe as one verbatim command line', () => {
      const r = resolveWindowsCommand('claude.cmd', ['--version']);
      expect(r.resolvedCommand).toBe('cmd.exe');
      expect(r.resolvedArgs).toEqual([buildCmdCommandLine('claude.cmd', ['--version'])]);
      expect(r.windowsVerbatimArguments).toBe(true);
    });

    it('sends a .bat file through cmd.exe', () => {
      const r = resolveWindowsCommand('setup.bat', ['--install']);
      expect(r.resolvedCommand).toBe('cmd.exe');
      expect(r.resolvedArgs).toEqual([buildCmdCommandLine('setup.bat', ['--install'])]);
      expect(r.windowsVerbatimArguments).toBe(true);
    });

    it('keeps the command token quoted when its path contains a space', () => {
      const target = 'C:\\shim test dir\\echo-args.cmd';
      const r = resolveWindowsCommand(target, ['--add-dir', 'C:\\some dir\\x']);
      // The exact defect C-1 guarded: the target must stay inside its own
      // quote pair, not be split at the first space.
      expect(r.resolvedArgs[0]).toContain(`"${target}"`);
    });

    it('falls back to cmd.exe for a bare name PATH lookup cannot classify', () => {
      const r = resolveWindowsCommand(UNRESOLVABLE, ['--version']);
      expect(r.resolvedCommand).toBe('cmd.exe');
      expect(r.resolvedArgs).toEqual([buildCmdCommandLine(UNRESOLVABLE, ['--version'])]);
    });

    it('resolves a bare name that lands on a .exe and spawns it directly', () => {
      withPath(fixtureDir, () => {
        const r = resolveWindowsCommand('rolestra-fake-exe', ['-e', 'a"b|c']);
        // Direct .exe launch — no cmd.exe hop, so no argument screening.
        expect(r.resolvedCommand).toBe(path.join(fixtureDir, 'rolestra-fake-exe.EXE'));
        expect(r.resolvedArgs).toEqual(['-e', 'a"b|c']);
        expect(r.windowsVerbatimArguments).toBe(false);
      });
    });

    it('resolves a bare name that lands on a .cmd through cmd.exe', () => {
      withPath(fixtureDir, () => {
        const r = resolveWindowsCommand('rolestra-fake-cmd', ['--version']);
        expect(r.resolvedCommand).toBe('cmd.exe');
        expect(r.resolvedArgs).toEqual([
          buildCmdCommandLine(path.join(fixtureDir, 'rolestra-fake-cmd.CMD'), ['--version']),
        ]);
      });
    });

    it('sends unknown extensions through cmd.exe', () => {
      const r = resolveWindowsCommand('tool.xyz', ['arg']);
      expect(r.resolvedCommand).toBe('cmd.exe');
      expect(r.resolvedArgs).toEqual([buildCmdCommandLine('tool.xyz', ['arg'])]);
    });

    it('wraps .ps1 files with pwsh.exe -NoProfile -File', () => {
      const r = resolveWindowsCommand('script.ps1', ['-Param', 'val']);
      expect(r.resolvedCommand).toBe('pwsh.exe');
      expect(r.resolvedArgs).toEqual(['-NoProfile', '-File', 'script.ps1', '-Param', 'val']);
      expect(r.windowsVerbatimArguments).toBe(false);
    });

    it('passes .exe and .com through directly', () => {
      expect(resolveWindowsCommand('claude.exe', ['--help'])).toEqual({
        resolvedCommand: 'claude.exe',
        resolvedArgs: ['--help'],
        windowsVerbatimArguments: false,
      });
      expect(resolveWindowsCommand('tool.com', ['-v'])).toEqual({
        resolvedCommand: 'tool.com',
        resolvedArgs: ['-v'],
        windowsVerbatimArguments: false,
      });
    });

    it('is case-insensitive for extensions', () => {
      expect(resolveWindowsCommand('CLAUDE.CMD', []).resolvedCommand).toBe('cmd.exe');
      expect(resolveWindowsCommand('Script.PS1', []).resolvedCommand).toBe('pwsh.exe');
      expect(resolveWindowsCommand('Tool.EXE', []).resolvedCommand).toBe('Tool.EXE');
    });

    it('throws CliArgUnsafeForCmdError on the cmd.exe branch for unsafe args', () => {
      expect(() => resolveWindowsCommand('claude.cmd', ['a"b|c'])).toThrow(CliArgUnsafeForCmdError);
      expect(() => resolveWindowsCommand(UNRESOLVABLE, ['a\nb'])).toThrow(CliArgUnsafeForCmdError);
    });

    it('does not screen args on the .exe branch (no cmd.exe hop)', () => {
      const r = resolveWindowsCommand('node.exe', ['-e', 'a"b|c', 'a\nb']);
      expect(r.resolvedArgs).toEqual(['-e', 'a"b|c', 'a\nb']);
    });

    it('routes through wsl.exe when wslDistro is set, without screening', () => {
      const r = resolveWindowsCommand('claude', ['-e', 'a"b|c'], { wslDistro: 'Ubuntu' });
      expect(r.resolvedCommand).toBe('wsl.exe');
      expect(r.resolvedArgs).toEqual(['-d', 'Ubuntu', '--', 'claude', '-e', 'a"b|c']);
      expect(r.windowsVerbatimArguments).toBe(false);
    });
  });

  describe('on non-Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    it('returns command and args unchanged for every shape', () => {
      expect(resolveWindowsCommand('claude.cmd', ['--version'])).toEqual({
        resolvedCommand: 'claude.cmd',
        resolvedArgs: ['--version'],
        windowsVerbatimArguments: false,
      });
      expect(resolveWindowsCommand('claude', ['--help'])).toEqual({
        resolvedCommand: 'claude',
        resolvedArgs: ['--help'],
        windowsVerbatimArguments: false,
      });
    });

    it('does not screen args (no cmd.exe involved)', () => {
      expect(() => resolveWindowsCommand('claude', ['a"b|c', 'a\nb'])).not.toThrow();
    });
  });
});

// ===========================================================================
// Real spawn through an npm-style .cmd shim (Windows only)
// ===========================================================================

describe.skipIf(!IS_WINDOWS)('real spawn through an npm-style .cmd shim', () => {
  let rootDir: string;
  /** Deliberately holds a space — the C-1 defect only shows up here. */
  let shimDir: string;
  let shimPath: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'rolestra-cmd-shim-'));
    shimDir = path.join(rootDir, 'shim test dir');
    mkdirSync(shimDir);
    shimPath = path.join(shimDir, 'echo-args.cmd');
    // Same shape npm generates for a bin: a .cmd that forwards %* to node.
    writeFileSync(shimPath, '@echo off\r\nnode "%~dp0echo-args.js" %*\r\n', 'utf-8');
    writeFileSync(
      path.join(shimDir, 'echo-args.js'),
      'console.log(JSON.stringify(process.argv.slice(2)));\n',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  /** Spawn through the resolver and return the argv the child actually saw. */
  async function childArgv(command: string, args: string[], extraPath?: string): Promise<string[]> {
    const { resolvedCommand, resolvedArgs, windowsVerbatimArguments } = resolveWindowsCommand(
      command,
      args,
    );
    const { stdout } = await execFileAsync(resolvedCommand, resolvedArgs, {
      shell: false,
      windowsVerbatimArguments,
      cwd: shimDir,
      env: extraPath
        ? { ...process.env, PATH: `${extraPath}${path.delimiter}${process.env.PATH ?? ''}` }
        : process.env,
      timeout: 30_000,
    });
    return JSON.parse(stdout.trim()) as string[];
  }

  it('a shim directory containing a space still launches (C-1 regression)', async () => {
    // Before the verbatim command line, cmd.exe split this path at the first
    // space and the spawn failed with "'...\\shim' is not recognized".
    const args = ['--add-dir', 'C:\\some dir\\x'];
    expect(shimPath).toContain(' ');
    await expect(childArgv(shimPath, args)).resolves.toEqual(args);
  });

  it('child receives args verbatim — no added quote characters', async () => {
    const args = ['--add-dir', 'C:\\some dir\\with (parens) & amp', '--plain', '한글 인수'];
    await expect(childArgv(shimPath, args)).resolves.toEqual(args);
  });

  it('carries double quotes, %VAR%, bare metacharacters and an empty arg', async () => {
    const args = ['-e', 'console.log("a" + "b")', '%PATH%', 'a|b', 'a!b', ''];
    await expect(childArgv(shimPath, args)).resolves.toEqual(args);
  });

  it('carries a trailing backslash without swallowing the closing quote', async () => {
    const args = ['-C', 'C:\\dir with space\\'];
    await expect(childArgv(shimPath, args)).resolves.toEqual(args);
  });

  it('a bare-name resolution through PATH also reaches the child verbatim', async () => {
    const args = ['--add-dir', 'C:\\another dir', '--plain'];
    const { resolvedCommand } = resolveWindowsCommand('echo-args', args);
    // The host has no `echo-args`, so this only classifies once PATH includes
    // the shim directory; the spawn below supplies it.
    expect(resolvedCommand).toBe('cmd.exe');
    await expect(childArgv('echo-args', args, shimDir)).resolves.toEqual(args);
  });

  // ---------------------------------------------------------------------
  // The screening rule, proved against the real spawn rather than asserted.
  // ---------------------------------------------------------------------

  /**
   * Spawn the shim bypassing `assertArgsSafeForCmd`, so the raw cmd.exe
   * outcome for a screened-out shape can be observed directly.
   */
  async function unscreenedChildArgv(args: string[]): Promise<string[]> {
    const { stdout } = await execFileAsync('cmd.exe', [buildCmdCommandLine(shimPath, args)], {
      shell: false,
      windowsVerbatimArguments: true,
      cwd: shimDir,
      timeout: 30_000,
    });
    return JSON.parse(stdout.trim()) as string[];
  }

  it('the cross-argument shapes the screening rejects really do break the spawn', async () => {
    // Exactly the argv the per-argument scan used to wave through.
    for (const args of [
      ['--print', 'He said "hello', '--resume', 'a|b'],
      ['a"b', 'c|d'],
    ]) {
      // The screening catches it...
      expect(() => resolveWindowsCommand(shimPath, args)).toThrow(CliArgUnsafeForCmdError);
      // ...and it is genuinely unusable, not merely disallowed.
      await expect(unscreenedChildArgv(args)).rejects.toThrow();
    }
  });

  it('a caret in the open quote state is swallowed silently, not rejected by cmd.exe', async () => {
    // `^` never fails the spawn - the child simply receives `cd` instead of
    // `c^d`. A silent wrong value is exactly what screening has to prevent,
    // since nothing downstream would ever notice.
    expect(() => resolveWindowsCommand(shimPath, ['a"b', 'c^d'])).toThrow(CliArgUnsafeForCmdError);
    await expect(unscreenedChildArgv(['a"b', 'c^d'])).resolves.toEqual(['a"b', 'cd']);
  });

  it('a redirect in the open quote state truncates the value when the target exists', async () => {
    // `<` is parsed as an input redirect, so its damage depends on the
    // filesystem: it errors with no matching file, but silently truncates
    // `c<d` to `c` when a file named `d` happens to sit in the cwd.
    expect(() => resolveWindowsCommand(shimPath, ['a"b', 'c<d'])).toThrow(CliArgUnsafeForCmdError);
    writeFileSync(path.join(shimDir, 'd'), 'redirect source\n', 'utf-8');
    await expect(unscreenedChildArgv(['a"b', 'c<d'])).resolves.toEqual(['a"b', 'c']);
  });

  it('an odd quote closed by a later argument stays spawnable', async () => {
    // The mirror image: the screening allows these, and they really work.
    for (const args of [
      ['a"b', 'c"d', 'e|f'],
      ['a|b', 'c"d'],
      ['a"b"c', 'd|e'],
    ]) {
      expect(() => resolveWindowsCommand(shimPath, args)).not.toThrow();
      await expect(childArgv(shimPath, args)).resolves.toEqual(args);
    }
  });
});
