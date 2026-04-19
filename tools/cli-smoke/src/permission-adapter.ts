import type { CliKind, PermissionMode, ProjectKind } from './types';

export interface AdapterContext {
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  cwd: string;
  consensusPath: string;
}

export interface CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[];
  buildReadOnlyArgs(ctx: AdapterContext): string[];
}

export function assertExternalNotAuto(ctx: AdapterContext): void {
  if (ctx.projectKind === 'external' && ctx.permissionMode === 'auto') {
    throw new Error('external project + auto mode is forbidden (spec §7.3)');
  }
}

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
