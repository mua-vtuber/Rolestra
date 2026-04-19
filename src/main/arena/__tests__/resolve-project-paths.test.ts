/**
 * Unit tests for {@link resolveProjectPaths}.
 *
 * Exercises the three Project kinds (new, imported, external) and verifies
 * that external throws when `externalLink` is absent. The function is pure
 * (no disk I/O), so these tests use synthetic path literals and compare
 * against `path.join` so they stay platform-independent.
 */

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Project, ProjectKind } from '../../../shared/project-types';
import { resolveProjectPaths } from '../resolve-project-paths';

const ARENA_ROOT = path.join(path.sep, 'tmp', 'arena');
const SLUG = 'foo';

function buildProject(overrides: Partial<Project> & { kind: ProjectKind }): Project {
  const base: Project = {
    id: 'project-1',
    slug: SLUG,
    name: 'Foo',
    description: '',
    kind: overrides.kind,
    externalLink: null,
    permissionMode: 'approval',
    autonomyMode: 'manual',
    status: 'active',
    createdAt: 0,
    archivedAt: null,
  };
  return { ...base, ...overrides };
}

describe('resolveProjectPaths', () => {
  it('returns rootPath/cwdPath identical for kind=new', () => {
    const project = buildProject({ kind: 'new' });

    const paths = resolveProjectPaths(project, ARENA_ROOT);

    const expectedRoot = path.join(ARENA_ROOT, 'projects', SLUG);
    expect(paths.rootPath).toBe(expectedRoot);
    expect(paths.cwdPath).toBe(expectedRoot);
    expect(paths.metaPath).toBe(path.join(expectedRoot, '.arena', 'meta.json'));
    expect(paths.consensusPath).toBe(path.join(ARENA_ROOT, 'consensus'));
  });

  it('returns rootPath/cwdPath identical for kind=imported', () => {
    const project = buildProject({ kind: 'imported' });

    const paths = resolveProjectPaths(project, ARENA_ROOT);

    const expectedRoot = path.join(ARENA_ROOT, 'projects', SLUG);
    expect(paths.rootPath).toBe(expectedRoot);
    expect(paths.cwdPath).toBe(expectedRoot);
  });

  it('routes cwdPath through the /link subdir for kind=external', () => {
    const project = buildProject({
      kind: 'external',
      externalLink: path.join(path.sep, 'some', 'real', 'path'),
    });

    const paths = resolveProjectPaths(project, ARENA_ROOT);

    const expectedRoot = path.join(ARENA_ROOT, 'projects', SLUG);
    expect(paths.rootPath).toBe(expectedRoot);
    expect(paths.cwdPath).toBe(path.join(expectedRoot, 'link'));
    expect(paths.metaPath).toBe(path.join(expectedRoot, '.arena', 'meta.json'));
    expect(paths.consensusPath).toBe(path.join(ARENA_ROOT, 'consensus'));
  });

  it('throws when kind=external is missing externalLink', () => {
    const project = buildProject({ kind: 'external', externalLink: null });

    expect(() => resolveProjectPaths(project, ARENA_ROOT)).toThrow(
      /externalLink required when kind=external/,
    );
  });
});
