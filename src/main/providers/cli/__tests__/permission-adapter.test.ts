import { describe, it, expect } from 'vitest';
import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
  GeminiPermissionAdapter,
  assertExternalNotAuto,
  type AdapterContext,
} from '../permission-adapter';
import type { PermissionMode, ProjectKind } from '../../../../shared/project-types';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
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

  // round2.6 fix — `-a` / `--sandbox` 는 *상위* codex 옵션 (subcommand 앞).
  // `codex exec -a ...` 는 codex-cli 0.125+ 가 unexpected 로 거부.
  it('auto: -a never --sandbox danger-full-access exec -C cwd --skip-git-repo-check --json', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'auto' }));
    expect(args).toEqual([
      '-a', 'never', '--sandbox', 'danger-full-access',
      'exec', '-C', '/tmp/proj', '--skip-git-repo-check', '--json',
    ]);
  });

  it('hybrid: exec -C cwd --full-auto --json', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'hybrid' }));
    expect(args).toEqual(['exec', '-C', '/tmp/proj', '--full-auto', '--json']);
  });

  it('approval: -a on-failure --sandbox workspace-write exec -C cwd --json', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'approval' }));
    expect(args).toEqual([
      '-a', 'on-failure', '--sandbox', 'workspace-write',
      'exec', '-C', '/tmp/proj', '--json',
    ]);
  });

  it('buildReadOnlyArgs: -a never --sandbox read-only exec -C cwd --json', () => {
    const args = a.buildReadOnlyArgs(ctx());
    expect(args).toEqual([
      '-a', 'never', '--sandbox', 'read-only',
      'exec', '-C', '/tmp/proj', '--json',
    ]);
  });

  it('external + auto throws', () => {
    expect(() =>
      a.buildArgs(ctx({ permissionMode: 'auto', projectKind: 'external' })),
    ).toThrow(/external/i);
  });
});

describe('GeminiPermissionAdapter', () => {
  const a = new GeminiPermissionAdapter();

  it('auto: yolo', () => {
    expect(a.buildArgs(ctx({ permissionMode: 'auto' })))
      .toEqual(['--approval-mode', 'yolo']);
  });

  it('hybrid: auto_edit', () => {
    expect(a.buildArgs(ctx({ permissionMode: 'hybrid' })))
      .toEqual(['--approval-mode', 'auto_edit']);
  });

  it('approval: default', () => {
    expect(a.buildArgs(ctx({ permissionMode: 'approval' })))
      .toEqual(['--approval-mode', 'default']);
  });

  it('buildReadOnlyArgs: default', () => {
    expect(a.buildReadOnlyArgs(ctx()))
      .toEqual(['--approval-mode', 'default']);
  });

  it('external + auto throws', () => {
    expect(() =>
      a.buildArgs(ctx({ permissionMode: 'auto', projectKind: 'external' })),
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
