import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface RunCliOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT = 5 * 60_000; // 5분

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
  const env = { ...process.env, ...(opts.env ?? {}) };

  return new Promise<RunCliResult>((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd: resolvedCwd,
      env,
      windowsHide: true,
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

function resolveWindowsCommand(cmd: string, args: string[]): { command: string; args: string[] } {
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

function escapeWindowsArg(a: string): string {
  if (a.includes('%')) throw new Error(`Windows arg contains % (env expansion risk): ${a}`);
  if (!/[\s"&|<>^()!]/.test(a)) return a;
  return '"' + a.replace(/"/g, '""') + '"';
}
