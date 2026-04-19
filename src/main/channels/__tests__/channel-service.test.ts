/**
 * Unit tests for ChannelService (R2 Task 10).
 *
 * Coverage:
 *   - create user channel: row + members, UNIQUE → DuplicateChannelNameError
 *   - createSystemChannels: 3-channel blueprint in order, transactional, id
 *     idempotency (second call throws), member materialisation when
 *     project has members
 *   - rename/delete: system channels blocked, user channels work, UNIQUE
 *     collision on rename → DuplicateChannelNameError
 *   - createDm: partial-unique index enforcement → DuplicateDmError;
 *     channel_members row created with project_id=NULL
 *   - addMember: composite FK surfaces ChannelMemberFkError for non-project
 *     members
 *   - End-to-end `onProjectCreated` hook: ProjectService + ChannelService
 *     wiring produces 3 system channels
 *   - listByProject ordering: system first (stable kind order), then user
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite so
 * failures leave no cross-test state behind.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { ChannelRepository } from '../channel-repository';
import {
  ChannelMemberFkError,
  ChannelNotFoundError,
  ChannelService,
  DuplicateChannelNameError,
  DuplicateDmError,
  SystemChannelProtectedError,
} from '../channel-service';

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

describe('ChannelService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let projectRepo: ProjectRepository;
  let projectService: ProjectService;
  let channelRepo: ChannelRepository;
  let channelService: ChannelService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task10-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    projectRepo = new ProjectRepository(db);
    projectService = new ProjectService(projectRepo, arenaRootService);
    channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo, projectRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── create user channel ─────────────────────────────────────────────

  describe('create({kind:"user"})', () => {
    it('inserts a channel row with default readOnly=false and kind=user', async () => {
      const project = await projectService.create({
        name: 'Alpha',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      const channel = channelService.create({
        projectId: project.id,
        name: '기획',
      });

      expect(channel.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(channel.projectId).toBe(project.id);
      expect(channel.name).toBe('기획');
      expect(channel.kind).toBe('user');
      expect(channel.readOnly).toBe(false);
      expect(channelRepo.get(channel.id)).toEqual(channel);
    });

    it('persists memberProviderIds as channel_members rows', async () => {
      seedProvider(db, 'prov-a');
      seedProvider(db, 'prov-b');
      const project = await projectService.create({
        name: 'Beta',
        kind: 'new',
        permissionMode: 'hybrid',
        initialMemberProviderIds: ['prov-a', 'prov-b'],
      });

      const channel = channelService.create({
        projectId: project.id,
        name: 'dev',
        memberProviderIds: ['prov-a', 'prov-b'],
      });

      const members = channelService.listMembers(channel.id);
      expect(members.map((m) => m.providerId).sort()).toEqual([
        'prov-a',
        'prov-b',
      ]);
      for (const m of members) {
        expect(m.projectId).toBe(project.id);
        expect(m.channelId).toBe(channel.id);
      }
    });

    it('throws DuplicateChannelNameError on UNIQUE(project_id,name) collision', async () => {
      const project = await projectService.create({
        name: 'Gamma',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      channelService.create({ projectId: project.id, name: 'dupe' });
      expect(() =>
        channelService.create({ projectId: project.id, name: 'dupe' }),
      ).toThrow(DuplicateChannelNameError);
    });

    it('rolls back the channel row when a memberProviderId violates the composite FK', async () => {
      seedProvider(db, 'prov-x');
      const project = await projectService.create({
        name: 'FK',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      // prov-x is a provider but NOT a project member.
      expect(() =>
        channelService.create({
          projectId: project.id,
          name: 'will-fail',
          memberProviderIds: ['prov-x'],
        }),
      ).toThrow(ChannelMemberFkError);

      // Channel row should not exist — transaction rolled back.
      expect(channelService.listByProject(project.id)).toHaveLength(0);
    });
  });

  // ── createSystemChannels ────────────────────────────────────────────

  describe('createSystemChannels', () => {
    it('creates exactly 3 channels in blueprint order with correct kinds/readOnly', async () => {
      const project = await projectService.create({
        name: 'Sysch',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      const channels = channelService.createSystemChannels(project.id);
      expect(channels).toHaveLength(3);
      expect(channels[0]).toMatchObject({
        name: '일반',
        kind: 'system_general',
        readOnly: false,
      });
      expect(channels[1]).toMatchObject({
        name: '승인-대기',
        kind: 'system_approval',
        readOnly: true,
      });
      expect(channels[2]).toMatchObject({
        name: '회의록',
        kind: 'system_minutes',
        readOnly: true,
      });

      // Persisted rows match the returned array.
      const stored = channelService.listByProject(project.id);
      expect(stored.map((c) => c.id)).toEqual(channels.map((c) => c.id));
    });

    it('throws (and rolls back) when called twice for the same project', async () => {
      const project = await projectService.create({
        name: 'Twice',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      channelService.createSystemChannels(project.id);
      expect(() => channelService.createSystemChannels(project.id)).toThrow(
        DuplicateChannelNameError,
      );

      // Still only 3 channels — second call rolled back entirely.
      expect(channelService.listByProject(project.id)).toHaveLength(3);
    });

    it('materialises channel_members rows for each project member at create time', async () => {
      seedProvider(db, 'prov-1');
      seedProvider(db, 'prov-2');
      const project = await projectService.create({
        name: 'WithMembers',
        kind: 'new',
        permissionMode: 'hybrid',
        initialMemberProviderIds: ['prov-1', 'prov-2'],
      });

      const channels = channelService.createSystemChannels(project.id);
      for (const channel of channels) {
        const members = channelService.listMembers(channel.id);
        expect(members.map((m) => m.providerId).sort()).toEqual([
          'prov-1',
          'prov-2',
        ]);
      }
    });

    it('leaves channel_members empty when the project has no members', async () => {
      const project = await projectService.create({
        name: 'Empty',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const channels = channelService.createSystemChannels(project.id);
      for (const channel of channels) {
        expect(channelService.listMembers(channel.id)).toHaveLength(0);
      }
    });
  });

  // ── onProjectCreated hook end-to-end ────────────────────────────────

  describe('ProjectService onProjectCreated hook', () => {
    it('wires ChannelService.createSystemChannels into project creation', async () => {
      // Reconstruct a ProjectService with the hook wired — this is the
      // shape Task 18 IPC layer will use.
      const wired = new ProjectService(projectRepo, arenaRootService, {
        onProjectCreated: (p) => {
          channelService.createSystemChannels(p.id);
        },
      });

      const project = await wired.create({
        name: 'Wired',
        kind: 'new',
        permissionMode: 'hybrid',
      });

      const channels = channelService.listByProject(project.id);
      expect(channels).toHaveLength(3);
      expect(channels.map((c) => c.kind)).toEqual([
        'system_general',
        'system_approval',
        'system_minutes',
      ]);
    });
  });

  // ── rename ──────────────────────────────────────────────────────────

  describe('rename', () => {
    it('renames a user channel', async () => {
      const project = await projectService.create({
        name: 'Ren',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const channel = channelService.create({
        projectId: project.id,
        name: 'old',
      });
      const renamed = channelService.rename(channel.id, 'new');
      expect(renamed.name).toBe('new');
      expect(channelRepo.get(channel.id)?.name).toBe('new');
    });

    it('throws SystemChannelProtectedError on system channel rename', async () => {
      const project = await projectService.create({
        name: 'Sys',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const [general] = channelService.createSystemChannels(project.id);
      expect(() => channelService.rename(general!.id, '잡담')).toThrow(
        SystemChannelProtectedError,
      );
    });

    it('throws DuplicateChannelNameError when renaming into an existing name', async () => {
      const project = await projectService.create({
        name: 'RenameDup',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      channelService.create({ projectId: project.id, name: 'taken' });
      const another = channelService.create({
        projectId: project.id,
        name: 'other',
      });
      expect(() => channelService.rename(another.id, 'taken')).toThrow(
        DuplicateChannelNameError,
      );
    });

    it('throws ChannelNotFoundError for unknown ids', () => {
      expect(() => channelService.rename('no-such-id', 'x')).toThrow(
        ChannelNotFoundError,
      );
    });
  });

  // ── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a user channel', async () => {
      const project = await projectService.create({
        name: 'Del',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const channel = channelService.create({
        projectId: project.id,
        name: 'gone',
      });
      channelService.delete(channel.id);
      expect(channelRepo.get(channel.id)).toBeNull();
    });

    it('throws SystemChannelProtectedError on system channel delete', async () => {
      const project = await projectService.create({
        name: 'SysDel',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const channels = channelService.createSystemChannels(project.id);
      for (const channel of channels) {
        expect(() => channelService.delete(channel.id)).toThrow(
          SystemChannelProtectedError,
        );
      }
      // All three still present.
      expect(channelService.listByProject(project.id)).toHaveLength(3);
    });

    it('throws ChannelNotFoundError for unknown ids', () => {
      expect(() => channelService.delete('missing')).toThrow(
        ChannelNotFoundError,
      );
    });
  });

  // ── DM ──────────────────────────────────────────────────────────────

  describe('createDm', () => {
    it('creates a DM channel with project_id=NULL and a single member row', () => {
      seedProvider(db, 'dm-prov');
      const channel = channelService.createDm('dm-prov');
      expect(channel.projectId).toBeNull();
      expect(channel.kind).toBe('dm');
      expect(channel.name).toBe('dm:dm-prov');
      const members = channelService.listMembers(channel.id);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        providerId: 'dm-prov',
        projectId: null,
        channelId: channel.id,
      });
    });

    it('throws DuplicateDmError when called twice for the same provider', () => {
      seedProvider(db, 'dm-twice');
      channelService.createDm('dm-twice');
      expect(() => channelService.createDm('dm-twice')).toThrow(DuplicateDmError);
    });

    it('allows DMs for different providers to coexist', () => {
      seedProvider(db, 'dm-a');
      seedProvider(db, 'dm-b');
      const a = channelService.createDm('dm-a');
      const b = channelService.createDm('dm-b');
      expect(a.id).not.toBe(b.id);
      expect(channelService.listDms().map((c) => c.id).sort()).toEqual(
        [a.id, b.id].sort(),
      );
    });
  });

  // ── addMember composite FK ──────────────────────────────────────────

  describe('addMember', () => {
    it('adds a member when the provider is already a project member', async () => {
      seedProvider(db, 'in-proj');
      const project = await projectService.create({
        name: 'AddMem',
        kind: 'new',
        permissionMode: 'hybrid',
        initialMemberProviderIds: ['in-proj'],
      });
      const channel = channelService.create({
        projectId: project.id,
        name: 'open',
      });
      channelService.addMember(channel.id, 'in-proj');
      const members = channelService.listMembers(channel.id);
      expect(members.map((m) => m.providerId)).toEqual(['in-proj']);
    });

    it('throws ChannelMemberFkError for a provider not in project_members', async () => {
      seedProvider(db, 'not-in-proj');
      const project = await projectService.create({
        name: 'FkReject',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const channel = channelService.create({
        projectId: project.id,
        name: 'closed',
      });
      expect(() =>
        channelService.addMember(channel.id, 'not-in-proj'),
      ).toThrow(ChannelMemberFkError);
    });

    it('throws ChannelNotFoundError for unknown channel', () => {
      expect(() => channelService.addMember('no-such-ch', 'prov')).toThrow(
        ChannelNotFoundError,
      );
    });
  });

  // ── listByProject ordering ──────────────────────────────────────────

  describe('listByProject', () => {
    it('returns system channels first (kind order), then user channels by createdAt', async () => {
      const project = await projectService.create({
        name: 'Ordering',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      channelService.createSystemChannels(project.id);
      // Ensure user channels get distinct createdAt values.
      const uA = channelService.create({
        projectId: project.id,
        name: 'user-a',
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const uB = channelService.create({
        projectId: project.id,
        name: 'user-b',
      });

      const listed = channelService.listByProject(project.id);
      expect(listed.map((c) => c.kind)).toEqual([
        'system_general',
        'system_approval',
        'system_minutes',
        'user',
        'user',
      ]);
      // User channels preserve insertion order.
      expect(listed[3]!.id).toBe(uA.id);
      expect(listed[4]!.id).toBe(uB.id);
    });
  });
});
