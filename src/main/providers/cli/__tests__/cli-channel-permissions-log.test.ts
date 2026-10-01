/**
 * 채널 권한 filter 의 사유 로그 — WP11c 항목 8.
 *
 * 예전에는 *도구가 실제로 빠진 경우에만* 로그를 남겼다. Codex 와 Gemini 는
 * 좁힐 플래그가 base argv 에 없어 언제나 무손상으로 나오고 사유는
 * `cli_no_filter` 하나뿐이라, 두 CLI 의 spawn 은 로그에 한 줄도 남지
 * 않았다. "이 CLI 는 채널 권한을 argv 로 반영할 수 없다" 는 사실이야말로
 * 사용자가 알아야 하는데, 그것이 사라진 셈이다.
 *
 * 지금은 filter 가 돌았으면 사유를 언제나 남기되, filter 가 매 turn 도는
 * 것을 감안해 workspace 키가 바뀔 때만 남긴다.
 *
 * 로거는 가짜가 아니라 실제 StructuredLogger 를 쓴다 (파일 / 콘솔 출력만
 * 끈다) — 로그가 정말로 sink 에 닿는지 보려는 시험이라 sink 를 흉내 내면
 * 아무것도 지켜 주지 못한다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { absolutePathForTest } from '../../../../test-utils/absolute-path-helpers';
import {
  clearLoggerAccessor,
  setLoggerAccessor,
} from '../../../log/logger-accessor';
import { StructuredLogger } from '../../../log/structured-logger';
import {
  applyChannelPermissionFilter,
  createPermissionFilterLogGuard,
} from '../cli-channel-permissions';
import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
} from '../permission-adapter';
import type { PermissionSet } from '../../../../shared/permission-set-types';
import type { CliWorkspaceContext } from '../../../../shared/provider-types';

const ALL_ALLOWED: PermissionSet = {
  fileRead: true,
  fileWrite: true,
  commandExec: true,
  webSearch: true,
  dbRead: true,
};

function projectWorkspace(
  permissions: PermissionSet | null,
): CliWorkspaceContext {
  return {
    scope: 'project',
    projectId: 'p-1',
    cwd: absolutePathForTest('/tmp/rolestra-proj'),
    consensusPath: absolutePathForTest('/tmp/rolestra-consensus'),
    projectKind: 'new',
    permissionMode: 'hybrid',
    dangerousAutonomyOptIn: false,
    permissions,
  } as CliWorkspaceContext;
}

let logger: StructuredLogger;

beforeEach(() => {
  logger = new StructuredLogger({ console: false, level: 'debug' });
  setLoggerAccessor(() => logger);
});

afterEach(() => {
  clearLoggerAccessor();
});

function filterEntries(): ReturnType<StructuredLogger['getEntries']> {
  return logger
    .getEntries()
    .filter((e) => e.action === 'cli-permission-filter');
}

describe('cli-permission-filter 사유 로그 (WP11c 8)', () => {
  it('도구가 하나도 빠지지 않아도 사유를 남긴다 (Codex cli_no_filter)', () => {
    const guard = createPermissionFilterLogGuard();
    const args = applyChannelPermissionFilter({
      workspace: projectWorkspace(ALL_ALLOWED),
      baseArgs: ['exec', '--json'],
      adapter: new CodexPermissionAdapter(),
      providerId: 'codex-1',
      workspaceKey: 'key-a',
      logGuard: guard,
    });

    // argv 는 그대로다 — Codex 는 좁힐 플래그가 없다.
    expect(args).toEqual(['exec', '--json']);

    const entries = filterEntries();
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata as {
      cliKind: string;
      removedTools: string[];
      rationale: string[];
    };
    expect(meta.cliKind).toBe('codex');
    expect(meta.removedTools).toEqual([]);
    expect(meta.rationale).toContain(
      'permission.flag.filter.reason.cli_no_filter',
    );
  });

  it('같은 workspace 로 여러 turn 을 돌아도 한 번만 남긴다', () => {
    const guard = createPermissionFilterLogGuard();
    for (let turn = 0; turn < 5; turn += 1) {
      applyChannelPermissionFilter({
        workspace: projectWorkspace(ALL_ALLOWED),
        baseArgs: ['exec', '--json'],
        adapter: new CodexPermissionAdapter(),
        providerId: 'codex-1',
        workspaceKey: 'key-a',
        logGuard: guard,
      });
    }
    expect(filterEntries()).toHaveLength(1);
  });

  it('workspace 키가 바뀌면 다시 남긴다', () => {
    const guard = createPermissionFilterLogGuard();
    for (const key of ['key-a', 'key-a', 'key-b', 'key-b']) {
      applyChannelPermissionFilter({
        workspace: projectWorkspace(ALL_ALLOWED),
        baseArgs: ['exec', '--json'],
        adapter: new CodexPermissionAdapter(),
        providerId: 'codex-1',
        workspaceKey: key,
        logGuard: guard,
      });
    }
    expect(filterEntries()).toHaveLength(2);
  });

  it('도구가 빠진 경우도 그대로 사유와 목록을 남긴다', () => {
    const guard = createPermissionFilterLogGuard();
    applyChannelPermissionFilter({
      workspace: projectWorkspace({ ...ALL_ALLOWED, webSearch: false }),
      baseArgs: new ClaudePermissionAdapter().buildReadOnlyArgs({
        cwd: absolutePathForTest('/tmp/rolestra-proj'),
        consensusPath: absolutePathForTest('/tmp/rolestra-consensus'),
      }),
      adapter: new ClaudePermissionAdapter(),
      providerId: 'claude-1',
      workspaceKey: 'key-a',
      logGuard: guard,
    });

    const entries = filterEntries();
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata as {
      cliKind: string;
      rationale: string[];
    };
    expect(meta.cliKind).toBe('claude');
    expect(meta.rationale.length).toBeGreaterThan(0);
  });

  it('채널 권한이 없는 호출은 filter 자체를 돌지 않아 로그도 없다', () => {
    const guard = createPermissionFilterLogGuard();
    const args = applyChannelPermissionFilter({
      workspace: projectWorkspace(null),
      baseArgs: ['exec', '--json'],
      adapter: new CodexPermissionAdapter(),
      providerId: 'codex-1',
      workspaceKey: 'key-a',
      logGuard: guard,
    });
    expect(args).toEqual(['exec', '--json']);
    expect(filterEntries()).toHaveLength(0);
  });
});
