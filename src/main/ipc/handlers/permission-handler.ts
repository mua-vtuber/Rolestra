/**
 * permission-handler — R11 surface
 *
 * The v2 runtime-permission flow (`permission:list-pending` / `:approve` /
 * `:reject` / `:list-rules`) was retired by R11-Task2: every CLI permission
 * prompt now flows through {@link ApprovalService} (`approval:list` +
 * `approval:decide`, R7-Task3+). The four IPC channels and the
 * `requestPermissionApproval` / `setPermissionWebContents` /
 * `setPermissionServiceAccessor` plumbing they relied on are gone with the
 * v2 conversation engine.
 *
 * What stays here is the R10-Task5 `permission:dry-run-flags` preview —
 * a server-side `PermissionFlagBuilder` invocation used by the Settings
 * 보안 탭 to show what argv a given (provider × mode × project × opt-in)
 * combination would receive. No process spawn, just builder output.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import {
  buildPermissionFlags,
  type PermissionFlagBuilderInput,
} from '../../permissions/permission-flag-builder';
import type { CliKind } from '../../../shared/cli-types';
import type { PermissionFlagOutput } from '../../../shared/permission-flag-types';
import { consensusFolderService } from './workspace-handler';

/**
 * spec §7.6 의 PermissionService 가 plug 가능한 ProjectService 를 넘기는
 * 미래를 대비해 cwd resolver 를 lazy-injectable 로 둔다. 미주입 시 빈
 * 문자열을 사용 — Codex `-C ''` 가 발생할 수 있어 dry-run 응답의 flags 만
 * 참고 용도로 쓰도록 frontend 에 명시. R10 은 dry-run UI 한정.
 */
let projectCwdResolver: (() => string) | null = null;

/** Inject the resolver for project cwd (called from main bootstrap). */
export function setDryRunProjectCwdResolver(fn: () => string): void {
  projectCwdResolver = fn;
}

/**
 * Map the wire `providerType` (8 enum values) to the canonical CliKind
 * (`claude` | `codex` | `gemini`). Non-CLI provider types yield null —
 * the caller surfaces these as `unknown_provider_type`.
 */
function providerTypeToCliKind(providerType: string): CliKind | null {
  switch (providerType) {
    case 'claude_cli':
      return 'claude';
    case 'codex_cli':
      return 'codex';
    case 'gemini_cli':
      return 'gemini';
    default:
      return null;
  }
}

/** permission:dry-run-flags */
export function handlePermissionDryRunFlags(
  data: IpcRequest<'permission:dry-run-flags'>,
): IpcResponse<'permission:dry-run-flags'> {
  const cliKind = providerTypeToCliKind(data.providerType);
  if (!cliKind) {
    const blocked: PermissionFlagOutput = {
      flags: [],
      rationale: ['permission.flag.reason.unknown_provider_type'],
      blocked: true,
      blockedReason: 'unknown_provider_type',
    };
    return blocked;
  }

  const cwd = projectCwdResolver ? projectCwdResolver() : '';
  const consensusPath = consensusFolderService.getFolderPath() ?? '';

  const builderInput: PermissionFlagBuilderInput = {
    cliKind,
    permissionMode: data.permissionMode,
    projectKind: data.projectKind,
    dangerousAutonomyOptIn: data.dangerousAutonomyOptIn,
    cwd,
    consensusPath,
  };

  return buildPermissionFlags(builderInput);
}
