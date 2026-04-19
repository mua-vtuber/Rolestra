/**
 * CLI subprocess spawn wrapper (Rolestra v3 / R2).
 *
 * Ported from `tools/cli-smoke/src/cli-spawn.ts` with two additions for the
 * Main process:
 *   1. {@link buildSpawnEnv} layers the macOS shell-env dump (CA-4) between
 *      `process.env` and the Rolestra overrides, so GUI Electron launches
 *      pick up Homebrew/nvm/pyenv PATH additions.
 *   2. Windows arg quoting still rejects `%` to block env-expansion attacks
 *      when we are forced to route through `cmd.exe /c`.
 *
 * Policy (spec §7.6 / R1 smoke matrix):
 * - Always `shell: false` — the caller passes a structured argv list.
 * - `cwd` is mandatory and must be an existing directory; this is the only
 *   place Rolestra scopes spawns to a project.
 * - Timeout defaults to 5min. After SIGTERM we give the child 3s then SIGKILL.
 *
 * NOTE: The existing v2 `cli-process.ts` has its own `resolveWindowsCommand`
 * that handles WSL/.ps1/.exe specifically. Task 21 reconciles the two; this
 * file keeps the R1 shape because the R1 matrix validated this exact code.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { getShellEnv } from './shell-env';

export interface RunCliOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Rolestra-controlled env overrides (highest precedence). */
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT = 5 * 60_000;

/**
 * Build a spawn env by layering (lowest → highest precedence):
 *   1. `process.env` — what Electron inherited.
 *   2. `shell-env` dump — only populated on darwin; `{}` elsewhere.
 *   3. `overrides` — Rolestra-controlled values (e.g. `ROLESTRA_PROJECT_SLUG`).
 *
 * The shell-env layer is read-through cached by {@link getShellEnv}, so repeat
 * calls cost nothing after the first invocation.
 */
export async function buildSpawnEnv(
  overrides: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const shellEnv = await getShellEnv();
  return {
    ...process.env,
    ...shellEnv,
    ...overrides,
  };
}

export async function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  if (!opts.cwd) {
    throw new Error('runCli: cwd required (Rolestra policy: CLI spawn only in project context)');
  }
  const resolvedCwd = path.resolve(opts.cwd);
  if (!existsSync(resolvedCwd)) {
    throw new Error(`runCli: cwd does not exist: ${resolvedCwd}`);
  }
  if (!statSync(resolvedCwd).isDirectory()) {
    throw new Error(`runCli: cwd is not a directory: ${resolvedCwd}`);
  }

  const { command, args } = resolveWindowsCommand(opts.command, opts.args);
  const env = await buildSpawnEnv(opts.env ?? {});

  return new Promise<RunCliResult>((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd: resolvedCwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outChunks: string[] = [];
    const errChunks: string[] = [];
    proc.stdout.on('data', (c: Buffer) => outChunks.push(c.toString('utf-8')));
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c.toString('utf-8')));

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3000);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ stdout: outChunks.join(''), stderr: errChunks.join(''), exitCode: code ?? 1 });
    });

    if (opts.stdin !== undefined) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

/**
 * Windows does not know how to execute `.cmd` / `.bat` launcher shims without
 * going through `cmd.exe /c`, and an unknown-extension binary could be either.
 * This helper routes those through `cmd.exe` with quoted args; everything else
 * (`.exe` / `.com`) runs directly.
 *
 * Exported because Task 21 may reconcile this with `cli-process.ts` —
 * external callers should still prefer {@link runCli}.
 */
export function resolveWindowsCommand(cmd: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: cmd, args };
  const lower = cmd.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return { command: 'cmd.exe', args: ['/c', cmd, ...args.map(escapeWindowsArg)] };
  }
  if (lower.endsWith('.exe') || lower.endsWith('.com')) {
    return { command: cmd, args };
  }
  return { command: 'cmd.exe', args: ['/c', cmd, ...args.map(escapeWindowsArg)] };
}

/**
 * Quote an arg for `cmd.exe /c`. Reject `%` outright — a `%VAR%` in an
 * unescaped arg would be expanded by the shell and could leak env values or
 * alter the command tail entirely.
 */
export function escapeWindowsArg(a: string): string {
  if (a.includes('%')) throw new Error(`Windows arg contains % (env expansion risk): ${a}`);
  if (!/[\s"&|<>^()!]/.test(a)) return a;
  return '"' + a.replace(/"/g, '""') + '"';
}
