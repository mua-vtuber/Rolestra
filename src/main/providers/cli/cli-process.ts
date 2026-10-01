/**
 * CLI process manager — spawns, kills, and manages child processes.
 *
 * Handles persistent subprocess lifecycle and stderr rate-limit detection.
 * Windows command resolution (cmd.exe / pwsh.exe / wsl.exe wrappers) lives in
 * `windows-command.ts` — the single copy shared with cli-spawn.ts and the
 * cli-detect IPC handler.
 */

import { execFile, type ChildProcess } from 'node:child_process';
import type { ConnectionFailure } from '../../../shared/connection-failure-types';
import * as fs from 'node:fs';
import type { CliRuntimeConfig } from './cli-provider';
import type { AbsolutePath } from '../../../shared/absolute-path';
import { normalizeAbsolute } from '../../files/absolute-path-node';
import type { CliSessionState } from './cli-session-state';
import { KILL_GRACE_PERIOD_MS } from '../../../shared/timeouts';
import { resolveWindowsCommand } from './windows-command';

const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * spawn 직전 마지막 관문 — cwd 가 실제로 존재하는 디렉터리인지 확인한다.
 *
 * R12-X T2 이후 `config.cwd` 는 `AbsolutePath` 라 "절대경로인가" 는 컴파일
 * 타임에 이미 끝났다. 여기서는 타입이 못 보는 것 — 값이 아예 안 왔는지,
 * 그 경로가 디스크에 있는지, 디렉터리인지 — 만 본다. `normalizeAbsolute` 는
 * 구분자 철자를 다듬을 뿐 검증을 대신하지 않는다.
 */
function resolveSpawnCwd(cwd: AbsolutePath | undefined): AbsolutePath {
  if (!cwd || cwd.trim().length === 0) {
    throw new Error('CLI spawn cwd required');
  }
  const resolved = normalizeAbsolute(cwd);
  if (!fs.existsSync(resolved)) {
    throw new Error(`CLI spawn cwd does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`CLI spawn cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

/** Spawn error code for a command that does not exist. */
const CLI_NOT_FOUND_CODE = 'ENOENT';

export class CliProcessManager {
  /** The current persistent child process, if any. */
  process: ChildProcess | null = null;

  /** Ping the CLI to verify it is installed (runs `<command> --version`). */
  /** True when `--version` ran (see {@link check}). */
  async ping(config: CliRuntimeConfig): Promise<boolean> {
    return (await this.check(config)) === null;
  }

  /**
   * Runs `<command> --version` and names why it could not run (QA
   * Medium-1): the command is missing (`ENOENT`), could not be started
   * (another spawn error code), or did not finish in time. A non-zero exit
   * is a failed check: a cmd.exe / WSL wrapper can start even when the
   * command behind it is missing or broken.
   */
  check(config: CliRuntimeConfig): Promise<ConnectionFailure | null> {
    return new Promise<ConnectionFailure | null>((resolve) => {
      const { resolvedCommand, resolvedArgs, windowsVerbatimArguments } = resolveWindowsCommand(
        config.command,
        ['--version'],
        { wslDistro: config.wslDistro },
      );
      console.log(`[cli:ping] exec: ${resolvedCommand} ${resolvedArgs.join(' ')}`);
      execFile(
        resolvedCommand,
        resolvedArgs,
        { shell: false, windowsVerbatimArguments, timeout: 15_000 },
        (error, _stdout, stderr) => {
          if (!error) {
            console.log(`[cli:ping] success: ${config.command}`);
            resolve(null);
            return;
          }
          const errno = (error as NodeJS.ErrnoException).code;
          const detail = `code=${String(errno)}, killed=${error.killed}, signal=${String(error.signal)}`;
          console.warn(`[cli:ping] error: ${config.command} — ${detail}`, stderr?.trim());
          // Spawn failure: ENOENT = not found, any other code (EACCES, …) = could not run.
          if (typeof errno === 'string') {
            resolve({ code: errno === CLI_NOT_FOUND_CODE ? 'cli-not-found' : 'cli-failed', detail: errno });
            return;
          }
          if (error.killed) { resolve({ code: 'timeout', detail: null }); return; }
          resolve({
            code: 'cli-failed',
            detail: typeof errno === 'number' ? `exit=${errno}`
              : error.signal ? `signal=${error.signal}` : null,
          });
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
        const cwd = resolveSpawnCwd(config.cwd);
        // Add session ID flag for respawning with conversation continuity
        const args = [...config.args];
        if (config.sessionIdFlag && sessionState.sessionId) {
          args.push(config.sessionIdFlag, sessionState.sessionId);
        }

        const { resolvedCommand, resolvedArgs, windowsVerbatimArguments } = resolveWindowsCommand(
          config.command,
          args,
          { wslDistro: config.wslDistro },
        );
        const child = execFile(
          resolvedCommand,
          resolvedArgs,
          {
            cwd,
            shell: false,
            windowsVerbatimArguments,
            maxBuffer: MAX_BUFFER_BYTES,
            windowsHide: true,
          },
          // The callback fires when process exits (for persistent, that is at cooldown)
        );

        this.process = child;

        let startupStderr = '';
        // Drain stderr to prevent pipe buffer deadlock (v1 pattern)
        if (child.stderr) {
          child.stderr.setEncoding('utf-8');
          child.stderr.on('data', (chunk: string) => {
            startupStderr = (startupStderr + chunk).slice(-1024);
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

        // Give the process a moment to fail or succeed
        // If it hasn't errored in 500ms, assume startup succeeded
        const startupTimer = setTimeout(() => {
          resolve();
        }, 500);

        child.on('error', (err) => {
          clearTimeout(startupTimer);
          if (this.process === child) this.process = null;
          reject(err);
        });

        child.on('exit', (code, signal) => {
          clearTimeout(startupTimer);
          // A previous conversation can exit after its replacement starts.
          if (this.process === child) this.process = null;
          reject(new Error(`CLI exited during startup (code=${String(code)}, signal=${String(signal)})${startupStderr ? `: ${startupStderr.trim()}` : ''}`));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Spawn a per-turn child process. */
  spawnPerTurn(config: CliRuntimeConfig, args: string[]): ChildProcess {
    const cwd = resolveSpawnCwd(config.cwd);
    const { resolvedCommand, resolvedArgs, windowsVerbatimArguments } = resolveWindowsCommand(
      config.command,
      args,
      { wslDistro: config.wslDistro },
    );
    const child = execFile(
      resolvedCommand,
      resolvedArgs,
      {
        cwd,
        shell: false,
        windowsVerbatimArguments,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      },
    );
    return child;
  }

  /** Kill the current subprocess if running. */
  kill(): void {
    const proc = this.process;  // capture local reference
    this.process = null;
    if (!proc || proc.killed) return;
    let exited = false;
    // `killed` only means a signal was sent, not that the process exited.
    const forceKillTimer = setTimeout(() => {
      if (!exited) proc.kill('SIGKILL');
    }, KILL_GRACE_PERIOD_MS);
    proc.on('exit', () => {
      exited = true;
      clearTimeout(forceKillTimer);
    });
    proc.kill('SIGTERM');
  }
}
