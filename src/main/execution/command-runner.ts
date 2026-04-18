/**
 * Safe command runner using structured CommandRequest objects.
 *
 * Enforces CommandPolicy (allowlist + blocked patterns) and uses
 * child_process.execFile with shell:false to prevent shell injection.
 *
 * Blocked patterns are pre-compiled once at construction to avoid
 * per-execution overhead and ReDoS risk from repeated regex compilation.
 */

import { execFile } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import type {
  CommandRequest,
  CommandResult,
  CommandPolicy,
} from '../../shared/execution-types';

/**
 * Validates and executes structured command requests.
 *
 * Security guarantees:
 * - Only allowlisted commands can execute
 * - Blocked patterns are checked against the full command string
 * - shell:false prevents shell injection
 * - Timeout and output size limits are enforced
 * - Regex patterns are pre-compiled to prevent ReDoS
 */
export class CommandRunner {
  private readonly policy: CommandPolicy;
  private readonly compiledPatterns: RegExp[];
  private readonly workspaceRoot: string | null;

  constructor(policy: CommandPolicy, workspaceRoot?: string) {
    this.policy = policy;
    this.workspaceRoot = workspaceRoot ?? null;
    // Pre-compile patterns once — avoids per-execution overhead and
    // ensures invalid regex is caught at construction time.
    this.compiledPatterns = policy.blockedPatterns.map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch (err) {
        throw new Error(
          `Invalid blocked pattern "${pattern}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Validate a command request against the policy.
   *
   * @param request - The command request to validate.
   * @throws Error if the command is not allowed or matches a blocked pattern.
   */
  validate(request: CommandRequest): void {
    // Check allowlist
    if (!this.policy.allowedCommands.includes(request.command)) {
      throw new Error(`Command not allowed: ${request.command}`);
    }

    // Check cwd is within workspace root
    if (request.cwd && this.workspaceRoot) {
      const resolvedCwd = resolve(request.cwd);
      const normalizedRoot = normalize(this.workspaceRoot);
      if (!resolvedCwd.startsWith(normalizedRoot)) {
        throw new Error(`cwd "${request.cwd}" is outside workspace root`);
      }
    }

    // Check blocked patterns against full command string
    const fullCommand = [request.command, ...request.args].join(' ');
    for (const regex of this.compiledPatterns) {
      if (regex.test(fullCommand)) {
        throw new Error('Blocked dangerous pattern detected');
      }
    }
  }

  /**
   * Execute a validated command request.
   *
   * @param request - The command request to execute.
   * @returns The command result with exit code, stdout, stderr, and duration.
   * @throws Error if the command is not allowed or execution fails.
   */
  async run(request: CommandRequest): Promise<CommandResult> {
    // Validate before execution
    this.validate(request);

    const startTime = Date.now();

    return new Promise<CommandResult>((resolve, reject) => {
      execFile(
        request.command,
        request.args,
        {
          cwd: request.cwd,
          timeout: this.policy.maxExecutionTimeMs,
          maxBuffer: this.policy.maxOutputBytes,
          shell: false,
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;

          if (error && error.killed) {
            // Process was killed (timeout)
            resolve({
              exitCode: -1,
              stdout: stdout ?? '',
              stderr: stderr ?? `Process killed after ${this.policy.maxExecutionTimeMs}ms timeout`,
              durationMs,
            });
            return;
          }

          if (error && !('code' in error && typeof error.code === 'number')) {
            // Execution error (e.g., command not found)
            reject(error);
            return;
          }

          resolve({
            exitCode: typeof error?.code === 'number' ? error.code : (error ? 1 : 0),
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            durationMs,
          });
        },
      );
    });
  }
}
