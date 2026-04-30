/**
 * Codex CLI provider configuration.
 *
 * Uses per-turn subprocess with stdin pipe input and JSONL output.
 * Spawn 형태 (round2.6 fix 후):
 *   `codex [-a <val> --sandbox <val>] exec [-C <cwd>] [<exec-sub-opts>] --json`
 *
 * 옵션 위치 결정 — codex-cli 0.125+ 검증 결과 (사용자 dogfooding round2.6 + Codex
 * CLI 자체 진단으로 재현 확인):
 *   - `-a` / `--sandbox` 는 *상위* codex 옵션. `codex exec -a ...` 는
 *     `unexpected argument '-a'` 로 거부된다.
 *   - `-C` / `--full-auto` / `--skip-git-repo-check` /
 *     `--dangerously-bypass-approvals-and-sandbox` / `--json` 은 *exec* 서브
 *     커맨드 옵션 (Agestra 호출 패턴 검증).
 *
 * 그래서 base args 는 빈 배열로 두고, 전체 spawn args 의 책임은
 * `permission-flag-builder.ts` 의 `buildCodexFlags` /
 * `buildReadOnlyPermissionFlags` 가 진다. cli-provider 의 단순 concat 후에도
 * 옵션 순서가 정확히 `<global>` → `exec` → `<exec-sub>` → `--json` 이 되도록.
 *
 * Protocol:
 * - Input:  piped text via stdin with EOF (prompt 미명시 시 codex exec 가
 *   stdin 을 자동 read — `codex exec --help` 의 "[PROMPT] If not provided
 *   as an argument (or if `-` is used), instructions are read from stdin."
 *   명시). round2.5 fix 와 일관되게 stdin marker `-` 는 사용하지 않음
 *   (`-` 가 일부 wrapper 에서 unexpected positional 로 인식되는 회귀).
 * - Output: {"type":"thread.started","thread_id":"..."}\n
 *           {"type":"turn.started"}\n
 *           {"type":"item.completed","item":{"type":"agent_message","text":"..."}}\n
 *           {"type":"turn.completed","usage":{...}}
 * - Boundary: {"type":"turn.completed"}
 * - Session: captured thread_id → resume via `codex ... exec resume <id> ...`
 */

import type { CliRuntimeConfig } from './cli-provider';
import { CodexPermissionAdapter } from './permission-adapter';

export const CODEX_CLI_CONFIG: CliRuntimeConfig = {
  command: 'codex',
  // round2.6 — base args 는 비워두고 permission-flag-builder 가 *전체* args
  // 를 책임진다 (위 docblock 의 옵션 위치 분석 참조).
  args: [],
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

  buildResumeArgs(sessionId: string, baseArgs: string[]): string[] {
    // baseArgs 는 cli-provider 가 합쳐준 전체 args (`<global> exec <exec-sub>
    // --json`). resume 서브커맨드는 `exec` 다음에 `resume <id>` 를 끼워
    // 넣는 형태이므로, baseArgs 안에서 첫 `exec` 인덱스 뒤에 splice.
    //
    // 예: `['-a','never','--sandbox','read-only','exec','-C',cwd,'--json']`
    //   → `['-a','never','--sandbox','read-only','exec','resume',<id>,'-C',cwd,'--json']`
    //
    // base args 가 비어 있고 permission flags 가 아직 적용되지 않은 경계
    // (예: warmup 시 readonly 가 attach 되기 전) 에서는 fallback 으로
    // 최소 형태 `['exec','resume',<id>,'--json']` 를 반환.
    const execIdx = baseArgs.indexOf('exec');
    if (execIdx === -1) {
      return ['exec', 'resume', sessionId, '--json'];
    }
    const result = [...baseArgs];
    result.splice(execIdx + 1, 0, 'resume', sessionId);
    return result;
  },

  permissionAdapter: new CodexPermissionAdapter(),
};
