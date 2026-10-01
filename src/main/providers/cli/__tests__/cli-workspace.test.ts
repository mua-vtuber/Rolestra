/**
 * CLI workspace 조립 — R12-X T4.
 *
 * 두 factory 가 workspace 를 만드는 유일한 진입점이다. 여기서 상대 경로를
 * 통과시키면 그 값이 그대로 spawn cwd 가 되므로, 절대경로 검증이 반드시
 * 걸려야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  consensusOnlyCliWorkspace,
  projectCliWorkspace,
  CliWorkspaceRequiredError,
  WorkerModeRequiresProjectError,
} from '../cli-workspace';
import {
  AbsolutePathError,
  asAbsolutePath,
} from '../../../../shared/absolute-path';
import type { Project } from '../../../../shared/project-types';
import type { PermissionSet } from '../../../../shared/permission-set-types';

/** R12-W T12 — 채널 권한 5 axis 는 factory 가 그대로 담아야 한다. */
const PERMISSIONS: PermissionSet = {
  fileRead: true,
  fileWrite: false,
  commandExec: false,
  webSearch: true,
  dbRead: true,
};

const PROJECT: Project = {
  id: 'pr-1',
  slug: 'alpha',
  name: 'Alpha',
  description: '',
  kind: 'external',
  externalLink: '/real/alpha',
  permissionMode: 'approval',
  autonomyMode: 'manual',
  status: 'active',
  createdAt: 1,
  archivedAt: null,
};

describe('projectCliWorkspace', () => {
  it('resolveForCli 결과를 project scope workspace 로 옮겨 담는다', () => {
    expect(
      projectCliWorkspace(
        {
          cwd: asAbsolutePath('/arena/projects/alpha/link', 'test.cwd'),
          consensusPath: asAbsolutePath('/arena/consensus', 'test.consensusPath'),
          project: PROJECT,
        },
        PERMISSIONS,
      ),
    ).toEqual({
      scope: 'project',
      cwd: '/arena/projects/alpha/link',
      consensusPath: '/arena/consensus',
      projectId: 'pr-1',
      projectKind: 'external',
      permissionMode: 'approval',
      permissions: PERMISSIONS,
    });
  });

  it('permissions=null 은 채널 권한으로 좁히지 않는다는 뜻으로 그대로 담긴다', () => {
    // 회의록 정리 / 메모리 reflection 처럼 채널이 없는 호출 경로.
    const out = projectCliWorkspace(
      {
        cwd: asAbsolutePath('/arena/projects/alpha/link', 'test.cwd'),
        consensusPath: asAbsolutePath('/arena/consensus', 'test.consensusPath'),
        project: PROJECT,
      },
      null,
    );
    expect(out.permissions).toBeNull();
  });

  // R12-X T2: 상대 cwd / 빈 consensusPath 는 여기까지 오지 못한다.
  // `resolveForCli` 반환 타입이 `AbsolutePath` 로 좁혀졌고, 그 값을 만드는
  // 경계 (`ArenaRootService` 생성자의 settings / env 해석) 가 `asAbsolutePath`
  // 로 이미 걸러낸다. 예전에 여기 있던 두 거부 케이스는 그 경계 테스트
  // (`arena-root-service.test.ts`) 로 옮겨졌다 — 조립 단계에서 같은 검사를
  // 한 번 더 돌리면 검증 실패 지점이 사고 원인에서 멀어진다.
});

describe('consensusOnlyCliWorkspace', () => {
  it('cwd 와 consensusPath 가 같고 projectId 는 null', () => {
    expect(consensusOnlyCliWorkspace('/arena/consensus')).toEqual({
      scope: 'consensus-only',
      cwd: '/arena/consensus',
      consensusPath: '/arena/consensus',
      projectId: null,
    });
  });

  it('Windows 절대경로도 통과한다', () => {
    const ws = consensusOnlyCliWorkspace('C:\\Users\\taniar\\Documents\\Rolestra');
    expect(ws.cwd).toBe('C:\\Users\\taniar\\Documents\\Rolestra');
  });

  it('빈 경로는 거부한다', () => {
    expect(() => consensusOnlyCliWorkspace('')).toThrow(AbsolutePathError);
  });
});

describe('오류 타입', () => {
  it('CliWorkspaceRequiredError 는 provider id 를 담는다', () => {
    const err = new CliWorkspaceRequiredError('claude-cli');
    expect(err.providerId).toBe('claude-cli');
    expect(err.message).toContain('claude-cli');
  });

  it('WorkerModeRequiresProjectError 는 scope 이유를 담는다', () => {
    const err = new WorkerModeRequiresProjectError('codex-cli');
    expect(err.providerId).toBe('codex-cli');
    expect(err.message).toContain('consensus-only');
  });
});
