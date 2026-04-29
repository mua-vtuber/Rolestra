/**
 * Gemini CLI provider configuration.
 *
 * Uses per-turn subprocess with stdin pipe input and stream-json output.
 * Command: gemini --output-format stream-json
 *
 * Protocol (v1 compatible):
 * - Input:  piped text via stdin with EOF
 * - Output: {"type":"init","session_id":"..."}\n{"type":"text","text":"..."}\n{"type":"result"}
 * - Boundary: {"type":"result"}
 * - Session: captured session_id → passed via --resume on next turn
 * - Rate Limit: 429/RESOURCE_EXHAUSTED → 3min backoff
 * - Warmup: 3s delay before first request
 */

import type { CliRuntimeConfig } from './cli-provider';
import { GeminiPermissionAdapter } from './permission-adapter';

export const GEMINI_CLI_CONFIG: CliRuntimeConfig = {
  command: 'gemini',
  // round2.5 fix: Gemini CLI 가 도입한 "trusted directory" 정책을 우회.
  // 사용자 보고 stderr: "Gemini CLI is not running in a trusted directory.
  // To proceed, either use `--skip-trust`, set the `GEMINI_CLI_TRUST_WORKSPACE
  // =true` environment variable, or trust this directory in interactive mode."
  // ArenaRoot 가 사용자 Documents 안의 정해진 위치라 매번 trust 등록을
  // 요구하면 dogfooding 흐름이 막힘 — `--skip-trust` 플래그를 default 로
  // 첨부.
  args: ['--skip-trust', '--output-format', 'stream-json'],
  inputFormat: 'pipe',
  outputFormat: 'stream-json',
  sessionStrategy: 'per-turn',
  hangTimeout: { first: 60_000, subsequent: 30_000 },
  sessionIdFlag: '--resume',
  warmupDelay: 3000,
  rateLimitTimeout: 180_000,

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
      const record = obj as Record<string, unknown>;
      if (record.type !== 'init') return null;
      const sid = record.session_id;
      return typeof sid === 'string' ? sid : null;
    } catch {
      return null;
    }
  },

  detectRateLimit(stderrLine: string): boolean {
    const lowerLine = stderrLine.toLowerCase();
    return (
      lowerLine.includes('429') ||
      lowerLine.includes('resource_exhausted') ||
      lowerLine.includes('ratelimitexceeded') ||
      lowerLine.includes('model_capacity_exhausted') ||
      lowerLine.includes('too many requests')
    );
  },

  permissionAdapter: new GeminiPermissionAdapter(),
};
