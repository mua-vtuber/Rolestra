import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveProjectPaths } from '../src/resolve-project-paths';
import type { Project } from '../src/types';

const ARENA_ROOT = '/tmp/arena';
const baseProject: Project = {
  id: '00000000-0000-4000-8000-000000000000',
  slug: 'demo',
  name: 'Demo',
  description: '',
  kind: 'new',
  externalLink: null,
  permissionMode: 'hybrid',
  createdAt: 0,
};

describe('resolveProjectPaths', () => {
  it('new 프로젝트는 projectDir을 spawnCwd로 반환', () => {
    const p = resolveProjectPaths({ ...baseProject, kind: 'new' }, ARENA_ROOT);
    expect(p.projectDir).toBe(path.join(ARENA_ROOT, 'projects', 'demo'));
    expect(p.spawnCwd).toBe(p.projectDir);
    expect(p.externalRealPath).toBeUndefined();
  });

  it('imported 프로젝트도 projectDir을 spawnCwd로 반환', () => {
    const p = resolveProjectPaths({ ...baseProject, kind: 'imported' }, ARENA_ROOT);
    expect(p.spawnCwd).toBe(p.projectDir);
  });

  it('external 프로젝트는 link 경로를 spawnCwd로 반환', () => {
    const p = resolveProjectPaths(
      { ...baseProject, kind: 'external', externalLink: '/outside/real' },
      ARENA_ROOT,
    );
    expect(p.spawnCwd).toBe(path.join(p.projectDir, 'link'));
    expect(p.externalRealPath).toBe('/outside/real');
  });

  it('external인데 externalLink 없으면 throw', () => {
    expect(() =>
      resolveProjectPaths({ ...baseProject, kind: 'external', externalLink: null }, ARENA_ROOT),
    ).toThrow(/externalLink/);
  });

  it('metaDir은 항상 projectDir/.arena', () => {
    const p = resolveProjectPaths(baseProject, ARENA_ROOT);
    expect(p.metaDir).toBe(path.join(p.projectDir, '.arena'));
  });
});
