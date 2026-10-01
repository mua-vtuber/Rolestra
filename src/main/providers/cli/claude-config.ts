/**
 * Claude Code CLI provider configuration.
 *
 * Uses persistent subprocess with structured JSON stdin protocol.
 * Command: claude --input-format stream-json --output-format stream-json --verbose
 *
 * Protocol (v1 compatible):
 * - Input:  {"type":"user","message":{"role":"user","content":"..."}}\n
 * - Output: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]},"session_id":"..."}
 * - Boundary: {"type":"result",...}
 * - Session: captured session_id → passed via --session-id on respawn
 */

import type { CliRuntimeConfig } from './cli-provider';
import { ClaudePermissionAdapter } from './permission-adapter';

export const CLAUDE_CLI_CONFIG: CliRuntimeConfig = {
  command: 'claude',
  args: [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ],
  inputFormat: 'stdin-json',
  outputFormat: 'stream-json',
  sessionStrategy: 'persistent',
  hangTimeout: { first: 120_000, subsequent: 90_000 },
  sessionIdFlag: '--session-id',

  responseBoundary(line: string): boolean {
    try {
      const obj: unknown = JSON.parse(line);
      return typeof obj === 'object' && obj !== null
        && (obj as Record<string, unknown>).type === 'result';
    } catch {
      return false;
    }
  },

  extractSessionId(line: string): string | null {
    try {
      const obj: unknown = JSON.parse(line);
      if (typeof obj !== 'object' || obj === null) return null;
      const sid = (obj as Record<string, unknown>).session_id;
      return typeof sid === 'string' ? sid : null;
    } catch {
      return null;
    }
  },

  permissionAdapter: new ClaudePermissionAdapter(),
};
