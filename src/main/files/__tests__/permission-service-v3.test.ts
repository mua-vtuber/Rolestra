/**
 * Unit tests for PermissionService v3 (R2 Task 6).
 *
 * Covers:
 *   1. consensusPath is always allowed.
 *   2. Paths outside the arena tree are denied.
 *   3. An active project's cwd is allowed.
 *   4. Other projects' cwds are denied.
 *   5. external kind: junction TOCTOU guard — first spawn OK, symlink swap
 *      is detected and rejected.
 *   6. status='folder_missing' → resolveForCli throws.
 *   7. `..` traversal is rejected.
 *
 * Tests that require symlink creation skip on Windows (symlink privilege is
 * not granted by default; the TOCTOU guard is a Linux-facing invariant in
 * this suite).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import type { Project } from '../../../shared/project-types';
import {
  PermissionBoundaryError,
  PermissionService,
  normalizePathForCompare,
  type ProjectLookup,
} from '../permission-service';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createConfigStub(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch: { arenaRoot?: string }) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

function createProjectRepo(projects: Project[]): ProjectLookup {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return {
    get: (id: string) => byId.get(id) ?? null,
  };
}

function makeProject(overrides: Partial<Project> & { id: string; slug: string }): Project {
  return {
    id: overrides.id,
    slug: overrides.slug,
    name: overrides.name ?? overrides.slug,
    description: overrides.description ?? '',
    kind: overrides.kind ?? 'new',
    externalLink: overrides.externalLink ?? null,
    permissionMode: overrides.permissionMode ?? 'approval',
    autonomyMode: overrides.autonomyMode ?? 'manual',
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? 0,
    archivedAt: overrides.archivedAt ?? null,
  };
}

/**
 * Make a project directory on disk under `<arenaRoot>/projects/<slug>`.
 * For `external`, additionally create the `link` symlink pointing at
 * `externalTarget` and return the paths that were materialised.
 */
async function materialiseProject(
  arenaRoot: string,
  project: Project,
  externalTarget?: string,
): Promise<void> {
  const projectDir = path.join(arenaRoot, 'projects', project.slug);
  fs.mkdirSync(projectDir, { recursive: true });
  if (project.kind === 'external') {
    if (!externalTarget) {
      throw new Error('externalTarget required for external project');
    }
    const linkPath = path.join(projectDir, 'link');
    fs.symlinkSync(externalTarget, linkPath, 'dir');
  }
}

const isWindows = process.platform === 'win32';

describe('PermissionService v3', () => {
  let arenaRoot: string;
  let service: PermissionService;
  let arenaRootService: ArenaRootService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-perm-v3-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();
    // Default service with an empty project repo; individual tests replace it.
    service = new PermissionService(arenaRootService, createProjectRepo([]));
  });

  afterEach(() => {
    cleanupDir(arenaRoot);
  });

  describe('validateAccess — consensus boundary', () => {
    it('allows paths inside consensusPath when no active project is set', () => {
      const target = path.join(arenaRootService.consensusPath(), 'documents', 'foo.md');
      expect(() => service.validateAccess(target, null)).not.toThrow();
    });

    it('rejects absolute paths outside the arena root', () => {
      expect(() => service.validateAccess('/etc/passwd', null)).toThrow(
        PermissionBoundaryError,
      );
    });

    it('rejects .. traversal escaping the consensus root', () => {
      const target = path.join(
        arenaRootService.consensusPath(),
        '..',
        '..',
        '..',
        'etc',
        'passwd',
      );
      expect(() => service.validateAccess(target, null)).toThrow(
        PermissionBoundaryError,
      );
    });
  });

  describe('validateAccess — active project cwd', () => {
    const alpha = makeProject({ id: 'alpha-id', slug: 'alpha', kind: 'new' });
    const beta = makeProject({ id: 'beta-id', slug: 'beta', kind: 'new' });

    beforeEach(async () => {
      await materialiseProject(arenaRoot, alpha);
      await materialiseProject(arenaRoot, beta);
      service = new PermissionService(
        arenaRootService,
        createProjectRepo([alpha, beta]),
      );
    });

    it('allows paths inside the active project cwd', () => {
      const target = path.join(arenaRoot, 'projects', 'alpha', 'src', 'foo.md');
      expect(() => service.validateAccess(target, 'alpha-id')).not.toThrow();
    });

    it('rejects paths inside a sibling project', () => {
      const target = path.join(arenaRoot, 'projects', 'beta', 'src', 'foo.md');
      expect(() => service.validateAccess(target, 'alpha-id')).toThrow(
        PermissionBoundaryError,
      );
    });
  });

  describe('resolveForCli — lifecycle guards', () => {
    it('throws when the project is unknown', () => {
      expect(() => service.resolveForCli('missing')).toThrow(
        PermissionBoundaryError,
      );
    });

    it('throws when project status is folder_missing', async () => {
      const missing = makeProject({
        id: 'gone-id',
        slug: 'gone',
        kind: 'new',
        status: 'folder_missing',
      });
      await materialiseProject(arenaRoot, missing);
      service = new PermissionService(
        arenaRootService,
        createProjectRepo([missing]),
      );

      expect(() => service.resolveForCli('gone-id')).toThrow(/folder missing/i);
    });

    it('returns cwd + consensusPath for active projects', async () => {
      const alpha = makeProject({ id: 'alpha-id', slug: 'alpha', kind: 'new' });
      await materialiseProject(arenaRoot, alpha);
      service = new PermissionService(arenaRootService, createProjectRepo([alpha]));

      const result = service.resolveForCli('alpha-id');
      expect(result.cwd).toBe(path.join(arenaRoot, 'projects', 'alpha'));
      expect(result.consensusPath).toBe(arenaRootService.consensusPath());
      expect(result.project.id).toBe('alpha-id');
    });
  });

  describe('resolveForCli — external junction TOCTOU', () => {
    it.skipIf(isWindows)(
      'succeeds when realpath of link matches externalLink, rejects on swap',
      async () => {
        const realSource = makeTmpDir('rolestra-ext-real-');
        const decoySource = makeTmpDir('rolestra-ext-decoy-');
        try {
          // realpathSync normalises mount-point-specific paths (e.g. macOS
          // /private prefix) so we must compare against the realpath form.
          const realSourceResolved = fs.realpathSync(realSource);

          const ext = makeProject({
            id: 'ext-id',
            slug: 'extproj',
            kind: 'external',
            externalLink: realSourceResolved,
          });
          await materialiseProject(arenaRoot, ext, realSourceResolved);
          service = new PermissionService(
            arenaRootService,
            createProjectRepo([ext]),
          );

          // First call: link matches externalLink → OK.
          const first = service.resolveForCli('ext-id');
          expect(first.cwd).toBe(
            path.join(arenaRoot, 'projects', 'extproj', 'link'),
          );

          // Swap the symlink to point at a different directory.
          const linkPath = path.join(arenaRoot, 'projects', 'extproj', 'link');
          fs.unlinkSync(linkPath);
          fs.symlinkSync(decoySource, linkPath, 'dir');

          // Second call: realpath no longer matches externalLink → throw.
          expect(() => service.resolveForCli('ext-id')).toThrow(
            /TOCTOU mismatch/i,
          );
        } finally {
          cleanupDir(realSource);
          cleanupDir(decoySource);
        }
      },
    );

    it.skipIf(isWindows)(
      'tolerates trailing slash in stored externalLink (defensive normalization)',
      async () => {
        const realSource = makeTmpDir('rolestra-ext-slash-');
        try {
          const realSourceResolved = fs.realpathSync(realSource);
          // Simulate Task 8 persisting the link with a trailing separator.
          // realpathSync() never returns one, so without normalization this
          // would be a permanent TOCTOU-mismatch DoS.
          const storedWithSlash = realSourceResolved + path.sep;
          const ext = makeProject({
            id: 'ext-slash-id',
            slug: 'extproj-slash',
            kind: 'external',
            externalLink: storedWithSlash,
          });
          await materialiseProject(arenaRoot, ext, realSourceResolved);
          service = new PermissionService(
            arenaRootService,
            createProjectRepo([ext]),
          );

          expect(() => service.resolveForCli('ext-slash-id')).not.toThrow();
        } finally {
          cleanupDir(realSource);
        }
      },
    );

    it.skipIf(isWindows)(
      'throws when the external link file is missing entirely',
      async () => {
        const realSource = makeTmpDir('rolestra-ext-gone-');
        try {
          const realSourceResolved = fs.realpathSync(realSource);
          const ext = makeProject({
            id: 'ext2-id',
            slug: 'extproj2',
            kind: 'external',
            externalLink: realSourceResolved,
          });
          // Materialise the project dir but NOT the symlink.
          fs.mkdirSync(path.join(arenaRoot, 'projects', 'extproj2'), {
            recursive: true,
          });
          service = new PermissionService(
            arenaRootService,
            createProjectRepo([ext]),
          );

          expect(() => service.resolveForCli('ext2-id')).toThrow(
            /external link missing/i,
          );
        } finally {
          cleanupDir(realSource);
        }
      },
    );
  });
});

/**
 * normalizePathForCompare — pure-string normalisation for the TOCTOU guard.
 *
 * Runs on every host (Windows + POSIX) by passing the platform argument
 * explicitly. Drives the Windows-specific TOCTOU equality on Linux/macOS CI
 * agents that cannot create real `mklink /J` junctions.
 */
describe('normalizePathForCompare (R12-C 정리 #6 — Windows TOCTOU)', () => {
  describe('platform: win32', () => {
    it('upper-cases lowercase drive letters', () => {
      expect(normalizePathForCompare('c:\\foo\\bar', 'win32')).toBe(
        'C:\\foo\\bar',
      );
    });

    it('strips the \\\\?\\ long-path prefix on local drives', () => {
      expect(
        normalizePathForCompare('\\\\?\\C:\\Users\\me\\target', 'win32'),
      ).toBe('C:\\Users\\me\\target');
    });

    it('preserves the \\\\?\\UNC\\ prefix (different path semantics)', () => {
      // UNC long-path prefix is *not* the same path as the bare \\server\share
      // form when passed to fs.realpathSync — stripping it would weaken the
      // guard. Just ensure it survives normalisation.
      const out = normalizePathForCompare(
        '\\\\?\\UNC\\server\\share\\dir',
        'win32',
      );
      expect(out.startsWith('\\\\?\\UNC\\')).toBe(true);
    });

    it('converts forward slashes to backslashes', () => {
      expect(normalizePathForCompare('C:/foo/bar', 'win32')).toBe(
        'C:\\foo\\bar',
      );
    });

    it('produces equal output for spellings that mean the same Windows path', () => {
      // Stored DB form (user-typed lowercase drive) vs realpath form (Node's
      // upper-case canonical) must compare equal — otherwise every external
      // project spawn becomes a permanent denial-of-service.
      const stored = normalizePathForCompare('c:/Projects/repo', 'win32');
      const real = normalizePathForCompare('C:\\Projects\\repo', 'win32');
      expect(stored).toBe(real);
    });

    it('still distinguishes genuinely different paths after normalisation', () => {
      // The whole point of the TOCTOU guard is to reject swaps. A normalised
      // benign path must not collide with a normalised swapped path.
      const benign = normalizePathForCompare('C:\\Users\\me\\real', 'win32');
      const swapped = normalizePathForCompare('C:\\Users\\me\\decoy', 'win32');
      expect(benign).not.toBe(swapped);
    });
  });

  describe('platform: posix-like (linux/darwin)', () => {
    it('does NOT case-fold path components on linux', () => {
      // POSIX filesystems are case-sensitive; case-folding here would weaken
      // the guard by collapsing two genuinely different filesystem entries.
      const lower = normalizePathForCompare('/tmp/Foo/Bar', 'linux');
      const upper = normalizePathForCompare('/tmp/foo/bar', 'linux');
      expect(lower).not.toBe(upper);
    });

    it('does NOT strip leading \\\\?\\-like sequences on darwin', () => {
      // The long-path prefix has no meaning outside Windows; the literal
      // characters must survive so a pathological POSIX path stays distinct.
      const out = normalizePathForCompare('/\\\\?\\not-windows', 'darwin');
      expect(out).toContain('\\\\?\\');
    });

    it('returns absolute, separator-resolved path identical to path.resolve', () => {
      // POSIX behaviour intentionally collapses to plain `path.resolve` —
      // this guards against a future refactor accidentally adding case-folding
      // or prefix-stripping to the POSIX branch.
      expect(normalizePathForCompare('/tmp/../tmp/foo', 'linux')).toBe(
        '/tmp/foo',
      );
    });
  });
});
