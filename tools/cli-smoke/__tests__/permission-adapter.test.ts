import { describe, it, expect } from 'vitest';
import { ClaudePermissionAdapter, CodexPermissionAdapter } from '../src/permission-adapter';
import type { CliKind, PermissionMode, ProjectKind } from '../src/types';

function ctx(over: Partial<{
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  cwd: string;
  consensusPath: string;
}> = {}) {
  return {
    cliKind: 'claude' as CliKind,
    permissionMode: 'hybrid' as PermissionMode,
    projectKind: 'new' as ProjectKind,
    cwd: '/tmp/proj',
    consensusPath: '/tmp/arena/consensus',
    ...over,
  };
}

describe('ClaudePermissionAdapter', () => {
  const a = new ClaudePermissionAdapter();

  it('auto: Bash 포함 전체 화이트리스트 + acceptEdits', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'auto' }));
    expect(args).toContain('--permission-mode');
    expect(args).toContain('acceptEdits');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toContain('Bash');
  });

  it('hybrid: Bash 제외된 화이트리스트', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'hybrid' }));
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).not.toContain('Bash');
    expect(args[idx + 1]).toContain('Edit');
  });

  it('approval: default mode + 최소 도구', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'approval' }));
    expect(args).toContain('default');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).not.toContain('Edit');
    expect(args[idx + 1]).toContain('Read');
  });

  it('external + auto는 throw', () => {
    expect(() => a.buildArgs(ctx({ permissionMode: 'auto', projectKind: 'external' }))).toThrow(/external/i);
  });
});

describe('CodexPermissionAdapter', () => {
  const a = new CodexPermissionAdapter();

  it('auto: danger-full-access sandbox', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'auto' }));
    expect(args).toEqual([
      'exec', '-a', 'never', '--sandbox', 'danger-full-access',
      '-C', '/tmp/proj', '--skip-git-repo-check', '-',
    ]);
  });

  it('hybrid: --full-auto alias', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'hybrid' }));
    expect(args).toEqual(['exec', '--full-auto', '-C', '/tmp/proj', '-']);
  });

  it('approval: on-failure workspace-write', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'approval' }));
    expect(args).toEqual(['exec', '-a', 'on-failure', '--sandbox', 'workspace-write', '-C', '/tmp/proj', '-']);
  });

  it('read-only sandbox', () => {
    const args = a.buildReadOnlyArgs(ctx({ cliKind: 'codex' }));
    expect(args).toEqual(['exec', '-a', 'never', '--sandbox', 'read-only', '-C', '/tmp/proj', '-']);
  });
});
