/**
 * CLI workspace 조립 — R12-X T4.
 *
 * CLI provider 를 부르는 모든 호출자는 spawn cwd 를 *명시적으로* 넘겨야
 * 한다. 옛 구조에서는 workspace 를 넘기지 않으면 provider 가 합의 폴더나
 * `process.cwd()` 를 스스로 골랐고, 그 결과 DM 응답과 회의록 요약이 앱
 * 실행 폴더 (개발 중에는 Rolestra 소스 저장소) 안에서 CLI 를 띄웠다.
 *
 * 여기 두 함수가 조립의 유일한 진입점이다.
 *   - {@link projectCliWorkspace}      — 프로젝트에 묶인 호출 (회의 turn).
 *   - {@link consensusOnlyCliWorkspace} — 프로젝트 없는 호출 (DM / 요약 /
 *                                        메모리 reflection).
 */

import type {
  ConsensusOnlyCliWorkspaceContext,
  ProjectCliWorkspaceContext,
} from '../../../shared/provider-types';
import type { PermissionSet } from '../../../shared/permission-set-types';
import { asAbsolutePath } from '../../../shared/absolute-path';
import type { PermissionService } from '../../files/permission-service';

/** `PermissionService.resolveForCli` 반환 형태 — 조립 입력. */
export type ResolvedCliPaths = ReturnType<PermissionService['resolveForCli']>;

/**
 * CLI provider 호출에 workspace 가 빠졌을 때.
 *
 * 옛 ambient fallback 을 대체한다 — 어디서 뭘 빠뜨렸는지 알 수 있도록
 * provider id 를 message 에 담는다.
 */
export class CliWorkspaceRequiredError extends Error {
  constructor(readonly providerId: string) {
    super(
      `[cli-workspace] CompletionOptions.cliWorkspace is required for CLI provider "${providerId}"`,
    );
    this.name = 'CliWorkspaceRequiredError';
  }
}

/**
 * worker 모드 argv 를 프로젝트 정책 없이 만들려 했을 때.
 *
 * consensus-only workspace 는 읽기 전용 argv 만 만들 수 있다.
 */
export class WorkerModeRequiresProjectError extends Error {
  constructor(readonly providerId: string) {
    super(
      `[cli-workspace] worker-mode argv requires a project-scoped workspace; provider "${providerId}" got scope="consensus-only"`,
    );
    this.name = 'WorkerModeRequiresProjectError';
  }
}

/**
 * 프로젝트 workspace — `PermissionService.resolveForCli` 결과를 그대로 받는다.
 *
 * resolveForCli 는 spawn 직전 realpath 재검증 (spec CA-3) 을 수행하므로,
 * 그 결과를 여기서 다시 해석하지 않고 경로만 옮겨 담는다.
 *
 * @param permissions 이 호출이 속한 채널의 권한 5 axis. 회의 turn 과
 *   프로젝트 DM 은 반드시 실제 set 을 넘긴다 — `null` 은 채널이 없는
 *   호출 (회의록 정리 / 메모리 reflection) 전용이며, 채널 권한으로
 *   argv 를 좁히지 않는다는 뜻이다 (R12-W T12).
 */
export function projectCliWorkspace(
  resolved: ResolvedCliPaths,
  permissions: PermissionSet | null,
): ProjectCliWorkspaceContext {
  return {
    scope: 'project',
    permissions,
    // R12-X T2: resolveForCli 반환 타입이 이미 AbsolutePath 이므로 재검증하지
    // 않는다. 검증은 ArenaRootService 생성자 (settings / env 경계) 에서 끝났다.
    cwd: resolved.cwd,
    consensusPath: resolved.consensusPath,
    projectId: resolved.project.id,
    projectKind: resolved.project.kind,
    permissionMode: resolved.project.permissionMode,
  };
}

/**
 * 프로젝트 없는 workspace — cwd 가 곧 합의 폴더다.
 *
 * @param consensusPath 초기화가 끝난 합의 폴더의 절대경로.
 * @throws {import('../../../shared/absolute-path').AbsolutePathError} 절대경로가 아닐 때.
 */
export function consensusOnlyCliWorkspace(
  consensusPath: string,
): ConsensusOnlyCliWorkspaceContext {
  const resolved = asAbsolutePath(
    consensusPath,
    'CliWorkspace.consensusOnly.consensusPath',
  );
  return {
    scope: 'consensus-only',
    cwd: resolved,
    consensusPath: resolved,
    projectId: null,
  };
}
