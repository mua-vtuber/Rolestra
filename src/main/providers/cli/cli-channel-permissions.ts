/**
 * CLI spawn 에 채널 권한을 반영하는 부분 — R12-W T12.
 *
 * `cli-provider.ts` 는 spawn 수명주기와 스트리밍을 맡는 큰 모듈이라, 채널
 * 권한이라는 별개 관심사를 여기로 떼어냈다. provider 는 두 함수만 부른다.
 *
 *   - {@link applyChannelPermissionFilter} spawn argv 를 채널 권한으로 좁힌다.
 *   - {@link serializePermissionsForKey} 권한을 세션 격리 키에 넣을 문자열로.
 */

import type { CliKind } from '../../../shared/cli-types';
import type { PermissionSet } from '../../../shared/permission-set-types';
import type { CliWorkspaceContext } from '../../../shared/provider-types';
import { filterFlagsByChannelPermission } from '../../permissions/permission-flag-filter';
import { tryGetLogger } from '../../log/logger-accessor';
import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
  type CliPermissionAdapter,
} from './permission-adapter';

/**
 * 채널 권한 filter 를 걸어야 하는데 이 provider 의 CLI 종류를 알 수 없을 때.
 *
 * 조용히 filter 를 건너뛰면 사용자가 끈 도구가 그대로 붙은 채 CLI 가 뜨고,
 * 그 사실이 아무 데도 드러나지 않는다. 어느 provider 가 문제인지 message 에
 * 담아 멈춘다.
 */
export class UnknownCliKindError extends Error {
  constructor(readonly providerId: string) {
    super(
      `[cli-provider] cannot resolve CLI kind for provider "${providerId}" — ` +
        'permissionAdapter is not one of Claude / Codex',
    );
    this.name = 'UnknownCliKindError';
  }
}

/** workspace 격리 키에 쓰는 axis 순서 — 고정이어야 한다. */
const KEY_AXES: Array<keyof PermissionSet> = [
  'fileRead',
  'fileWrite',
  'commandExec',
  'webSearch',
  'dbRead',
];

/**
 * 권한 5 axis 를 workspace 격리 키에 넣을 짧은 문자열로.
 *
 * axis 순서를 고정해 같은 권한이면 언제나 같은 문자열이 나오게 한다 —
 * 순서가 흔들리면 권한이 그대로인데도 세션이 매 turn 새로 뜬다.
 */
export function serializePermissionsForKey(
  permissions: PermissionSet | null,
): string {
  if (permissions === null) return 'perm:none';
  return `perm:${KEY_AXES.map((a) => (permissions[a] ? '1' : '0')).join('')}`;
}

/**
 * 이 provider 가 어느 CLI 인지 — 권한 adapter 종류로 판정한다.
 *
 * adapter 는 이미 2 CLI 별 클래스로 갈라져 있으므로 command 문자열을 다시
 * 해석하지 않는다 (windows 의 `claude.cmd` 같은 launcher shim 때문에 문자열
 * 판정은 어긋나기 쉽다).
 *
 * @throws {UnknownCliKindError} 2 종 adapter 중 어느 것도 아닐 때.
 */
export function resolveCliKind(
  adapter: CliPermissionAdapter | undefined,
  providerId: string,
): CliKind {
  if (adapter instanceof ClaudePermissionAdapter) return 'claude';
  if (adapter instanceof CodexPermissionAdapter) return 'codex';
  throw new UnknownCliKindError(providerId);
}

/**
 * 사유 로그를 한 workspace 당 한 번만 남기기 위한 기록장 (WP11c 항목 8).
 *
 * provider 하나가 소유한다. `applyChannelPermissionFilter` 자체는 매 turn
 * 불리므로, 여기 적힌 키와 이번 workspace 키가 같으면 다시 찍지 않는다.
 */
export interface PermissionFilterLogGuard {
  /** 마지막으로 사유를 남긴 workspace 키. 아직 없으면 null. */
  lastLoggedWorkspaceKey: string | null;
}

/** 새 기록장. provider 생성 시점에 하나 만들어 들고 있으면 된다. */
export function createPermissionFilterLogGuard(): PermissionFilterLogGuard {
  return { lastLoggedWorkspaceKey: null };
}

/**
 * 채널 권한으로 base argv 를 한 번 더 좁힌다.
 *
 * `permissions` 가 null 인 workspace (회의록 정리 / 메모리 reflection 처럼
 * 채널이 없는 호출) 와 consensus-only workspace 는 좁힐 근거가 없으므로 base
 * 를 그대로 쓴다.
 *
 * WP11c 항목 8 — 예전에는 *도구가 실제로 빠진 경우에만* 로그를 남겼다.
 * Codex 는 좁힐 플래그가 base argv 에 없어 언제나 무손상으로
 * 나오고 사유는 `cli_no_filter` 하나뿐이라, 두 CLI 의 spawn 은 로그에
 * 한 줄도 남지 않았다. "이 CLI 는 채널 권한을 argv 로 반영할 수 없다" 는
 * 사실이야말로 사용자가 알아야 할 것이라, 이제 filter 가 돌았으면 사유를
 * 언제나 남긴다.
 *
 * 다만 filter 는 매 turn 불린다. 그대로 두면 같은 문장이 대화마다 쌓여
 * 로그가 못 쓰게 되므로, workspace 키가 바뀔 때만 남긴다 — 키에는 프로젝트,
 * 경로, 권한 5 axis 가 모두 들어 있어 "권한 구성이 달라졌다" 와 같은 뜻이다.
 */
export function applyChannelPermissionFilter(input: {
  workspace: CliWorkspaceContext;
  baseArgs: string[];
  adapter: CliPermissionAdapter | undefined;
  providerId: string;
  /** 세션 격리 키. 사유 로그를 이 키가 바뀔 때만 남긴다. */
  workspaceKey?: string;
  /** provider 가 들고 있는 기록장. 없으면 사유를 매번 남긴다. */
  logGuard?: PermissionFilterLogGuard;
}): string[] {
  const { workspace, baseArgs, adapter, providerId, workspaceKey, logGuard } =
    input;
  if (workspace.scope !== 'project' || workspace.permissions === null) {
    return baseArgs;
  }

  const cliKind = resolveCliKind(adapter, providerId);
  const out = filterFlagsByChannelPermission({
    cliKind,
    baseFlags: baseArgs,
    permissions: workspace.permissions,
  });

  const key = workspaceKey ?? null;
  const alreadyLogged =
    logGuard !== undefined &&
    key !== null &&
    logGuard.lastLoggedWorkspaceKey === key;

  if (!alreadyLogged) {
    tryGetLogger()?.info({
      component: 'provider',
      action: 'cli-permission-filter',
      result: 'success',
      participantId: providerId,
      metadata: {
        cliKind,
        removedTools: out.filtered.removedTools,
        rationale: out.rationale,
      },
    });
    if (logGuard !== undefined && key !== null) {
      logGuard.lastLoggedWorkspaceKey = key;
    }
  }
  return out.flags;
}
