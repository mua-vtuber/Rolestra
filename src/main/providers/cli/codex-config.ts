/**
 * Codex CLI provider configuration.
 *
 * Uses per-turn subprocess with stdin pipe input and JSONL output.
 * Command: codex exec --json
 *
 * Protocol:
 * - Input:  piped text via stdin with EOF (prompt 미명시 시 codex exec
 *   가 stdin 을 자동 read — `codex exec --help` 의
 *   "[PROMPT] If not provided as an argument (or if `-` is used),
 *    instructions are read from stdin." 명시).
 *   round2.5 fix: 옛 codex 인터페이스에서 사용하던 `-` stdin marker 가
 *   사용자 host 의 최신 codex CLI / .cmd shim 에서 "unexpected argument"
 *   로 거부되는 회귀가 발생. prompt 위치 자체를 비우면 codex 가 stdin 을
 *   자동 read 하므로 `-` 를 빼는 게 호환성 측면에서 가장 robust.
 * - Output: {"type":"thread.started","thread_id":"..."}\n
 *           {"type":"turn.started"}\n
 *           {"type":"item.completed","item":{"type":"agent_message","text":"..."}}\n
 *           {"type":"turn.completed","usage":{...}}
 * - Boundary: {"type":"turn.completed"}
 * - Session: captured thread_id → resume via `codex exec resume <id> --json`
 */

import type { CliRuntimeConfig } from './cli-provider';
import { CodexPermissionAdapter } from './permission-adapter';

export const CODEX_CLI_CONFIG: CliRuntimeConfig = {
  command: 'codex',
  args: ['exec', '--json'],
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
    // Codex resume subcommand: `codex exec resume <id> --json`. stdin
    // marker `-` 는 round2.5 fix 와 일관되게 생략 — prompt 위치를 비우면
    // codex 가 stdin 을 자동 read.
    return ['exec', 'resume', sessionId, '--json'];
  },

  permissionAdapter: new CodexPermissionAdapter(),
};
