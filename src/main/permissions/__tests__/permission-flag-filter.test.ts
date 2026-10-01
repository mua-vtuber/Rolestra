/**
 * permission-flag-filter 단위 테스트 — R12-W T11.
 *
 * 검증 대상은 "채널 권한이 실제 spawn argv 를 좁히는가" 하나다. 회의 turn
 * 은 항상 읽기 전용 base argv 로 뜨므로 (controller ruling R5), 여기서도
 * 정본 base 는 `buildReadOnlyPermissionFlags({cliKind:'claude'})` 를 그대로
 * 쓴다 — 표를 다시 손으로 적어두면 base 표가 바뀌었을 때 시험만 통과하는
 * 죽은 시험이 된다.
 */

import { describe, it, expect } from 'vitest';
import { filterFlagsByChannelPermission } from '../permission-flag-filter';
import { buildReadOnlyPermissionFlags } from '../permission-flag-builder';
import type { PermissionSet } from '../../../shared/permission-set-types';
import { catalogDefaultFor } from '../../../shared/permission-set-types';

const CWD = '/arena/projects/pr-1';
const CONSENSUS = '/arena/consensus';

function claudeBase(): string[] {
  return buildReadOnlyPermissionFlags({
    cliKind: 'claude',
    cwd: CWD,
    consensusPath: CONSENSUS,
  });
}

function perms(over: Partial<PermissionSet> = {}): PermissionSet {
  return {
    fileRead: true,
    fileWrite: true,
    commandExec: true,
    webSearch: true,
    dbRead: true,
    ...over,
  };
}

/** argv 에서 `<flag> <value>` 쌍의 값만 뽑는다. 없으면 null. */
function valueOf(flags: string[], flag: string): string | null {
  const idx = flags.indexOf(flag);
  if (idx < 0 || idx + 1 >= flags.length) return null;
  return flags[idx + 1] ?? null;
}

describe('filterFlagsByChannelPermission — Claude', () => {
  it('모든 axis 가 true 면 base 를 그대로 돌려준다 (넓히지 않음)', () => {
    const base = claudeBase();
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: base,
      permissions: perms(),
    });

    expect(out.flags).toEqual(base);
    expect(out.flags).not.toContain('--disallowedTools');
    expect(out.filtered.removedTools).toEqual([]);
    expect(out.rationale).toEqual([]);
  });

  it('fileRead=false 면 Read/Glob/Grep 이 빠지고 disallowed 로 명시된다', () => {
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: perms({ fileRead: false }),
    });

    expect(valueOf(out.flags, '--allowedTools')).toBe('WebSearch,WebFetch');
    expect(valueOf(out.flags, '--disallowedTools')).toBe('Read,Glob,Grep');
    expect(out.filtered.removedTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(out.rationale).toEqual([
      'permission.flag.filter.reason.removed_by_channel_permission',
    ]);
  });

  it('webSearch=false 면 WebSearch/WebFetch 만 빠진다', () => {
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: perms({ webSearch: false }),
    });

    expect(valueOf(out.flags, '--allowedTools')).toBe('Read,Glob,Grep');
    expect(valueOf(out.flags, '--disallowedTools')).toBe('WebSearch,WebFetch');
  });

  it('모든 axis 가 false 면 --allowedTools 자체를 빼고 5 도구 전부 disallowed', () => {
    // 권한을 모두 끈 채널 (예: general 부서) 이 오히려 "지정 없음 = 전체
    // 허용" 으로 읽히는 역전을 막는 fail-closed 경로.
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: perms({
        fileRead: false,
        fileWrite: false,
        commandExec: false,
        webSearch: false,
        dbRead: false,
      }),
    });

    expect(out.flags).not.toContain('--allowedTools');
    expect(valueOf(out.flags, '--disallowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
    // 나머지 플래그는 손대지 않는다.
    expect(valueOf(out.flags, '--permission-mode')).toBe('default');
    expect(valueOf(out.flags, '--add-dir')).toBe(CONSENSUS);
  });

  it('general 부서의 카탈로그 default (권한 없음) 도 같은 fail-closed 결과', () => {
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: catalogDefaultFor('general'),
    });

    expect(out.flags).not.toContain('--allowedTools');
    expect(valueOf(out.flags, '--disallowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
  });

  it('implement 부서 default 는 웹 검색만 빠진다', () => {
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: catalogDefaultFor('implement'),
    });

    expect(valueOf(out.flags, '--allowedTools')).toBe('Read,Glob,Grep');
    expect(valueOf(out.flags, '--disallowedTools')).toBe('WebSearch,WebFetch');
  });

  it('idea 부서 default 는 base 무손상 (읽기 + 웹 검색 모두 허용)', () => {
    const base = claudeBase();
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: base,
      permissions: catalogDefaultFor('idea'),
    });

    expect(out.flags).toEqual(base);
    expect(out.filtered.removedTools).toEqual([]);
  });

  it('매핑에 없는 도구는 권한과 무관하게 남는다', () => {
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: ['--allowedTools', 'Read,TodoWrite', '--permission-mode', 'default'],
      permissions: perms({ fileRead: false }),
    });

    expect(valueOf(out.flags, '--allowedTools')).toBe('TodoWrite');
    expect(valueOf(out.flags, '--disallowedTools')).toBe('Read');
  });

  it('base 에 --allowedTools 가 없으면 아무것도 하지 않는다', () => {
    const base = ['--permission-mode', 'default', '--add-dir', CONSENSUS];
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: base,
      permissions: perms({ fileRead: false, webSearch: false }),
    });

    expect(out.flags).toEqual(base);
    expect(out.flags).not.toContain('--disallowedTools');
    expect(out.filtered.removedTools).toEqual([]);
    expect(out.rationale).toEqual([]);
  });

  it('--allowedTools 가 마지막 토큰이라 값이 없으면 손대지 않는다', () => {
    const base = ['--permission-mode', 'default', '--allowedTools'];
    const out = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: base,
      permissions: perms({ fileRead: false }),
    });

    expect(out.flags).toEqual(base);
  });

  it('입력 배열을 제자리에서 바꾸지 않는다', () => {
    const base = claudeBase();
    const snapshot = [...base];
    filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: base,
      permissions: perms({ fileRead: false }),
    });
    expect(base).toEqual(snapshot);
  });

  it('결과를 다시 filter 해도 그대로다 (idempotent)', () => {
    const once = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: perms({ fileRead: false }),
    });
    const twice = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: once.flags,
      permissions: perms({ fileRead: false }),
    });

    expect(twice.flags).toEqual(once.flags);
    expect(twice.filtered.removedTools).toEqual([]);
  });

  it('전부 제외된 결과를 다시 filter 해도 --allowedTools 가 되살아나지 않는다', () => {
    const none = perms({
      fileRead: false,
      fileWrite: false,
      commandExec: false,
      webSearch: false,
      dbRead: false,
    });
    const once = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: claudeBase(),
      permissions: none,
    });
    const twice = filterFlagsByChannelPermission({
      cliKind: 'claude',
      baseFlags: once.flags,
      permissions: none,
    });

    expect(twice.flags).toEqual(once.flags);
  });
});

describe('filterFlagsByChannelPermission — Codex', () => {
  it('Codex base 는 무손상 + cli_no_filter 사유 1개', () => {
    const base = buildReadOnlyPermissionFlags({
      cliKind: 'codex',
      cwd: CWD,
      consensusPath: CONSENSUS,
    });
    const out = filterFlagsByChannelPermission({
      cliKind: 'codex',
      baseFlags: base,
      permissions: perms({ fileRead: false, webSearch: false }),
    });

    expect(out.flags).toEqual(base);
    expect(out.rationale).toEqual([
      'permission.flag.filter.reason.cli_no_filter',
    ]);
    expect(out.filtered.removedTools).toEqual([]);
  });

});
