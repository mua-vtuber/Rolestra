/**
 * PermissionFlagBuilder 매트릭스 — R10-Task5.
 *
 * spec §7.6.3 표를 기준 데이터로 두고 `buildPermissionFlags` 의 출력이
 * 표와 1:1 동일함을 보장한다. 27 happy-path (3 CLI × 3 mode × 3 project
 * kind, dangerousAutonomyOptIn=false) + 6 dangerous opt-in flips +
 * 6 rejection cases (external+auto for each CLI × {opt-in true/false}) +
 * read-only helper 3 cases.
 */

import { describe, it, expect } from 'vitest';
import type { CliKind } from '../../../shared/cli-types';
import type {
  PermissionMode,
  ProjectKind,
} from '../../../shared/project-types';
import {
  buildPermissionFlags,
  buildReadOnlyPermissionFlags,
  type PermissionFlagBuilderInput,
} from '../permission-flag-builder';

const CWD = '/tmp/proj';
const CONSENSUS = '/tmp/arena/consensus';

function input(
  over: Partial<PermissionFlagBuilderInput> = {},
): PermissionFlagBuilderInput {
  return {
    cliKind: 'claude',
    permissionMode: 'hybrid',
    projectKind: 'new',
    dangerousAutonomyOptIn: false,
    cwd: CWD,
    consensusPath: CONSENSUS,
    ...over,
  };
}

// ── Expected argv per spec §7.6.3 (정본) ────────────────────────────

const CLAUDE_AUTO = [
  '--permission-mode',
  'acceptEdits',
  '--allowedTools',
  'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch',
  '--add-dir',
  CONSENSUS,
];
const CLAUDE_HYBRID = [
  '--permission-mode',
  'acceptEdits',
  '--allowedTools',
  'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch',
  '--add-dir',
  CONSENSUS,
];
const CLAUDE_APPROVAL = [
  '--allowedTools',
  'Read,Glob,Grep,WebSearch,WebFetch',
  '--permission-mode',
  'default',
  '--add-dir',
  CONSENSUS,
];

// round2.6 fix — codex-cli 0.125+ 매트릭스. `-a` / `--sandbox` 는 *상위* 옵션
// (subcommand 앞), `-C` / `--full-auto` / `--skip-git-repo-check` /
// `--dangerously-bypass-approvals-and-sandbox` / `--json` 은 *exec* 서브커맨드
// 옵션. `-` stdin marker 는 사용하지 않음 (`codex-config.ts` round2.5 와 일관).
const CODEX_AUTO = [
  '-a',
  'never',
  '--sandbox',
  'danger-full-access',
  'exec',
  '-C',
  CWD,
  '--skip-git-repo-check',
  '--json',
];
const CODEX_HYBRID = ['exec', '-C', CWD, '--full-auto', '--json'];
const CODEX_APPROVAL = [
  '-a',
  'on-failure',
  '--sandbox',
  'workspace-write',
  'exec',
  '-C',
  CWD,
  '--json',
];

const GEMINI_AUTO = ['--approval-mode', 'yolo'];
const GEMINI_HYBRID = ['--approval-mode', 'auto_edit'];
const GEMINI_APPROVAL = ['--approval-mode', 'default'];

const EXPECT_BY_CLI_MODE: Record<
  CliKind,
  Record<PermissionMode, string[]>
> = {
  claude: {
    auto: CLAUDE_AUTO,
    hybrid: CLAUDE_HYBRID,
    approval: CLAUDE_APPROVAL,
  },
  codex: {
    auto: CODEX_AUTO,
    hybrid: CODEX_HYBRID,
    approval: CODEX_APPROVAL,
  },
  gemini: {
    auto: GEMINI_AUTO,
    hybrid: GEMINI_HYBRID,
    approval: GEMINI_APPROVAL,
  },
};

const ALL_CLIS: CliKind[] = ['claude', 'codex', 'gemini'];
const ALL_MODES: PermissionMode[] = ['auto', 'hybrid', 'approval'];
const ALL_KINDS: ProjectKind[] = ['new', 'external', 'imported'];

// ── 27 happy-path matrix (dangerousAutonomyOptIn=false) ────────────

describe('PermissionFlagBuilder — 3×3×3 happy-path matrix (opt-in=false)', () => {
  for (const cli of ALL_CLIS) {
    for (const mode of ALL_MODES) {
      for (const kind of ALL_KINDS) {
        // external + auto 는 reject 케이스에서 별도 검증
        if (kind === 'external' && mode === 'auto') continue;

        it(`${cli} × ${mode} × ${kind} → spec §7.6.3 매트릭스 그대로`, () => {
          const out = buildPermissionFlags(
            input({ cliKind: cli, permissionMode: mode, projectKind: kind }),
          );
          expect(out.blocked).toBe(false);
          expect(out.blockedReason).toBeNull();
          expect(out.flags).toEqual(EXPECT_BY_CLI_MODE[cli][mode]);
          expect(out.rationale.length).toBeGreaterThan(0);
        });
      }
    }
  }
});

// ── external + auto 거부 (CA-1/CA-3) — 3 CLI ────────────────────────

describe('PermissionFlagBuilder — external+auto rejection (spec §7.3 CA-1/CA-3)', () => {
  for (const cli of ALL_CLIS) {
    it(`${cli} × auto × external → blocked=true (opt-in=false)`, () => {
      const out = buildPermissionFlags(
        input({
          cliKind: cli,
          permissionMode: 'auto',
          projectKind: 'external',
          dangerousAutonomyOptIn: false,
        }),
      );
      expect(out.blocked).toBe(true);
      expect(out.blockedReason).toBe('external_auto_forbidden');
      expect(out.flags).toEqual([]);
    });

    it(`${cli} × auto × external → blocked=true even with opt-in=true (no bypass)`, () => {
      const out = buildPermissionFlags(
        input({
          cliKind: cli,
          permissionMode: 'auto',
          projectKind: 'external',
          dangerousAutonomyOptIn: true,
        }),
      );
      expect(out.blocked).toBe(true);
      expect(out.blockedReason).toBe('external_auto_forbidden');
      expect(out.flags).toEqual([]);
    });
  }
});

// ── dangerousAutonomyOptIn=true flips (only auto + non-external) ────

describe('PermissionFlagBuilder — dangerousAutonomyOptIn=true flips (spec §7.6.5)', () => {
  it('claude + auto + new + opt-in=true → adds --dangerously-skip-permissions', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'claude',
        permissionMode: 'auto',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.blocked).toBe(false);
    expect(out.flags).toContain('--dangerously-skip-permissions');
    // 화이트리스트 + acceptEdits 는 그대로 유지
    expect(out.flags.slice(0, 6)).toEqual(CLAUDE_AUTO);
    expect(out.flags[6]).toBe('--dangerously-skip-permissions');
  });

  it('claude + hybrid + new + opt-in=true → opt-in 무시 (auto 만 적용)', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'claude',
        permissionMode: 'hybrid',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.flags).not.toContain('--dangerously-skip-permissions');
    expect(out.flags).toEqual(CLAUDE_HYBRID);
  });

  it('claude + approval + new + opt-in=true → opt-in 무시', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'claude',
        permissionMode: 'approval',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.flags).not.toContain('--dangerously-skip-permissions');
    expect(out.flags).toEqual(CLAUDE_APPROVAL);
  });

  it('codex + auto + new + opt-in=true → --dangerously-bypass-approvals-and-sandbox alias', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'codex',
        permissionMode: 'auto',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.blocked).toBe(false);
    expect(out.flags).toEqual([
      'exec',
      '-C',
      CWD,
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
    ]);
  });

  it('codex + hybrid + new + opt-in=true → opt-in 무시 (--full-auto 그대로)', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'codex',
        permissionMode: 'hybrid',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.flags).toEqual(CODEX_HYBRID);
  });

  it('gemini + auto + new + opt-in=true → flags 동일 (yolo 가 이미 최대)', () => {
    const out = buildPermissionFlags(
      input({
        cliKind: 'gemini',
        permissionMode: 'auto',
        projectKind: 'new',
        dangerousAutonomyOptIn: true,
      }),
    );
    expect(out.flags).toEqual(GEMINI_AUTO);
    // rationale 에는 dangerous_opt_in 키가 추가되어야 한다 (UI 가 표시할 정보)
    expect(out.rationale).toContain(
      'permission.flag.reason.dangerous_opt_in',
    );
  });
});

// ── 27 happy-path × opt-in=true (전체 매트릭스 회귀 — 기본 mode 가 변하지 않음 보증) ──

describe('PermissionFlagBuilder — opt-in=true 27 cases (only auto-mode flags shift)', () => {
  for (const cli of ALL_CLIS) {
    for (const mode of ALL_MODES) {
      for (const kind of ALL_KINDS) {
        if (kind === 'external' && mode === 'auto') continue; // rejected
        it(`${cli} × ${mode} × ${kind} (opt-in=true)`, () => {
          const out = buildPermissionFlags(
            input({
              cliKind: cli,
              permissionMode: mode,
              projectKind: kind,
              dangerousAutonomyOptIn: true,
            }),
          );
          expect(out.blocked).toBe(false);
          if (mode === 'auto' && cli === 'claude') {
            expect(out.flags).toContain('--dangerously-skip-permissions');
          } else if (mode === 'auto' && cli === 'codex') {
            expect(out.flags).toContain(
              '--dangerously-bypass-approvals-and-sandbox',
            );
          } else {
            // gemini auto + non-auto 모드는 baseline 그대로
            expect(out.flags).toEqual(EXPECT_BY_CLI_MODE[cli][mode]);
          }
        });
      }
    }
  }
});

// ── rationale 검사 ───────────────────────────────────────────────

describe('PermissionFlagBuilder — rationale i18n keys', () => {
  it('rationale 는 항상 1개 이상의 i18n key 를 가진다', () => {
    for (const cli of ALL_CLIS) {
      for (const mode of ALL_MODES) {
        const out = buildPermissionFlags(
          input({ cliKind: cli, permissionMode: mode, projectKind: 'new' }),
        );
        expect(out.rationale.length).toBeGreaterThanOrEqual(1);
        for (const key of out.rationale) {
          expect(key).toMatch(/^permission\.flag\.reason\./);
        }
      }
    }
  });
});

// ── read-only helper ────────────────────────────────────────────

describe('buildReadOnlyPermissionFlags', () => {
  it('claude → Read/Glob/Grep + default + add-dir', () => {
    expect(
      buildReadOnlyPermissionFlags({
        cliKind: 'claude',
        cwd: CWD,
        consensusPath: CONSENSUS,
      }),
    ).toEqual([
      '--allowedTools',
      'Read,Glob,Grep,WebSearch,WebFetch',
      '--permission-mode',
      'default',
      '--add-dir',
      CONSENSUS,
    ]);
  });

  it('codex → -a never --sandbox read-only exec -C cwd --json (round2.6 옵션 위치 fix)', () => {
    expect(
      buildReadOnlyPermissionFlags({
        cliKind: 'codex',
        cwd: CWD,
        consensusPath: CONSENSUS,
      }),
    ).toEqual([
      '-a',
      'never',
      '--sandbox',
      'read-only',
      'exec',
      '-C',
      CWD,
      '--json',
    ]);
  });

  it('gemini → --approval-mode default (native read-only 모드 없음 — spec §7.6.3 footnote)', () => {
    expect(
      buildReadOnlyPermissionFlags({
        cliKind: 'gemini',
        cwd: CWD,
        consensusPath: CONSENSUS,
      }),
    ).toEqual(['--approval-mode', 'default']);
  });
});
