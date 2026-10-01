/**
 * Windows command resolution for CLI spawns — the single source of truth.
 *
 * Windows CreateProcess cannot launch a `.cmd` / `.bat` shim (npm installs
 * every CLI as one; Node additionally refuses one with EINVAL since the
 * CVE-2024-27980 fix), so that shape is routed through `cmd.exe`. `.ps1` goes
 * through `pwsh.exe -NoProfile -File`, and `.exe` / `.com` are launched
 * directly.
 *
 * A bare name carries no extension to branch on, and CreateProcess cannot tell
 * us which shape it is: spawning `npm` directly fails with ENOENT exactly like
 * a name that does not exist at all (measured on Windows 11 / Node 24), while
 * `node` launches fine. So a bare name is classified against PATH + PATHEXT to
 * learn its real extension, and only its extension decides the branch. A name
 * nothing on PATH matches falls back to cmd.exe, which reports the not-found
 * the way a shell would.
 *
 * Argument policy (R12 / health F01)
 * ----------------------------------
 * The defect this module removes: arguments used to be wrapped in double
 * quotes here and then wrapped AGAIN by libuv, so the child received the quote
 * characters as part of the value (`--add-dir "C:\path"` reached the CLI as a
 * directory name that starts with a quote).
 *
 * Letting libuv quote the arguments alone is not enough either, because
 * cmd.exe re-parses the whole command line and strips libuv's quotes before
 * the shim ever sees them. That mangles the COMMAND token as well: a shim
 * under `C:\shim test dir\` is truncated at the first space and the spawn
 * fails with "'C:\shim' is not recognized" (measured).
 *
 * So for the cmd.exe branch this module builds the command line itself and
 * hands it over with `windowsVerbatimArguments: true`, which tells libuv to
 * pass the string through untouched. The line has the shape
 *
 *     /S /C ""<target>" <arg> <arg> ..."
 *
 * `/S` makes cmd.exe strip exactly the outer pair of quotes, leaving the
 * quoted target intact. Each argument is quoted the way the child's C runtime
 * expects, then every character cmd.exe would act on — `( ) % ! ^ " < > & |` —
 * is caret-escaped so cmd.exe's own pass leaves it alone. Measured against a
 * real npm-style shim, this carries spaces, parentheses, `& | < > ^`, `%VAR%`,
 * `!`, embedded double quotes, trailing backslashes, empty arguments and
 * Korean text through verbatim.
 *
 * Two shapes still cannot survive and are rejected loudly rather than mangled:
 *
 *   - CR / LF terminate the command line cmd.exe parses.
 *   - `& | < > ^` reached while cmd.exe's quote state is ODD. cmd.exe toggles
 *     that state on every `"` in the command line and never resets it at an
 *     argument boundary, so the state MUST be carried across the whole argv,
 *     not recomputed per argument. An argument holding an odd number of quotes
 *     leaves every later argument exposed: `['--print', 'He said "hello',
 *     '--resume', 'a|b']` and `['a"b', 'c|d']` both fail to spawn, while
 *     `['a|b', 'c"d']` and `['a"b"c', 'd|e']` are fine because the state is
 *     even where the metacharacter sits.
 *
 *     Inside that odd state a caret is taken literally instead of escaping, so
 *     the character is left exposed. `&` `|` `>` break the spawn outright, but
 *     two of them fail quietly instead: `^` is always swallowed (`c^d` reaches
 *     the child as `cd`), and `<` becomes an input redirect whose damage
 *     depends on the filesystem — an error when nothing matches, a silent
 *     truncation of `c<d` to `c` when a file named `d` sits in the cwd. Those
 *     quiet cases are why this screening rejects up front instead of trusting
 *     the spawn to fail. (Measured against a real npm-style shim.)
 *
 * Callers MUST pass {@link ResolvedWindowsCommand.windowsVerbatimArguments}
 * straight through to `spawn` / `execFile`, or the line will be quoted a
 * second time and the defect returns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Thrown when an argument cannot survive the cmd.exe hop intact.
 *
 * Carries the command and the index of the offending argument so the caller
 * can point at the exact argv slot instead of guessing.
 */
export class CliArgUnsafeForCmdError extends Error {
  readonly command: string;
  readonly argIndex: number;
  readonly arg: string;
  readonly reason: string;

  constructor(command: string, argIndex: number, arg: string, reason: string) {
    super(
      `[cli] argument ${argIndex} for '${command}' cannot be passed through cmd.exe: ${reason} (arg: ${arg})`,
    );
    this.name = 'CliArgUnsafeForCmdError';
    this.command = command;
    this.argIndex = argIndex;
    this.arg = arg;
    this.reason = reason;
  }
}

/** A line break ends the command line cmd.exe is parsing. */
const LINE_BREAK = /[\r\n]/;
/**
 * Characters a caret cannot protect once cmd.exe's quote state is odd.
 * `&` `|` `>` fail the spawn; `<` and `^` corrupt the value silently.
 */
const CMD_METACHAR = new Set(['&', '|', '<', '>', '^']);
/** Every character cmd.exe acts on and a caret does protect outside quotes. */
const CARET_ESCAPED = /[()%!^"<>&|]/g;

/**
 * Scan one argument with the quote state cmd.exe is carrying when it reaches
 * that argument, and return the state it leaves behind plus the reason the
 * argument cannot pass, if any.
 *
 * The state is an input as well as an output: cmd.exe never resets it at an
 * argument boundary, so an earlier argument with an odd number of quotes
 * decides whether a metacharacter in a LATER argument is exposed.
 */
function scanArg(
  arg: string,
  insideQuotes: boolean,
): { insideQuotes: boolean; reason: string | null } {
  if (LINE_BREAK.test(arg)) {
    return { insideQuotes, reason: 'contains a line break' };
  }
  let inside = insideQuotes;
  for (const ch of arg) {
    if (ch === '"') {
      inside = !inside;
      continue;
    }
    if (inside && CMD_METACHAR.has(ch)) {
      return {
        insideQuotes: inside,
        reason: `contains '${ch}' while cmd.exe's quote state is open, where a caret escape is taken literally (an unbalanced double quote in this or an earlier argument opened it)`,
      };
    }
  }
  return { insideQuotes: inside, reason: null };
}

/**
 * Verify every argument can travel through cmd.exe unchanged.
 *
 * Walks the whole argv with a single running quote state, mirroring how
 * cmd.exe parses the command line as one string.
 *
 * @throws {CliArgUnsafeForCmdError} on the first argument that cannot.
 */
export function assertArgsSafeForCmd(command: string, args: readonly string[]): void {
  let insideQuotes = false;
  for (let i = 0; i < args.length; i += 1) {
    const result = scanArg(args[i], insideQuotes);
    if (result.reason !== null) {
      throw new CliArgUnsafeForCmdError(command, i, args[i], result.reason);
    }
    insideQuotes = result.insideQuotes;
  }
}

/**
 * Quote one argument the way the child's C runtime parses argv: wrap it in
 * double quotes, double up the backslashes that precede a quote, and escape
 * the quote itself.
 */
function quoteForChildRuntime(arg: string): string {
  let body = '';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
      body += ch;
      continue;
    }
    if (ch === '"') {
      // Every backslash run that precedes a quote must be doubled, then the
      // quote itself escaped, so the runtime sees a literal quote.
      body += '\\'.repeat(backslashes) + '\\"';
      backslashes = 0;
      continue;
    }
    backslashes = 0;
    body += ch;
  }
  // A trailing backslash run would otherwise escape our closing quote.
  body += '\\'.repeat(backslashes);
  return `"${body}"`;
}

/**
 * Build the single verbatim command line for `cmd.exe`.
 *
 * Exported so the twin under `tools/cli-smoke/` and the tests can assert the
 * exact string rather than only the observable spawn result.
 */
export function buildCmdCommandLine(target: string, args: readonly string[]): string {
  const parts = args.map((arg) => quoteForChildRuntime(arg).replace(CARET_ESCAPED, (m) => `^${m}`));
  const tail = parts.length > 0 ? ` ${parts.join(' ')}` : '';
  // /S makes cmd.exe strip exactly the outer quote pair, so the quoted target
  // survives even when its path contains spaces.
  return `/S /C ""${target}"${tail}"`;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Resolve a bare command name against PATH + PATHEXT and return the full path
 * of the first hit, so the caller can read the real extension off it.
 *
 * Returns `null` for a name that already carries a path separator (nothing to
 * look up) and for a name nothing on PATH matches.
 */
export function resolveOnWindowsPath(command: string): string | null {
  if (command.includes('\\') || command.includes('/')) return null;

  const exts = (process.env.PATHEXT ?? DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
  const dirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (isFile(candidate)) return candidate;
    }
    // An extensionless executable is unusual on Windows but not impossible.
    const bare = path.join(dir, command);
    if (isFile(bare)) return bare;
  }
  return null;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export interface ResolvedWindowsCommand {
  resolvedCommand: string;
  resolvedArgs: string[];
  /**
   * True when `resolvedArgs` is a single pre-built command line that must NOT
   * be quoted again. Pass straight through to the spawn options.
   */
  windowsVerbatimArguments: boolean;
}

export interface ResolveWindowsCommandOptions {
  /** WSL distro name — routes the spawn through `wsl.exe -d <distro> --`. */
  wslDistro?: string;
}

/**
 * Resolve a command + args pair into the form Node can spawn with
 * `shell: false` on Windows.
 *
 * On non-Windows the pair is returned unchanged.
 *
 * @throws {CliArgUnsafeForCmdError} when the cmd.exe branch is taken and an
 *         argument cannot survive it (see the module header).
 */
export function resolveWindowsCommand(
  command: string,
  args: string[],
  opts: ResolveWindowsCommandOptions = {},
): ResolvedWindowsCommand {
  if (process.platform !== 'win32') {
    return { resolvedCommand: command, resolvedArgs: args, windowsVerbatimArguments: false };
  }

  // WSL-hosted CLI: wsl.exe forwards argv to the Linux side, so no cmd.exe
  // parsing is involved and no argument screening applies.
  if (opts.wslDistro) {
    return {
      resolvedCommand: 'wsl.exe',
      resolvedArgs: ['-d', opts.wslDistro, '--', command, ...args],
      windowsVerbatimArguments: false,
    };
  }

  // A bare name says nothing about which branch it needs, and a direct spawn
  // cannot tell a `.cmd` shim from a missing command, so look the extension up.
  const target = hasExtension(command) ? command : (resolveOnWindowsPath(command) ?? command);
  const lower = target.toLowerCase();

  if (lower.endsWith('.ps1')) {
    return {
      resolvedCommand: 'pwsh.exe',
      resolvedArgs: ['-NoProfile', '-File', target, ...args],
      windowsVerbatimArguments: false,
    };
  }

  // .exe / .com are launched by CreateProcess directly — no interpreter hop,
  // so libuv's own quoting is correct and no argument restrictions apply.
  if (lower.endsWith('.exe') || lower.endsWith('.com')) {
    return { resolvedCommand: target, resolvedArgs: args, windowsVerbatimArguments: false };
  }

  // .cmd / .bat shims and anything PATH lookup could not classify need
  // cmd.exe, and with it the screening and the hand-built command line.
  assertArgsSafeForCmd(command, args);
  return {
    resolvedCommand: 'cmd.exe',
    resolvedArgs: [buildCmdCommandLine(target, args)],
    windowsVerbatimArguments: true,
  };
}

/** True when the command already carries a file extension we can branch on. */
function hasExtension(command: string): boolean {
  return path.extname(command).length > 0;
}
