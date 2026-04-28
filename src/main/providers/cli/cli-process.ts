/**
 * CLI process manager — spawns, kills, and manages child processes.
 *
 * Handles Windows command resolution (cmd.exe, pwsh.exe wrappers),
 * persistent subprocess lifecycle, and stderr rate-limit detection.
 */

import { execFile, type ChildProcess } from 'node:child_process';
import type { CliRuntimeConfig } from './cli-provider';
import type { CliSessionState } from './cli-session-state';
import { getCircuitBreaker } from '../../queue/circuit-breaker-accessor';
import { KILL_GRACE_PERIOD_MS } from '../../../shared/timeouts';

const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * R9-Task6 (spec §8 CB-5 `cumulative_cli_ms`): hook the process exit
 * event so the CircuitBreaker accumulates wall-clock CLI time. Called
 * from both `spawnPersistent` and `spawnPerTurn` right after
 * `execFile` returns, so the handler runs even when the child exits
 * before the caller awaits anything.
 *
 * The breaker is read through {@link getCircuitBreaker} each exit —
 * tests that never install an accessor get a silent no-op, and the
 * production boot wire-up can rotate the breaker instance without
 * touching every spawning CliProvider.
 */
function wireCliElapsedRecorder(child: ChildProcess): void {
  const startedAt = Date.now();
  child.on('exit', () => {
    const elapsed = Date.now() - startedAt;
    const breaker = getCircuitBreaker();
    if (breaker && elapsed > 0) {
      breaker.recordCliElapsed(elapsed);
    }
  });
}

/**
 * Escape a single argument for safe use with cmd.exe /C on Windows.
 *
 * Wraps in double quotes and escapes embedded double quotes when the
 * argument contains characters that cmd.exe interprets as metacharacters.
 * Arguments without metacharacters are returned unchanged.
 */
export function escapeWindowsArg(arg: string): string {
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '\\"') + '"';
}

/**
 * Wraps a command for Windows execution without shell: true.
 *
 * Instead of enabling shell mode (which exposes argument injection),
 * we explicitly invoke the appropriate interpreter with shell: false.
 * - WSL distro set -> wsl.exe -d <distro> -- <command> ...args
 * - .cmd/.bat -> cmd.exe /C <command> ...args
 * - .ps1 -> pwsh.exe -NoProfile -File <command> ...args
 * - .exe/.com -> direct execution (CreateProcess handles these natively)
 * - bare names or unknown extensions -> cmd.exe /C (for PATH + PATHEXT resolution)
 *
 * On non-Windows, returns the command unchanged.
 */
export function resolveWindowsCommand(
  command: string,
  args: string[],
  wslDistro?: string,
): {
  resolvedCommand: string;
  resolvedArgs: string[];
} {
  if (process.platform !== 'win32') {
    return { resolvedCommand: command, resolvedArgs: args };
  }

  // WSL-hosted CLI: invoke via wsl.exe
  if (wslDistro) {
    return {
      resolvedCommand: 'wsl.exe',
      resolvedArgs: ['-d', wslDistro, '--', command, ...args],
    };
  }

  const lower = command.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return {
      resolvedCommand: 'cmd.exe',
      resolvedArgs: ['/C', command, ...args.map(escapeWindowsArg)],
    };
  }
  if (lower.endsWith('.ps1')) {
    return {
      resolvedCommand: 'pwsh.exe',
      resolvedArgs: ['-NoProfile', '-File', command, ...args],
    };
  }
  // .exe/.com can be executed directly by CreateProcess
  if (lower.endsWith('.exe') || lower.endsWith('.com')) {
    return { resolvedCommand: command, resolvedArgs: args };
  }

  // Bare names or unknown extensions: cmd.exe resolves PATH + PATHEXT
  return {
    resolvedCommand: 'cmd.exe',
    resolvedArgs: ['/C', command, ...args.map(escapeWindowsArg)],
  };
}

export class CliProcessManager {
  /** The current persistent child process, if any. */
  process: ChildProcess | null = null;

  /** Ping the CLI to verify it is installed (runs `<command> --version`). */
  ping(config: CliRuntimeConfig): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const { resolvedCommand, resolvedArgs } = resolveWindowsCommand(config.command, ['--version'], config.wslDistro);
      console.log(`[cli:ping] exec: ${resolvedCommand} ${resolvedArgs.join(' ')}`);
      execFile(
        resolvedCommand,
        resolvedArgs,
        { shell: false, timeout: 15_000 },
        (error, _stdout, stderr) => {
          if (!error) {
            console.log(`[cli:ping] success: ${config.command}`);
            resolve(true);
            return;
          }
          const errno = (error as NodeJS.ErrnoException).code;
          const detail = `code=${String(errno)}, killed=${error.killed}, signal=${String(error.signal)}`;
          console.warn(`[cli:ping] error: ${config.command} — ${detail}`, stderr?.trim());
          // Spawn failure (ENOENT = not found, EACCES = no permission) -> truly not installed
          if (typeof errno === 'string') { resolve(false); return; }
          // Timeout (process killed) -> treat as not installed
          if (error.killed) { resolve(false); return; }
          // Non-zero exit code -> CLI exists but --version failed (still installed)
          resolve(true);
        },
      );
    });
  }

  /** Spawn the persistent subprocess. */
  spawnPersistent(config: CliRuntimeConfig, sessionState: CliSessionState): Promise<void> {
    if (this.process && !this.process.killed) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      try {
        // Add session ID flag for respawning with conversation continuity
        const args = [...config.args];
        if (config.sessionIdFlag && sessionState.sessionId) {
          args.push(config.sessionIdFlag, sessionState.sessionId);
        }

        const { resolvedCommand, resolvedArgs } = resolveWindowsCommand(config.command, args, config.wslDistro);
        this.process = execFile(
          resolvedCommand,
          resolvedArgs,
          {
            shell: false,
            maxBuffer: MAX_BUFFER_BYTES,
            windowsHide: true,
          },
          // The callback fires when process exits (for persistent, that is at cooldown)
        );
        wireCliElapsedRecorder(this.process);

        // Drain stderr to prevent pipe buffer deadlock (v1 pattern)
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf-8');
          this.process.stderr.on('data', (chunk: string) => {
            // Detect rate-limit signals
            if (config.detectRateLimit) {
              for (const line of chunk.split('\n')) {
                if (line.trim() && config.detectRateLimit(line.trim())) {
                  sessionState.rateLimited = true;
                }
              }
            }
          });
        }

        // If the process fails to start, handle the error
        this.process.on('error', (err) => {
          this.process = null;
          reject(err);
        });

        // Give the process a moment to fail or succeed
        // If it hasn't errored in 500ms, assume startup succeeded
        const startupTimer = setTimeout(() => {
          resolve();
        }, 500);

        this.process.on('exit', () => {
          clearTimeout(startupTimer);
          this.process = null;
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Spawn a per-turn child process. */
  spawnPerTurn(config: CliRuntimeConfig, args: string[]): ChildProcess {
    const { resolvedCommand, resolvedArgs } = resolveWindowsCommand(config.command, args, config.wslDistro);
    const child = execFile(
      resolvedCommand,
      resolvedArgs,
      {
        shell: false,
        maxBuffer: MAX_BUFFER_BYTES,
      },
    );
    wireCliElapsedRecorder(child);
    return child;
  }

  /** Kill the current subprocess if running. */
  kill(): void {
    const proc = this.process;  // capture local reference
    this.process = null;
    if (!proc || proc.killed) return;
    proc.kill('SIGTERM');
    // Force kill after KILL_GRACE_PERIOD_MS if still alive.
    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, KILL_GRACE_PERIOD_MS);
    proc.on('exit', () => clearTimeout(forceKillTimer));
  }
}
