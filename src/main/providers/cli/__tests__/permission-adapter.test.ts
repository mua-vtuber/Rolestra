import { describe, it, expect } from 'vitest';
import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
  GeminiPermissionAdapter,
  assertExternalNotAuto,
  type AdapterContext,
  type CliKind,
} from '../permission-adapter';
import type { PermissionMode, ProjectKind } from '../../../../shared/project-types';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
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

  it('auto: acceptEdits + full whitelist including Bash + consensus add-dir', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'auto' }));
    expect(args).toEqual([
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch',
      '--add-dir', '/tmp/arena/consensus',
    ]);
  });

  it('hybrid: acceptEdits + whitelist excludes Bash', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'hybrid' }));
    expect(args).toEqual([
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch',
      '--add-dir', '/tmp/arena/consensus',
    ]);
  });

  it('approval: default mode + readonly whitelist', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'approval' }));
    expect(args).toEqual([
      '--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch',
      '--permission-mode', 'default',
      '--add-dir', '/tmp/arena/consensus',
    ]);
  });

  it('buildReadOnlyArgs: default mode + readonly whitelist', () => {
    const args = a.buildReadOnlyArgs(ctx());
    expect(args).toEqual([
      '--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch',
      '--permission-mode', 'default',
      '--add-dir', '/tmp/arena/consensus',
    ]);
  });

  it('external + auto throws', () => {
    expect(() =>
      a.buildArgs(ctx({ permissionMode: 'auto', projectKind: 'external' })),
    ).toThrow(/external/i);
  });
});

describe('CodexPermissionAdapter', () => {
  const a = new CodexPermissionAdapter();

  it('auto: danger-full-access sandbox with skip-git-repo-check', () => {
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

  it('approval: on-failure + workspace-write', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'approval' }));
    expect(args).toEqual([
      'exec', '-a', 'on-failure', '--sandbox', 'workspace-write',
      '-C', '/tmp/proj', '-',
    ]);
  });

  it('buildReadOnlyArgs: read-only sandbox', () => {
    const args = a.buildReadOnlyArgs(ctx({ cliKind: 'codex' }));
    expect(args).toEqual([
      'exec', '-a', 'never', '--sandbox', 'read-only', '-C', '/tmp/proj', '-',
    ]);
  });

  it('external + auto throws', () => {
    expect(() =>
      a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'auto', projectKind: 'external' })),
    ).toThrow(/external/i);
  });
});

describe('GeminiPermissionAdapter', () => {
  const a = new GeminiPermissionAdapter();

  it('auto: yolo', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'auto' })))
      .toEqual(['--approval-mode', 'yolo']);
  });

  it('hybrid: auto_edit', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'hybrid' })))
      .toEqual(['--approval-mode', 'auto_edit']);
  });

  it('approval: default', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'approval' })))
      .toEqual(['--approval-mode', 'default']);
  });

  it('buildReadOnlyArgs: default', () => {
    expect(a.buildReadOnlyArgs(ctx({ cliKind: 'gemini' })))
      .toEqual(['--approval-mode', 'default']);
  });

  it('external + auto throws', () => {
    expect(() =>
      a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'auto', projectKind: 'external' })),
    ).toThrow(/external/i);
  });
});

describe('assertExternalNotAuto', () => {
  it('throws with message mentioning "external" and "auto" and "§7.3"', () => {
    try {
      assertExternalNotAuto(ctx({ permissionMode: 'auto', projectKind: 'external' }));
      throw new Error('expected assertExternalNotAuto to throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/external/i);
      expect(msg).toMatch(/auto/i);
      expect(msg).toContain('§7.3');
    }
  });

  it('does not throw for external + approval', () => {
    expect(() =>
      assertExternalNotAuto(ctx({ permissionMode: 'approval', projectKind: 'external' })),
    ).not.toThrow();
  });

  it('does not throw for new + auto', () => {
    expect(() =>
      assertExternalNotAuto(ctx({ permissionMode: 'auto', projectKind: 'new' })),
    ).not.toThrow();
  });
});
