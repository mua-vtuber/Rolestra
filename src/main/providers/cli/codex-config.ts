/**
 * Codex CLI provider configuration.
 *
 * Uses per-turn subprocess with stdin pipe input and JSONL output.
 * Command: codex exec --json -
 *
 * Protocol:
 * - Input:  piped text via stdin with EOF
 * - Output: {"type":"thread.started","thread_id":"..."}\n
 *           {"type":"turn.started"}\n
 *           {"type":"item.completed","item":{"type":"agent_message","text":"..."}}\n
 *           {"type":"turn.completed","usage":{...}}
 * - Boundary: {"type":"turn.completed"}
 * - Session: captured thread_id → resume via `codex exec resume <id> --json -`
 */

import type { CliRuntimeConfig } from './cli-provider';
import { CodexPermissionAdapter } from './permission-adapter';

export const CODEX_CLI_CONFIG: CliRuntimeConfig = {
  command: 'codex',
  args: ['exec', '--json', '-'],
  inputFormat: 'pipe',
  outputFormat: 'jsonl',
  sessionStrategy: 'per-turn',
  hangTimeout: { first: 60_000, subsequent: 30_000 },

  responseBoundary(line: string): boolean {
    try {
      const obj: unknown = JSON.parse(line);
      return typeof obj === 'object' && obj !== null
        && (obj as Record<string, unknown>).type === 'turn.completed';
    } catch {
      return false;
    }
  },

  extractSessionId(line: string): string | null {
    try {
      const obj: unknown = JSON.parse(line);
      if (typeof obj !== 'object' || obj === null) return null;
      const record = obj as Record<string, unknown>;
      if (record.type !== 'thread.started') return null;
      const tid = record.thread_id;
      return typeof tid === 'string' ? tid : null;
    } catch {
      return null;
    }
  },

  buildResumeArgs(sessionId: string, _baseArgs: string[]): string[] {
    // Codex resume uses subcommand pattern: codex exec resume <id> --json -
    return ['exec', 'resume', sessionId, '--json', '-'];
  },

  permissionAdapter: new CodexPermissionAdapter(),
};
