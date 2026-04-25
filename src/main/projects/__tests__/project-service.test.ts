/**
 * Unit tests for ProjectService (R2 Task 8).
 *
 * Coverage:
 *   - create({kind:'new'}): slug, folder, .arena/meta.json, DB row
 *   - create({kind:'external'}): realpath baseline + junction + TOCTOU
 *     verification (skipped on Windows; symlink-related)
 *   - create({kind:'imported'}): recursive copy from sourcePath
 *   - create(external, auto): ExternalAutoForbiddenError, no FS mutation
 *   - create: duplicate slug → DuplicateSlugError, no FS mutation
 *   - archive: status='archived' + archived_at set, folder untouched
 *   - list: folder_missing auto-detect + reactivation when folder returns
 *   - addMember / removeMember / listMembers
 *   - onProjectCreated hook fires
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite so
 * failures leave no cross-test state behind.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ProjectRepository } from '../project-repository';
import * as projectMetaModule from '../project-meta';
import * as junctionModule from '../junction';
import {
  DuplicateSlugError,
  ExternalAutoForbiddenError,
  JunctionTOCTOUMismatchError,
  ProjectInputError,
  ProjectService,
  generateSlug,
} from '../project-service';
import type { Project } from '../../../shared/project-types';
import type { ApprovalKind } from '../../../shared/approval-types';

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

function seedProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Provider ${id}`, 1700000000000, 1700000000000);
}

const isWindows = process.platform === 'win32';

describe('generateSlug', () => {
  it('lowercases + replaces disallowed chars with single hyphens', () => {
    expect(generateSlug('Hello World!')).toBe('hello-world');
  });

  it('keeps Korean Hangul characters as-is', () => {
    expect(generateSlug('나의 프로젝트')).toBe('나의-프로젝트');
  });

  it('strips leading/trailing hyphens', () => {
    expect(generateSlug('---foo bar---')).toBe('foo-bar');
  });

  it('falls back to 8-char hex when input reduces to empty', () => {
    const slug = generateSlug('!!!***...');
    expect(slug).toMatch(/^[0-9a-f]{8}$/);
  });

  it('caps at 64 characters', () => {
    const slug = generateSlug('a'.repeat(100));
    expect(slug.length).toBe(64);
  });
});

describe('ProjectService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let repo: ProjectRepository;
  let service: ProjectService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task8-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    // Use the ArenaRoot's db path so the suite mirrors production layout.
    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    repo = new ProjectRepository(db);
    service = new ProjectService(repo, arenaRootService);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── kind: new ────────────────────────────────────────────────────────

  describe('create({kind:"new"})', () => {
    it('creates folder, meta.json, and DB row atomically', async () => {
      const project = await service.create({
        name: 'Alpha Project',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      // DB
      expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(project.slug).toBe('alpha-project');
      expect(project.kind).toBe('new');
      expect(project.externalLink).toBeNull();
      expect(project.status).toBe('active');
      expect(repo.get(project.id)).toEqual(project);

      // Folder
      const rootPath = path.join(arenaRoot, 'projects', project.slug);
      expect(fs.existsSync(rootPath)).toBe(true);
      expect(fs.statSync(rootPath).isDirectory()).toBe(true);

      // meta.json
      const metaPath = path.join(rootPath, '.arena', 'meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(meta).toMatchObject({
        id: project.id,
        name: 'Alpha Project',
        kind: 'new',
        permissionMode: 'hybrid',
        autonomyMode: 'manual',
        schemaVersion: 1,
      });
      expect(meta.externalLink).toBeUndefined();
    });

    it('defaults autonomyMode=manual and description=""', async () => {
      const project = await service.create({
        name: 'Beta',
        kind: 'new',
        permissionMode: 'approval',
      });
      expect(project.autonomyMode).toBe('manual');
      expect(project.description).toBe('');
    });

    it('fires onProjectCreated after success', async () => {
      const seen: Project[] = [];
      const withHook = new ProjectService(repo, arenaRootService, {
        onProjectCreated: (p) => seen.push(p),
      });
      const created = await withHook.create({
        name: 'Hooked',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.id).toBe(created.id);
    });

    it('accepts initial members and persists them', async () => {
      seedProvider(db, 'prov-a');
      seedProvider(db, 'prov-b');

      const project = await service.create({
        name: 'WithMembers',
        kind: 'new',
        permissionMode: 'hybrid',
        initialMemberProviderIds: ['prov-a', 'prov-b'],
      });

      const members = service.listMembers(project.id);
      expect(members.map((m) => m.providerId).sort()).toEqual(['prov-a', 'prov-b']);
    });
  });

  // ── kind: external ───────────────────────────────────────────────────

  describe('create({kind:"external"})', () => {
    it.skipIf(isWindows)(
      'stores realpath baseline and creates a symlink pointing at it',
      async () => {
        const target = makeTmpDir('rolestra-ext-target-');
        try {
          const project = await service.create({
            name: 'ExtProj',
            kind: 'external',
            externalPath: target,
            permissionMode: 'hybrid',
          });

          const targetReal = fs.realpathSync(target);
          expect(project.externalLink).toBe(targetReal);

          // Link resolves back to the real target.
          const linkPath = path.join(
            arenaRoot,
            'projects',
            project.slug,
            'link',
          );
          expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
          expect(fs.realpathSync(linkPath)).toBe(targetReal);

          // meta.json records externalLink.
          const meta = JSON.parse(
            fs.readFileSync(
              path.join(arenaRoot, 'projects', project.slug, '.arena', 'meta.json'),
              'utf-8',
            ),
          );
          expect(meta.externalLink).toBe(targetReal);
        } finally {
          cleanupDir(target);
        }
      },
    );

    it('rejects permissionMode="auto" before touching FS', async () => {
      const target = makeTmpDir('rolestra-ext-auto-');
      try {
        let threw: unknown;
        try {
          await service.create({
            name: 'ExtAuto',
            kind: 'external',
            externalPath: target,
            permissionMode: 'auto',
          });
        } catch (err) {
          threw = err;
        }
        expect(threw).toBeInstanceOf(ExternalAutoForbiddenError);
        const msg = (threw as Error).message;
        expect(msg).toMatch(/external/);
        expect(msg).toMatch(/auto/);
        expect(msg).toMatch(/§7\.3/);

        // No project folder created.
        const slug = 'extauto';
        expect(fs.existsSync(path.join(arenaRoot, 'projects', slug))).toBe(false);
        // No DB row either.
        expect(repo.getBySlug(slug)).toBeNull();
      } finally {
        cleanupDir(target);
      }
    });

    it('throws ProjectInputError when externalPath is missing', async () => {
      await expect(
        service.create({
          name: 'NoPath',
          kind: 'external',
          permissionMode: 'hybrid',
        }),
      ).rejects.toBeInstanceOf(ProjectInputError);
    });
  });

  // ── kind: imported ───────────────────────────────────────────────────

  describe('create({kind:"imported"})', () => {
    it('recursively copies sourcePath into <arena>/projects/<slug>/', async () => {
      const source = makeTmpDir('rolestra-import-src-');
      try {
        fs.writeFileSync(path.join(source, 'README.md'), '# Imported');
        fs.mkdirSync(path.join(source, 'subdir'));
        fs.writeFileSync(path.join(source, 'subdir', 'a.txt'), 'hello');

        const project = await service.create({
          name: 'Imported One',
          kind: 'imported',
          sourcePath: source,
          permissionMode: 'hybrid',
        });

        const rootPath = path.join(arenaRoot, 'projects', project.slug);
        expect(
          fs.readFileSync(path.join(rootPath, 'README.md'), 'utf-8'),
        ).toBe('# Imported');
        expect(
          fs.readFileSync(path.join(rootPath, 'subdir', 'a.txt'), 'utf-8'),
        ).toBe('hello');

        // meta.json added after copy (not a conflict).
        expect(fs.existsSync(path.join(rootPath, '.arena', 'meta.json'))).toBe(true);
      } finally {
        cleanupDir(source);
      }
    });

    it('throws ProjectInputError when sourcePath is missing', async () => {
      await expect(
        service.create({
          name: 'NoSource',
          kind: 'imported',
          permissionMode: 'hybrid',
        }),
      ).rejects.toBeInstanceOf(ProjectInputError);
    });
  });

  // ── duplicate slug ───────────────────────────────────────────────────

  describe('slug collision', () => {
    it('throws DuplicateSlugError on second create of same name, no FS side-effects', async () => {
      await service.create({
        name: 'Gamma',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      // Snapshot DB and FS before the second (failing) create.
      const rowsBefore = repo.list().length;
      const dirsBefore = fs.readdirSync(path.join(arenaRoot, 'projects')).length;

      await expect(
        service.create({
          name: 'Gamma',
          kind: 'new',
          permissionMode: 'hybrid',
        }),
      ).rejects.toBeInstanceOf(DuplicateSlugError);

      expect(repo.list().length).toBe(rowsBefore);
      expect(fs.readdirSync(path.join(arenaRoot, 'projects')).length).toBe(dirsBefore);
    });
  });

  // ── archive ─────────────────────────────────────────────────────────

  describe('archive', () => {
    it('flips status=archived + archived_at and keeps the folder on disk', async () => {
      const created = await service.create({
        name: 'ToArchive',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const rootPath = path.join(arenaRoot, 'projects', created.slug);
      expect(fs.existsSync(rootPath)).toBe(true);

      const archived = service.archive(created.id);
      expect(archived.status).toBe('archived');
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.archivedAt).toBeGreaterThan(0);

      // Folder must be untouched — archive is soft.
      expect(fs.existsSync(rootPath)).toBe(true);
    });

    it('throws when project id is unknown', () => {
      expect(() => service.archive('does-not-exist')).toThrow(/not found/);
    });
  });

  // ── list / folder_missing ────────────────────────────────────────────

  describe('list()', () => {
    it('returns all projects ordered by createdAt', async () => {
      const a = await service.create({
        name: 'AAA',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      // Ensure distinct createdAt values even on fast machines.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const b = await service.create({
        name: 'BBB',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const list = service.list();
      expect(list.map((p) => p.id)).toEqual([a.id, b.id]);
    });

    it('flips status to folder_missing when the folder is deleted out-of-band', async () => {
      const created = await service.create({
        name: 'Vanishing',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const rootPath = path.join(arenaRoot, 'projects', created.slug);
      fs.rmSync(rootPath, { recursive: true, force: true });

      const listed = service.list();
      const entry = listed.find((p) => p.id === created.id);
      expect(entry?.status).toBe('folder_missing');

      // Persistent — next list() returns folder_missing from DB too.
      expect(repo.get(created.id)?.status).toBe('folder_missing');
    });

    it('promotes back to active when folder reappears', async () => {
      const created = await service.create({
        name: 'Reappear',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const rootPath = path.join(arenaRoot, 'projects', created.slug);
      fs.rmSync(rootPath, { recursive: true, force: true });

      service.list(); // triggers folder_missing flip

      fs.mkdirSync(rootPath, { recursive: true });
      const listed = service.list();
      expect(listed.find((p) => p.id === created.id)?.status).toBe('active');
    });

    it('leaves archived projects untouched even when folder is missing', async () => {
      const created = await service.create({
        name: 'Archived',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      service.archive(created.id);
      const rootPath = path.join(arenaRoot, 'projects', created.slug);
      fs.rmSync(rootPath, { recursive: true, force: true });

      const listed = service.list();
      expect(listed.find((p) => p.id === created.id)?.status).toBe('archived');
    });
  });

  // ── members ──────────────────────────────────────────────────────────

  describe('members', () => {
    it('addMember / listMembers / removeMember round-trip', async () => {
      seedProvider(db, 'prov-1');
      seedProvider(db, 'prov-2');
      const project = await service.create({
        name: 'Mem',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      service.addMember(project.id, 'prov-1', 'dev');
      service.addMember(project.id, 'prov-2', null);
      const members = service.listMembers(project.id);
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.providerId === 'prov-1')?.roleAtProject).toBe(
        'dev',
      );

      expect(service.removeMember(project.id, 'prov-1')).toBe(true);
      expect(service.removeMember(project.id, 'prov-1')).toBe(false);
      expect(service.listMembers(project.id).map((m) => m.providerId)).toEqual([
        'prov-2',
      ]);
    });

    it('addMember throws when project is unknown', () => {
      expect(() => service.addMember('missing', 'p', null)).toThrow(/not found/);
    });
  });

  // ── repository update() column whitelist ─────────────────────────────

  describe('repository update() whitelist', () => {
    it('ignores non-whitelisted keys (defense-in-depth)', async () => {
      const project = await service.create({
        name: 'Whitelist',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const originalCreatedAt = project.createdAt;

      // Deliberately pass a bogus key via unsafe cast. It must be dropped.
      // Use a single `as` cast so both bogus keys are funneled past TS while
      // still asserting on runtime behaviour.
      const bogusPatch = {
        id: 'tampered-id',
        createdAt: 1,
        name: 'Whitelist v2',
      } as unknown as Parameters<typeof repo.update>[1];
      const changed = repo.update(project.id, bogusPatch);
      expect(changed).toBe(true);

      const updated = repo.get(project.id);
      expect(updated?.id).toBe(project.id);
      expect(updated?.createdAt).toBe(originalCreatedAt);
      expect(updated?.name).toBe('Whitelist v2');
    });

    it('returns false when no writable keys are present in the patch', async () => {
      const project = await service.create({
        name: 'NoOp',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const unknownPatch = { madeUpField: 'x' } as unknown as Parameters<
        typeof repo.update
      >[1];
      expect(repo.update(project.id, unknownPatch)).toBe(false);
    });
  });

  // ── partial-FS-rollback path ─────────────────────────────────────────

  describe('partial-FS failure rollback', () => {
    it('cleans up root folder + DB row when meta.json write fails, and slug is reusable', async () => {
      const name = 'Partially Broken';
      const slug = generateSlug(name);
      const rootPath = path.join(arenaRoot, 'projects', slug);

      // First call to writeProjectMeta throws; subsequent calls (the
      // successful second create) use the real implementation.
      const real = projectMetaModule.writeProjectMeta;
      const spy = vi
        .spyOn(projectMetaModule, 'writeProjectMeta')
        .mockImplementationOnce(() => {
          throw new Error('synthetic meta.json write failure');
        });

      let threw: unknown;
      try {
        await service.create({
          name,
          kind: 'new',
          permissionMode: 'hybrid',
        });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(Error);
      expect((threw as Error).message).toMatch(/synthetic/);

      // FS rolled back.
      expect(fs.existsSync(rootPath)).toBe(false);
      // DB row rolled back — no projects at all on this fresh arena.
      expect(repo.list()).toHaveLength(0);
      // Slug reusable: the spy only throws once, so the retry goes through.
      expect(spy).toHaveBeenCalledTimes(1);

      const retried = await service.create({
        name,
        kind: 'new',
        permissionMode: 'hybrid',
      });
      expect(retried.slug).toBe(slug);
      expect(fs.existsSync(rootPath)).toBe(true);
      expect(repo.get(retried.id)).not.toBeNull();

      spy.mockRestore();
      // Sanity: the module export is the original function again.
      expect(projectMetaModule.writeProjectMeta).toBe(real);
    });
  });

  // ── SQLite UNIQUE → DuplicateSlugError mapping ───────────────────────

  describe('SQLite UNIQUE constraint mapping', () => {
    it('translates a UNIQUE violation on projects.slug into DuplicateSlugError', async () => {
      // Seed a row directly so the slug is taken at the SQL layer.
      const baseline: Project = {
        id: 'baseline-id',
        slug: 'clashing-slug',
        name: 'Baseline',
        description: '',
        kind: 'new',
        externalLink: null,
        permissionMode: 'hybrid',
        autonomyMode: 'manual',
        status: 'active',
        createdAt: Date.now(),
        archivedAt: null,
      };
      repo.insert(baseline);

      // Bypass the service-level pre-check (getBySlug) so the INSERT is
      // the first layer to see the collision — this simulates the
      // concurrent-create race where two callers both pass the pre-check
      // before either commits.
      const realGetBySlug = repo.getBySlug.bind(repo);
      vi.spyOn(repo, 'getBySlug').mockReturnValue(null);

      try {
        let threw: unknown;
        try {
          await service.create({
            name: 'clashing-slug', // generateSlug('clashing-slug') === 'clashing-slug'
            kind: 'new',
            permissionMode: 'hybrid',
          });
        } catch (err) {
          threw = err;
        }
        expect(threw).toBeInstanceOf(DuplicateSlugError);
        expect((threw as Error).message).toMatch(/clashing-slug/);
      } finally {
        vi.mocked(repo.getBySlug).mockRestore();
        // Confirm the restore put the real impl back.
        expect(repo.getBySlug('clashing-slug')?.id).toBe('baseline-id');
        void realGetBySlug;
      }
    });
  });

  // ── R4-Task3: external+auto defensive post-conditions ────────────────
  //
  // The earlier `create({kind:"external"}) > rejects permissionMode="auto"`
  // case asserts error class + absence of the specific slug folder. This
  // case hardens the assertion surface: after the throw, the ENTIRE
  // projects subtree must be untouched — no half-written DB rows, no stray
  // subdirectory under <arena>/projects, no junction/symlink anywhere
  // inside the arena root. Spec §7.3: rejection happens before any FS or
  // DB state is mutated.

  describe('create({kind:"external", permissionMode:"auto"}) — full defensive post-conditions', () => {
    it('throws ExternalAutoForbiddenError and leaves DB + FS pristine', async () => {
      const target = makeTmpDir('rolestra-ext-auto-defense-');
      try {
        let threw: unknown;
        try {
          await service.create({
            name: 'x',
            kind: 'external',
            externalPath: target,
            permissionMode: 'auto',
          });
        } catch (err) {
          threw = err;
        }
        expect(threw).toBeInstanceOf(ExternalAutoForbiddenError);

        // DB invariant: no rows at all — the rejection must run before
        // any INSERT.
        expect(repo.list()).toEqual([]);

        // FS invariant: the `projects/` subdir holds zero entries.
        // `ArenaRootService.ensure()` precreates the empty directory, so
        // readdirSync on it is safe and must return `[]`.
        const projectsDir = path.join(arenaRoot, 'projects');
        expect(fs.existsSync(projectsDir)).toBe(true);
        expect(fs.readdirSync(projectsDir)).toEqual([]);

        // No junction/symlink created anywhere inside the arena root.
        // Walk the arena tree and assert `lstat(...)` reports no symlinks.
        // (On Windows this would also catch junctions, but junctions are
        //  reported as directories by lstat — the `readdir projects === []`
        //  assertion above covers that case.)
        const findSymlinks = (dir: string): string[] => {
          const hits: string[] = [];
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) {
              hits.push(full);
              continue;
            }
            if (entry.isDirectory()) {
              hits.push(...findSymlinks(full));
            }
          }
          return hits;
        };
        expect(findSymlinks(arenaRoot)).toEqual([]);
      } finally {
        cleanupDir(target);
      }
    });
  });

  // ── R4-Task3: junction TOCTOU mismatch rollback ──────────────────────
  //
  // Spec §7.6 CA-3: after `createLink` materialises the junction/symlink,
  // `ProjectService.create` re-invokes `resolveLink(cwdPath)` and compares
  // against the `externalLink` baseline captured before link creation.
  // A mismatch means the target was swapped mid-creation (TOCTOU race).
  // Production behaviour on mismatch: throw `JunctionTOCTOUMismatchError`,
  // `rm -rf rootPath`, and DELETE the project row. Status does NOT flip to
  // `folder_missing` because the project never finished creation — it's
  // as if `create()` was never called.
  //
  // We drive the mismatch by stubbing `resolveLink` (the module export used
  // by project-service.ts) to return a forged path. That's a less invasive
  // and more deterministic simulator than deleting the external folder on
  // disk mid-call, and it matches the existing spy pattern used for
  // `projectMetaModule.writeProjectMeta` above.

  describe('create({kind:"external"}) — TOCTOU mismatch triggers rollback', () => {
    it.skipIf(isWindows)(
      'throws JunctionTOCTOUMismatchError and rolls back FS + DB entirely',
      async () => {
        const target = makeTmpDir('rolestra-ext-toctou-');
        try {
          const targetReal = fs.realpathSync(target);
          const name = 'TOCTOU Proj';
          const slug = generateSlug(name);
          const rootPath = path.join(arenaRoot, 'projects', slug);

          // Stub resolveLink to return a path that does NOT match the
          // stored externalLink baseline. This is exactly what would
          // happen if another process swapped the junction target between
          // createLink and the post-create verification.
          const spy = vi
            .spyOn(junctionModule, 'resolveLink')
            .mockReturnValue('/tmp/not-the-real-target-/mismatched');

          let threw: unknown;
          try {
            await service.create({
              name,
              kind: 'external',
              externalPath: target,
              permissionMode: 'hybrid',
            });
          } catch (err) {
            threw = err;
          }

          expect(threw).toBeInstanceOf(JunctionTOCTOUMismatchError);
          const msg = (threw as Error).message;
          expect(msg).toMatch(/realpath mismatch/);
          // Error carries both the baseline (expected) and the forged
          // (actual) values so an operator can tell what drifted.
          expect(msg).toContain(targetReal);
          expect(msg).toContain('/tmp/not-the-real-target-/mismatched');

          // Rollback invariants (production behaviour — NOT folder_missing):
          //  1. FS root for this project is gone (rm -rf rootPath).
          expect(fs.existsSync(rootPath)).toBe(false);
          //  2. DB row is gone (delete-by-id) — no orphan rows.
          expect(repo.list()).toEqual([]);
          expect(repo.getBySlug(slug)).toBeNull();

          spy.mockRestore();

          // Sanity: slug is reusable — a retry without the forged stub
          // succeeds cleanly, which it wouldn't if rollback had left a
          // stale row or folder behind.
          const retried = await service.create({
            name,
            kind: 'external',
            externalPath: target,
            permissionMode: 'hybrid',
          });
          expect(retried.slug).toBe(slug);
          expect(retried.externalLink).toBe(targetReal);
          expect(fs.existsSync(rootPath)).toBe(true);
        } finally {
          cleanupDir(target);
        }
      },
    );
  });

  // ── R7-Task8: permission-mode transition (approval-gated) ─────────────

  describe('requestPermissionModeChange / applyPermissionModeChange', () => {
    interface FakeApproval {
      id: string;
      kind: ApprovalKind;
      projectId: string | null;
      channelId: string | null;
      meetingId: string | null;
      requesterId: string | null;
      payload: unknown;
      status: 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';
      decisionComment: string | null;
      createdAt: number;
      decidedAt: number | null;
    }

    function makeFakeApprovalService() {
      const rows = new Map<string, FakeApproval>();
      let idCounter = 0;
      const supersedeSpy = vi.fn((id: string) => {
        const row = rows.get(id);
        if (!row) throw new Error(`not found: ${id}`);
        row.status = 'superseded';
        row.decidedAt = Date.now();
      });
      return {
        rows,
        supersedeSpy,
        create: vi.fn((input: {
          kind: ApprovalKind;
          projectId?: string | null;
          channelId?: string | null;
          meetingId?: string | null;
          requesterId?: string | null;
          payload?: unknown;
        }) => {
          idCounter += 1;
          const id = `fake-appr-${idCounter}`;
          const row: FakeApproval = {
            id,
            kind: input.kind,
            projectId: input.projectId ?? null,
            channelId: input.channelId ?? null,
            meetingId: input.meetingId ?? null,
            requesterId: input.requesterId ?? null,
            payload: input.payload ?? null,
            status: 'pending',
            decisionComment: null,
            createdAt: Date.now(),
            decidedAt: null,
          };
          rows.set(id, row);
          return row;
        }),
        get: vi.fn((id: string) => rows.get(id) ?? null),
        supersede: supersedeSpy,
      };
    }

    async function makeProjectFixture(
      input: { kind: 'new' | 'external' | 'imported'; permissionMode: PermissionModeForTest; externalPath?: string; name?: string },
      opts: { hasActiveMeeting?: boolean } = {},
    ) {
      const approvalSvc = makeFakeApprovalService();
      const hasActive = { value: opts.hasActiveMeeting ?? false };
      const wired = new ProjectService(repo, arenaRootService, {
        approvalService: approvalSvc,
        hasActiveMeeting: () => hasActive.value,
      });
      const project = await wired.create({
        name: input.name ?? 'ModeFix',
        kind: input.kind,
        permissionMode: input.permissionMode,
        externalPath: input.externalPath,
      });
      return { wired, approvalSvc, project, hasActive };
    }

    type PermissionModeForTest = 'auto' | 'hybrid' | 'approval';

    it('requestPermissionModeChange creates a mode_transition approval row', async () => {
      const f = await makeProjectFixture({
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const approval = f.wired.requestPermissionModeChange(
        f.project.id,
        'approval',
        '보안 감사 기간',
      );
      expect(approval.kind).toBe('mode_transition');
      expect(approval.projectId).toBe(f.project.id);
      expect(approval.channelId).toBeNull();
      expect(approval.meetingId).toBeNull();
      expect(approval.status).toBe('pending');
      const payload = approval.payload as {
        kind: string;
        currentMode: string;
        targetMode: string;
        reason?: string;
      };
      expect(payload.kind).toBe('mode_transition');
      expect(payload.currentMode).toBe('hybrid');
      expect(payload.targetMode).toBe('approval');
      expect(payload.reason).toBe('보안 감사 기간');
    });

    it('rejects targetMode === currentMode with SamePermissionModeError (no row created)', async () => {
      const f = await makeProjectFixture({
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const { SamePermissionModeError } = await import('../project-service');
      expect(() =>
        f.wired.requestPermissionModeChange(f.project.id, 'hybrid'),
      ).toThrow(SamePermissionModeError);
      expect(f.approvalSvc.create).not.toHaveBeenCalled();
    });

    it('rejects external + auto with ExternalAutoForbiddenError (no row created)', async () => {
      const targetDir = makeTmpDir('rolestra-ext-autogate-');
      try {
        const f = await makeProjectFixture({
          kind: 'external',
          permissionMode: 'hybrid',
          externalPath: targetDir,
          name: 'ExtAutoGate',
        });
        const { ExternalAutoForbiddenError } = await import('../project-service');
        expect(() =>
          f.wired.requestPermissionModeChange(f.project.id, 'auto'),
        ).toThrow(ExternalAutoForbiddenError);
        expect(f.approvalSvc.create).not.toHaveBeenCalled();
      } finally {
        cleanupDir(targetDir);
      }
    });

    it('rejects when an active meeting exists (CB-3) — no row created', async () => {
      const f = await makeProjectFixture(
        { kind: 'new', permissionMode: 'hybrid' },
        { hasActiveMeeting: true },
      );
      const { ActiveMeetingForbiddenError } = await import('../project-service');
      expect(() =>
        f.wired.requestPermissionModeChange(f.project.id, 'approval'),
      ).toThrow(ActiveMeetingForbiddenError);
      expect(f.approvalSvc.create).not.toHaveBeenCalled();
    });

    it('applyPermissionModeChange UPDATEs permission_mode when approved', async () => {
      const f = await makeProjectFixture({
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const approval = f.wired.requestPermissionModeChange(
        f.project.id,
        'approval',
      );
      // Simulate a decision by mutating the fake row.
      const row = f.approvalSvc.rows.get(approval.id);
      if (!row) throw new Error('row missing');
      row.status = 'approved';
      row.decidedAt = Date.now();

      const updated = f.wired.applyPermissionModeChange(approval.id);
      expect(updated.permissionMode).toBe('approval');
      expect(repo.get(f.project.id)?.permissionMode).toBe('approval');
    });

    it('applyPermissionModeChange re-asserts CB-3: active meeting → supersedes the approval', async () => {
      const f = await makeProjectFixture({
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const approval = f.wired.requestPermissionModeChange(
        f.project.id,
        'approval',
      );
      const row = f.approvalSvc.rows.get(approval.id);
      if (!row) throw new Error('row missing');
      row.status = 'approved';

      // Between request + apply a meeting started — TOCTOU.
      f.hasActive.value = true;

      const { ActiveMeetingForbiddenError } = await import('../project-service');
      expect(() => f.wired.applyPermissionModeChange(approval.id)).toThrow(
        ActiveMeetingForbiddenError,
      );
      expect(f.approvalSvc.supersede).toHaveBeenCalledWith(approval.id);
      // Project row untouched.
      expect(repo.get(f.project.id)?.permissionMode).toBe('hybrid');
      // Approval row is now superseded (via fake).
      expect(f.approvalSvc.rows.get(approval.id)?.status).toBe('superseded');
    });

    it('applyPermissionModeChange throws ApprovalKindMismatchError on wrong kind', async () => {
      const approvalSvc = makeFakeApprovalService();
      const wired = new ProjectService(repo, arenaRootService, {
        approvalService: approvalSvc,
      });
      // Hand-craft a wrong-kind approval row.
      const wrong = approvalSvc.create({
        kind: 'cli_permission',
        projectId: 'p-x',
      });
      const row = approvalSvc.rows.get(wrong.id);
      if (row) row.status = 'approved';

      const { ApprovalKindMismatchError } = await import('../project-service');
      expect(() => wired.applyPermissionModeChange(wrong.id)).toThrow(
        ApprovalKindMismatchError,
      );
    });

    it('throws ApprovalServiceUnavailableError when not wired', () => {
      const { ApprovalServiceUnavailableError } = (async () =>
        await import('../project-service'))() as unknown as {
        ApprovalServiceUnavailableError: new () => Error;
      };
      // Simpler path: instantiate without approvalService opt.
      const bare = new ProjectService(repo, arenaRootService);
      // Use the class at runtime via the import promise — since top-level
      // here is sync, fall back to name-based assertion.
      expect(() => bare.requestPermissionModeChange('p-1', 'approval')).toThrow(
        /approvalService is not configured/,
      );
      void ApprovalServiceUnavailableError;
    });
  });

  // ── R11-Task10: pendingAdvisory in-memory slot ────────────────────────

  describe('pendingAdvisory (R11-Task10)', () => {
    it('returns null when no advisory has been set', () => {
      expect(service.consumePendingAdvisory('p-no-advisory')).toBeNull();
    });

    it('round-trip: set then consume returns the trimmed advisory once', () => {
      service.setPendingAdvisory('p-1', '  read-only mode for src/external/  ');
      expect(service.consumePendingAdvisory('p-1')).toBe(
        'read-only mode for src/external/',
      );
      // 두 번째 consume 은 null — 1회용 slot.
      expect(service.consumePendingAdvisory('p-1')).toBeNull();
    });

    it('overwrites with last-write-wins semantics on repeated set', () => {
      service.setPendingAdvisory('p-2', 'first comment');
      service.setPendingAdvisory('p-2', 'second comment supersedes');
      expect(service.consumePendingAdvisory('p-2')).toBe(
        'second comment supersedes',
      );
    });

    it('keeps per-project slots independent', () => {
      service.setPendingAdvisory('p-A', 'note A');
      service.setPendingAdvisory('p-B', 'note B');
      expect(service.consumePendingAdvisory('p-A')).toBe('note A');
      // Consuming p-A must not affect p-B.
      expect(service.consumePendingAdvisory('p-B')).toBe('note B');
      expect(service.consumePendingAdvisory('p-A')).toBeNull();
    });

    it('clears the slot when set with whitespace-only advisory', () => {
      service.setPendingAdvisory('p-3', 'real comment');
      service.setPendingAdvisory('p-3', '   ');
      expect(service.consumePendingAdvisory('p-3')).toBeNull();
    });
  });
});
