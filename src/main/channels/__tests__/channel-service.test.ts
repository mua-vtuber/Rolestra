/**
 * Unit tests for ChannelService.
 *
 * D1 (2026-09-28): ChannelService used to also cover project-scoped
 * channel CRUD (create/rename/delete/addMember/listByProject) and
 * department-channel provisioning (createSystemChannels/
 * createDepartmentChannels/updateRole/updateHandoffMode/reorderMembers/
 * getPermissions/updatePermissions). All of those methods were removed
 * from channel-service.ts — chat-first pivot left no IPC channel that
 * calls any of them (router.ts / ipc-types.ts confirm zero handlers), so
 * their 34 tests (9 describe blocks) were removed together with the dead
 * code. `channel-service-permissions.test.ts` (177 lines, covered only
 * `createDepartmentChannels`/`getPermissions`/`updatePermissions`/the
 * `'permission-changed'` event) was deleted outright — every test in it
 * exercised removed code.
 *
 * Coverage that remains:
 *   - createDm: partial-unique index enforcement → DuplicateDmError;
 *     channel_members row created with project_id=NULL
 *   - getGlobalGeneralChannel: throws when no row exists, returns it
 *     once inserted
 *
 * D1 follow-up (2026-09-29): the constructor's `ProjectMemberLookup`
 * parameter was residue from the same removal (only the deleted
 * department-provisioning methods read it) and was dropped from
 * ChannelService; `new ChannelService(channelRepo)` here no longer needs
 * a ProjectRepository at all.
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
import { ChannelRepository } from '../channel-repository';
import { ChannelService, DuplicateDmError } from '../channel-service';

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

    channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
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

  describe('R12-C: getGlobalGeneralChannel', () => {
    it('throws when no global general row exists yet', () => {
      // beforeEach ran migration 018 — system_general consolidation deleted
      // any pre-existing rows. No ensureGlobalGeneralChannel was called.
      expect(() => channelService.getGlobalGeneralChannel()).toThrow(
        /no global system_general row/,
      );
    });

    it('returns the row after one is inserted with project_id NULL', () => {
      db.prepare(
        `INSERT INTO channels
           (id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode)
         VALUES (?, NULL, ?, 'system_general', 0, ?, NULL, NULL, 'check')`,
      ).run('global-general', '#일반', 1700000000000);
      const ch = channelService.getGlobalGeneralChannel();
      expect(ch.id).toBe('global-general');
      expect(ch.projectId).toBeNull();
      expect(ch.kind).toBe('system_general');
      expect(ch.handoffMode).toBe('check');
    });
  });
});
