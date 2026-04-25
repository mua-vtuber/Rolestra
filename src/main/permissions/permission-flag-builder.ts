/**
 * PermissionFlagBuilder — R10-Task5 (spec §7.6.3 매트릭스 통합).
 *
 * 3 mode (`auto` | `hybrid` | `approval`) × 3 CLI (`claude` | `codex` |
 * `gemini`) × 3 project kind (`new` | `external` | `imported`) +
 * `dangerousAutonomyOptIn` boolean 의 단일 진입점. spec §7.6.3 의 표가
 * 정본이며, 본 모듈은 그 표를 코드로 옮긴다. 기존에 흩어져 있던
 * `permission-adapter.ts` 의 3 adapter 클래스는 이 builder 를 호출하도록
 * 정리된다 (Task 5 refactor — 회귀 0 보장).
 *
 * 호출 경로 두 가지:
 *   1. Main 내부 — `cli-provider.ts` 가 spawn 직전 plain function 호출.
 *   2. Renderer dry-run — IPC `permission:dry-run-flags` (설정 보안 탭이
 *      "이 조합은 어떤 플래그가 붙는가" preview).
 *
 * 거부 규약 (spec §7.3 CA-1/CA-3 + §7.6 본문):
 *   - `external` + `auto` 는 zod 입력에서 reject (ipc-schemas
 *     `permissionDryRunFlagsSchema`). builder 는 안전망으로 한 번 더
 *     `blocked: true` 응답 — Main 내부 직접 호출이 zod 를 우회하는
 *     경로에서도 동일 가드.
 *   - `dangerousAutonomyOptIn=true` + `auto` 조합만이 `--dangerously-*`
 *     플래그를 추가한다. opt-in 이 true 여도 hybrid/approval 모드는
 *     기존 안전 플래그를 그대로 유지 — opt-in 은 "auto 의 위험 강화"
 *     단일 의미.
 */

import type { CliKind } from '../../shared/cli-types';
import type { PermissionMode, ProjectKind } from '../../shared/project-types';
import type { PermissionFlagOutput } from '../../shared/permission-flag-types';

// spec §7.6.3 Claude tool whitelists — 표와 1:1 매칭.
const CLAUDE_AUTO_TOOLS = 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch';
const CLAUDE_HYBRID_TOOLS = 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch';
const CLAUDE_READONLY_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';

/**
 * Builder 입력. shared 의 `PermissionFlagInput` 은 wire 용
 * (providerType: 'claude_cli'|'codex_cli'|'gemini_cli'|... 8값) 이고,
 * 본 builder 는 CLI kind 3값에만 관심이 있다. IPC handler 가 wire 의
 * `*_cli` suffix 를 떼어 `cliKind` 로 정규화하여 본 builder 에 넘긴다.
 * `*_api` / `mock` 등 비-CLI provider 는 handler 단에서
 * `blockedReason='unknown_provider_type'` 으로 차단.
 */
export interface PermissionFlagBuilderInput {
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  dangerousAutonomyOptIn: boolean;
  /** 절대 경로 — 프로젝트 spawn cwd. Codex `-C <cwd>` 등에 그대로 주입. */
  cwd: string;
  /** 절대 경로 — `<ArenaRoot>/consensus/`. Claude `--add-dir <consensusPath>`. */
  consensusPath: string;
}

/** Public alias for callers that prefer DTO-style naming (matches task spec). */
export type PermissionFlagBuilderOutput = PermissionFlagOutput;

/**
 * spec §7.3 CA-1/CA-3 안전망 — IPC zod 가 일찍 잘라내지만 Main 내부의
 * 직접 호출 경로(예: ProjectService.updatePermissionMode 의 dry-run)
 * 에서도 동일 가드를 한 번 더 적용한다.
 */
function isExternalAutoForbidden(input: PermissionFlagBuilderInput): boolean {
  return input.projectKind === 'external' && input.permissionMode === 'auto';
}

function blockedExternalAuto(): PermissionFlagOutput {
  return {
    flags: [],
    rationale: ['permission.flag.reason.external_auto_forbidden'],
    blocked: true,
    blockedReason: 'external_auto_forbidden',
  };
}

function buildClaudeFlags(
  input: PermissionFlagBuilderInput,
): PermissionFlagOutput {
  const rationale: string[] = ['permission.flag.reason.claude'];
  let flags: string[];

  switch (input.permissionMode) {
    case 'auto':
      // spec §7.6.3 Claude auto: acceptEdits + 전체 tool whitelist + add-dir.
      flags = [
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        CLAUDE_AUTO_TOOLS,
        '--add-dir',
        input.consensusPath,
      ];
      rationale.push('permission.flag.reason.auto');
      // spec §7.6.5 — opt-in 시에만 --dangerously-skip-permissions 추가.
      // 기본은 acceptEdits + allowedTools 화이트리스트만으로 충분.
      if (input.dangerousAutonomyOptIn) {
        flags.push('--dangerously-skip-permissions');
        rationale.push('permission.flag.reason.dangerous_opt_in');
      }
      break;
    case 'hybrid':
      // spec §7.6.3 Claude hybrid: Bash 제거 (앱 레벨 prompt 로 처리).
      flags = [
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        CLAUDE_HYBRID_TOOLS,
        '--add-dir',
        input.consensusPath,
      ];
      rationale.push('permission.flag.reason.hybrid');
      break;
    case 'approval':
      // spec §7.6.3 Claude approval: read-only whitelist + default 모드.
      flags = [
        '--allowedTools',
        CLAUDE_READONLY_TOOLS,
        '--permission-mode',
        'default',
        '--add-dir',
        input.consensusPath,
      ];
      rationale.push('permission.flag.reason.approval');
      break;
  }

  return { flags, rationale, blocked: false, blockedReason: null };
}

function buildCodexFlags(
  input: PermissionFlagBuilderInput,
): PermissionFlagOutput {
  const rationale: string[] = ['permission.flag.reason.codex'];
  let flags: string[];

  switch (input.permissionMode) {
    case 'auto':
      // spec §7.6.3 Codex auto: -a never + danger-full-access sandbox.
      // dangerousAutonomyOptIn 일 때는 --dangerously-bypass-approvals-and-sandbox
      // 단일 alias 로 표현 (spec §7.6.5 명시).
      if (input.dangerousAutonomyOptIn) {
        flags = [
          'exec',
          '--dangerously-bypass-approvals-and-sandbox',
          '-C',
          input.cwd,
          '--skip-git-repo-check',
          '-',
        ];
        rationale.push(
          'permission.flag.reason.auto',
          'permission.flag.reason.dangerous_opt_in',
        );
      } else {
        flags = [
          'exec',
          '-a',
          'never',
          '--sandbox',
          'danger-full-access',
          '-C',
          input.cwd,
          '--skip-git-repo-check',
          '-',
        ];
        rationale.push('permission.flag.reason.auto');
      }
      break;
    case 'hybrid':
      // spec §7.6.3 Codex hybrid: --full-auto alias. Rolestra 가 shell/network
      // 승인 prompt 를 앱 레벨에서 가로채어 처리 (CB-6).
      flags = ['exec', '--full-auto', '-C', input.cwd, '-'];
      rationale.push('permission.flag.reason.hybrid');
      break;
    case 'approval':
      // spec §7.6.3 Codex approval: -a on-failure + workspace-write.
      flags = [
        'exec',
        '-a',
        'on-failure',
        '--sandbox',
        'workspace-write',
        '-C',
        input.cwd,
        '-',
      ];
      rationale.push('permission.flag.reason.approval');
      break;
  }

  return { flags, rationale, blocked: false, blockedReason: null };
}

function buildGeminiFlags(
  input: PermissionFlagBuilderInput,
): PermissionFlagOutput {
  // spec §7.6.3 Gemini: 단일 --approval-mode <value>.
  const rationale: string[] = ['permission.flag.reason.gemini'];
  let flags: string[];

  switch (input.permissionMode) {
    case 'auto':
      flags = ['--approval-mode', 'yolo'];
      rationale.push('permission.flag.reason.auto');
      // Gemini 는 spec §7.6.5 의 "극한 자율" 별도 alias 가 없다 — yolo 가
      // 이미 최대 권한. dangerousAutonomyOptIn 은 Gemini 에서 무시 (rationale
      // 만 추가).
      if (input.dangerousAutonomyOptIn) {
        rationale.push('permission.flag.reason.dangerous_opt_in');
      }
      break;
    case 'hybrid':
      flags = ['--approval-mode', 'auto_edit'];
      rationale.push('permission.flag.reason.hybrid');
      break;
    case 'approval':
      flags = ['--approval-mode', 'default'];
      rationale.push('permission.flag.reason.approval');
      break;
  }

  return { flags, rationale, blocked: false, blockedReason: null };
}

/**
 * spec §7.6.3 매트릭스 단일 진입점.
 *
 * @returns `blocked=false` + flags 채워진 결과 또는 `blocked=true` +
 *   blockedReason 으로 사유를 명시한 결과. throw 하지 않는다 — IPC dry-run
 *   에서 UI 가 사유 배너를 그릴 수 있도록.
 */
export function buildPermissionFlags(
  input: PermissionFlagBuilderInput,
): PermissionFlagOutput {
  if (isExternalAutoForbidden(input)) {
    return blockedExternalAuto();
  }

  switch (input.cliKind) {
    case 'claude':
      return buildClaudeFlags(input);
    case 'codex':
      return buildCodexFlags(input);
    case 'gemini':
      return buildGeminiFlags(input);
  }
}

/**
 * spec §7.6.3 read-only argv — 관찰자 / 리뷰어 용. permission mode 는
 * 무시되며 모든 CLI 가 read-only 동작으로 강제된다. Gemini 는 native
 * read-only mode 가 없어서 default + 시스템 프롬프트 강제로 대체
 * (spec §7.6.3 Gemini 표).
 */
export function buildReadOnlyPermissionFlags(
  input: Pick<PermissionFlagBuilderInput, 'cliKind' | 'cwd' | 'consensusPath'>,
): string[] {
  switch (input.cliKind) {
    case 'claude':
      return [
        '--allowedTools',
        CLAUDE_READONLY_TOOLS,
        '--permission-mode',
        'default',
        '--add-dir',
        input.consensusPath,
      ];
    case 'codex':
      return [
        'exec',
        '-a',
        'never',
        '--sandbox',
        'read-only',
        '-C',
        input.cwd,
        '-',
      ];
    case 'gemini':
      return ['--approval-mode', 'default'];
  }
}
