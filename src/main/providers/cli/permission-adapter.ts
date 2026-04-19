/**
 * CLI Permission Adapter (Rolestra v3 / R2).
 *
 * Ported from `tools/cli-smoke/src/permission-adapter.ts` — proven by the R1
 * live smoke matrix (13/18). Produces CLI-specific argv for each
 * (cliKind × permissionMode) cell plus a separate read-only argv used by
 * observers/reviewers.
 *
 * Guard rail: spec §7.3 forbids `projectKind='external' + permissionMode='auto'`
 * because `auto` grants destructive rights and external paths are outside the
 * Rolestra root. Call {@link assertExternalNotAuto} at the top of each adapter.
 *
 * NOTE: This is an intentional breaking change from the v2 API
 * (`buildReadOnlyArgs(projectPath, consensusPath)` + system-prompt helpers).
 * Call sites that still use the v2 shape are marked `@ts-expect-error
 * R2-Task21` and will be migrated in Task 21.
 */

import type { CliKind } from '../../../shared/cli-types';
import type { PermissionMode, ProjectKind } from '../../../shared/project-types';

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
}

export interface CliPermissionAdapter {
  /** Main argv for the active permission mode (auto|hybrid|approval). */
  buildArgs(ctx: AdapterContext): string[];
  /** Argv for read-only observers/reviewers (ignores permissionMode). */
  buildReadOnlyArgs(ctx: AdapterContext): string[];
}

/**
 * Spec §7.3 guard: `external` projects must never run in `auto` mode —
 * `auto` implies unrestricted write/exec and an external folder sits outside
 * the Rolestra root where our path-guard cannot follow.
 */
export function assertExternalNotAuto(ctx: AdapterContext): void {
  if (ctx.projectKind === 'external' && ctx.permissionMode === 'auto') {
    throw new Error('external project + auto mode is forbidden (spec §7.3)');
  }
}

// Claude Code tool whitelists — kept verbatim from R1 so the matrix stays
// identical to what the live smoke runner validated.
const CLAUDE_AUTO_TOOLS = 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch';
const CLAUDE_HYBRID_TOOLS = 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch';
const CLAUDE_READONLY_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';

export class ClaudePermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':
        return [
          '--permission-mode', 'acceptEdits',
          '--allowedTools', CLAUDE_AUTO_TOOLS,
          '--add-dir', ctx.consensusPath,
        ];
      case 'hybrid':
        return [
          '--permission-mode', 'acceptEdits',
          '--allowedTools', CLAUDE_HYBRID_TOOLS,
          '--add-dir', ctx.consensusPath,
        ];
      case 'approval':
        return [
          '--allowedTools', CLAUDE_READONLY_TOOLS,
          '--permission-mode', 'default',
          '--add-dir', ctx.consensusPath,
        ];
    }
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return [
      '--allowedTools', CLAUDE_READONLY_TOOLS,
      '--permission-mode', 'default',
      '--add-dir', ctx.consensusPath,
    ];
  }
}

export class CodexPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':
        return ['exec', '-a', 'never', '--sandbox', 'danger-full-access', '-C', ctx.cwd, '--skip-git-repo-check', '-'];
      case 'hybrid':
        return ['exec', '--full-auto', '-C', ctx.cwd, '-'];
      case 'approval':
        return ['exec', '-a', 'on-failure', '--sandbox', 'workspace-write', '-C', ctx.cwd, '-'];
    }
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return ['exec', '-a', 'never', '--sandbox', 'read-only', '-C', ctx.cwd, '-'];
  }
}

export class GeminiPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':    return ['--approval-mode', 'yolo'];
      case 'hybrid':  return ['--approval-mode', 'auto_edit'];
      case 'approval': return ['--approval-mode', 'default'];
    }
  }

  buildReadOnlyArgs(_ctx: AdapterContext): string[] {
    return ['--approval-mode', 'default'];
  }
}
