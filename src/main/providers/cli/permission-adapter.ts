/**
 * CLI Permission Adapter (Rolestra v3 / R2; refactored R10-Task5).
 *
 * Thin wrappers around the canonical {@link buildPermissionFlags} builder
 * (`src/main/permissions/permission-flag-builder.ts`). Prior to R10 each
 * adapter held an inline copy of spec §7.6.3's argv table; R10-Task5
 * consolidated all three CLI tables into a single matrix. These adapters
 * are kept as the call-site shim so existing `cli-provider.ts` /
 * `cli-prompt-builder.ts` / `permission-adapter.test.ts` paths remain
 * green without touching their snapshots.
 *
 * Guard rail: spec §7.3 forbids `projectKind='external' + permissionMode='auto'`.
 * The builder returns `{ blocked: true }` for that combination; this shim
 * preserves the historical `throw` contract that R1's live smoke matrix
 * baked into call sites by re-throwing on `blocked=true`.
 *
 * NOTE: The breaking-change marker on the v2 `buildReadOnlyArgs(projectPath,
 * consensusPath)` API still applies — call sites tagged `@ts-expect-error
 * R2-Task21` continue to use the v2 shape pending Task 21 cleanup.
 */

import type { CliKind } from '../../../shared/cli-types';
import type { PermissionMode, ProjectKind } from '../../../shared/project-types';
import {
  buildPermissionFlags,
  buildReadOnlyPermissionFlags,
} from '../../permissions/permission-flag-builder';

// Re-export for backwards compatibility with existing Main-side call sites;
// Task 17 will wire the shared `CliKind` into IPC schemas directly.
export type { CliKind };

export interface AdapterContext {
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  /** Absolute spawn cwd (project-scoped; see PermissionService.resolveForCli). */
  cwd: string;
  /** Absolute path to the arena consensus folder (granted R+W). */
  consensusPath: string;
  /**
   * R10-Task5 — settings 보안 탭의 "위험한 자율 모드" opt-in (spec §7.6.5).
   * 미지정 시 false. 기존 호출자는 모두 미지정이므로 회귀 0.
   */
  dangerousAutonomyOptIn?: boolean;
}

export interface CliPermissionAdapter {
  /** Main argv for the active permission mode (auto|hybrid|approval). */
  buildArgs(ctx: AdapterContext): string[];
  /** Argv for read-only observers/reviewers (ignores permissionMode). */
  buildReadOnlyArgs(ctx: AdapterContext): string[];
}

/**
 * spec §7.3 guard: `external` projects must never run in `auto` mode —
 * `auto` implies unrestricted write/exec and an external folder sits outside
 * the Rolestra root where our path-guard cannot follow.
 */
export function assertExternalNotAuto(ctx: AdapterContext): void {
  if (ctx.projectKind === 'external' && ctx.permissionMode === 'auto') {
    throw new Error('external project + auto mode is forbidden (spec §7.3)');
  }
}

function buildArgsViaBuilder(
  cliKind: CliKind,
  ctx: AdapterContext,
): string[] {
  // Defensive — the builder also returns blocked=true for this combo, but
  // historical adapter contract is to throw at the spawn boundary.
  assertExternalNotAuto(ctx);
  const out = buildPermissionFlags({
    cliKind,
    permissionMode: ctx.permissionMode,
    projectKind: ctx.projectKind,
    dangerousAutonomyOptIn: ctx.dangerousAutonomyOptIn ?? false,
    cwd: ctx.cwd,
    consensusPath: ctx.consensusPath,
  });
  if (out.blocked) {
    // Mirror the exact message the v2 adapter raised so any string match
    // assertions (test names, log filters) keep working.
    throw new Error('external project + auto mode is forbidden (spec §7.3)');
  }
  return out.flags;
}

export class ClaudePermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    return buildArgsViaBuilder('claude', ctx);
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return buildReadOnlyPermissionFlags({
      cliKind: 'claude',
      cwd: ctx.cwd,
      consensusPath: ctx.consensusPath,
    });
  }
}

export class CodexPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    return buildArgsViaBuilder('codex', ctx);
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return buildReadOnlyPermissionFlags({
      cliKind: 'codex',
      cwd: ctx.cwd,
      consensusPath: ctx.consensusPath,
    });
  }
}

export class GeminiPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    return buildArgsViaBuilder('gemini', ctx);
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return buildReadOnlyPermissionFlags({
      cliKind: 'gemini',
      cwd: ctx.cwd,
      consensusPath: ctx.consensusPath,
    });
  }
}
