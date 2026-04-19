/**
 * Schema contract tests for v3 migrations 001~004 (core/projects/channels/meetings).
 *
 * These tests are the canonical proof that the migration SQL shipped in
 * `src/main/database/migrations/001-core.ts` through `004-meetings.ts` matches
 * the constraints declared in spec §5.2 (docs/superpowers/specs/2026-04-18-rolestra-design.md).
 *
 * Coverage:
 * - Table/index existence in sqlite_master
 * - CHECK constraints (kind / permission_mode / autonomy_mode / status / outcome)
 * - FK constraints (simple + composite)
 * - Partial unique indexes (DM per provider, active meeting per channel)
 * - ON DELETE CASCADE
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';

/** Timestamp stamp for any columns that demand a non-null INTEGER. */
const NOW = 1_700_000_000_000;

interface MasterRow {
  name: string;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as MasterRow | undefined;
  return row?.name === name;
}

function indexExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as MasterRow | undefined;
  return row?.name === name;
}

/** Inserts a single provider with the given id (and default display/kind). */
function insertProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Provider ${id}`, NOW, NOW);
}

/** Inserts a regular (non-DM, non-external) project. */
function insertProject(db: Database.Database, id: string, slug?: string): void {
  db.prepare(
    `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
     VALUES (?, ?, ?, 'new', 'auto', ?)`,
  ).run(id, slug ?? id, `Project ${id}`, NOW);
}

/** Inserts a project_members row linking a project to a provider. */
function insertProjectMember(
  db: Database.Database,
  projectId: string,
  providerId: string,
): void {
  db.prepare(
    `INSERT INTO project_members (project_id, provider_id, added_at)
     VALUES (?, ?, ?)`,
  ).run(projectId, providerId, NOW);
}

/** Inserts a channel belonging to a project. project_id=NULL means DM. */
function insertChannel(
  db: Database.Database,
  id: string,
  projectId: string | null,
  kind: string = 'user',
  name: string = `channel-${id}`,
): void {
  db.prepare(
    `INSERT INTO channels (id, project_id, name, kind, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, name, kind, NOW);
}

describe('v3 migrations 001-004 — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Mirror production connection.ts — FK enforcement must be ON.
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('creates all seven tables from migrations 001-004', () => {
      const expected = [
        'providers',
        'member_profiles',
        'projects',
        'project_members',
        'channels',
        'channel_members',
        'meetings',
      ];
      for (const name of expected) {
        expect(tableExists(db, name), `table ${name} missing`).toBe(true);
      }
    });

    it('creates all six explicit indexes from migrations 003-004', () => {
      const expected = [
        'idx_dm_unique_per_provider',
        'idx_channels_project',
        'idx_channel_members_channel',
        'idx_channel_members_provider',
        'idx_meetings_channel',
        'idx_meetings_active_per_channel',
      ];
      for (const name of expected) {
        expect(indexExists(db, name), `index ${name} missing`).toBe(true);
      }
    });

    it('records all four migration ids in the migrations tracking table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toEqual([
        '001-core',
        '002-projects',
        '003-channels',
        '004-meetings',
      ]);
    });
  });

  describe('CHECK constraints', () => {
    it('rejects providers.kind outside (api|cli|local)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
             VALUES (?, ?, ?, '{}', ?, ?)`,
          )
          .run('p1', 'P1', 'bogus', NOW, NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects projects.kind outside (new|external|imported)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
             VALUES (?, ?, ?, ?, 'auto', ?)`,
          )
          .run('pr1', 'pr1', 'Proj', 'foo', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects projects.permission_mode outside (auto|hybrid|approval)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
             VALUES (?, ?, ?, 'new', ?, ?)`,
          )
          .run('pr2', 'pr2', 'Proj', 'invalid', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects projects.autonomy_mode outside (manual|auto_toggle|queue)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, slug, name, kind, permission_mode, autonomy_mode, created_at)
             VALUES (?, ?, ?, 'new', 'auto', ?, ?)`,
          )
          .run('pr3', 'pr3', 'Proj', 'turbo', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects projects.status outside (active|folder_missing|archived)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, slug, name, kind, permission_mode, status, created_at)
             VALUES (?, ?, ?, 'new', 'auto', ?, ?)`,
          )
          .run('pr4', 'pr4', 'Proj', 'deleted', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects channels.kind outside the five allowed values', () => {
      insertProject(db, 'proj-ck');
      expect(() =>
        db
          .prepare(
            `INSERT INTO channels (id, project_id, name, kind, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('c1', 'proj-ck', 'foo', 'direct_msg', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects meetings.outcome outside (accepted|rejected|aborted|NULL)', () => {
      insertProject(db, 'proj-mt');
      insertChannel(db, 'chan-mt', 'proj-mt');
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, state, started_at, outcome)
             VALUES (?, ?, 'running', ?, ?)`,
          )
          .run('m-bad', 'chan-mt', NOW, 'postponed'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('accepts meetings.outcome = NULL (CHECK allows NULL explicitly)', () => {
      insertProject(db, 'proj-mt2');
      insertChannel(db, 'chan-mt2', 'proj-mt2');
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, state, started_at)
             VALUES (?, ?, 'running', ?)`,
          )
          .run('m-null', 'chan-mt2', NOW),
      ).not.toThrow();
    });
  });

  describe('FK enforcement (PRAGMA foreign_keys=ON)', () => {
    it('rejects member_profiles with nonexistent provider_id', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO member_profiles (provider_id, updated_at) VALUES (?, ?)`,
          )
          .run('no-such-provider', NOW),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects project_members with nonexistent project_id', () => {
      insertProvider(db, 'prov-a');
      expect(() =>
        db
          .prepare(
            `INSERT INTO project_members (project_id, provider_id, added_at)
             VALUES (?, ?, ?)`,
          )
          .run('no-such-project', 'prov-a', NOW),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects project_members with nonexistent provider_id', () => {
      insertProject(db, 'proj-a');
      expect(() =>
        db
          .prepare(
            `INSERT INTO project_members (project_id, provider_id, added_at)
             VALUES (?, ?, ?)`,
          )
          .run('proj-a', 'no-such-provider', NOW),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects channels referencing a missing project_id', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO channels (id, project_id, name, kind, created_at)
             VALUES (?, ?, ?, 'user', ?)`,
          )
          .run('c-orphan', 'no-such-project', 'ch', NOW),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects meetings referencing a missing channel_id', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, state, started_at)
             VALUES (?, ?, 'running', ?)`,
          )
          .run('m-orphan', 'no-such-channel', NOW),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('channel_members composite FK (subset invariant, CD-3)', () => {
    it('rejects a non-DM channel member whose (project_id, provider_id) is not in project_members', () => {
      insertProvider(db, 'prov-x');
      insertProject(db, 'proj-x');
      insertChannel(db, 'chan-x', 'proj-x');
      // Intentionally NOT inserting project_members row for (proj-x, prov-x).

      expect(() =>
        db
          .prepare(
            `INSERT INTO channel_members (channel_id, project_id, provider_id)
             VALUES (?, ?, ?)`,
          )
          .run('chan-x', 'proj-x', 'prov-x'),
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('accepts a non-DM channel member once (project_id, provider_id) exists in project_members', () => {
      insertProvider(db, 'prov-y');
      insertProject(db, 'proj-y');
      insertProjectMember(db, 'proj-y', 'prov-y');
      insertChannel(db, 'chan-y', 'proj-y');

      expect(() =>
        db
          .prepare(
            `INSERT INTO channel_members (channel_id, project_id, provider_id)
             VALUES (?, ?, ?)`,
          )
          .run('chan-y', 'proj-y', 'prov-y'),
      ).not.toThrow();
    });

    it('accepts a DM channel member (project_id IS NULL) without project_members row', () => {
      insertProvider(db, 'prov-dm');
      insertChannel(db, 'chan-dm', null, 'dm');

      expect(() =>
        db
          .prepare(
            `INSERT INTO channel_members (channel_id, project_id, provider_id)
             VALUES (?, NULL, ?)`,
          )
          .run('chan-dm', 'prov-dm'),
      ).not.toThrow();
    });
  });

  describe('idx_dm_unique_per_provider (partial unique, DM only)', () => {
    it('rejects a second DM membership for the same provider (both with project_id=NULL)', () => {
      insertProvider(db, 'prov-dup');
      insertChannel(db, 'dm-1', null, 'dm', 'dm-1');
      insertChannel(db, 'dm-2', null, 'dm', 'dm-2');

      db.prepare(
        `INSERT INTO channel_members (channel_id, project_id, provider_id)
         VALUES (?, NULL, ?)`,
      ).run('dm-1', 'prov-dup');

      expect(() =>
        db
          .prepare(
            `INSERT INTO channel_members (channel_id, project_id, provider_id)
             VALUES (?, NULL, ?)`,
          )
          .run('dm-2', 'prov-dup'),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it('allows the same provider to be a member of multiple non-DM (project) channels', () => {
      insertProvider(db, 'prov-multi');
      insertProject(db, 'proj-multi');
      insertProjectMember(db, 'proj-multi', 'prov-multi');
      insertChannel(db, 'chan-m1', 'proj-multi', 'user', 'general');
      insertChannel(db, 'chan-m2', 'proj-multi', 'user', 'dev');

      db.prepare(
        `INSERT INTO channel_members (channel_id, project_id, provider_id)
         VALUES (?, ?, ?)`,
      ).run('chan-m1', 'proj-multi', 'prov-multi');

      expect(() =>
        db
          .prepare(
            `INSERT INTO channel_members (channel_id, project_id, provider_id)
             VALUES (?, ?, ?)`,
          )
          .run('chan-m2', 'proj-multi', 'prov-multi'),
      ).not.toThrow();
    });
  });

  describe('idx_meetings_active_per_channel (partial unique, ended_at IS NULL)', () => {
    it('rejects a second active meeting on the same channel', () => {
      insertProject(db, 'proj-meet');
      insertChannel(db, 'chan-meet', 'proj-meet');

      db.prepare(
        `INSERT INTO meetings (id, channel_id, state, started_at)
         VALUES (?, ?, 'running', ?)`,
      ).run('m1', 'chan-meet', NOW);

      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, state, started_at)
             VALUES (?, ?, 'running', ?)`,
          )
          .run('m2', 'chan-meet', NOW + 1),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it('allows a new active meeting after the previous one ended (ended_at set)', () => {
      insertProject(db, 'proj-meet2');
      insertChannel(db, 'chan-meet2', 'proj-meet2');

      db.prepare(
        `INSERT INTO meetings (id, channel_id, state, started_at)
         VALUES (?, ?, 'running', ?)`,
      ).run('m1', 'chan-meet2', NOW);

      // End the first meeting.
      db.prepare(
        `UPDATE meetings SET ended_at = ?, state = 'ended' WHERE id = ?`,
      ).run(NOW + 100, 'm1');

      // Now a new active meeting should be allowed.
      expect(() =>
        db
          .prepare(
            `INSERT INTO meetings (id, channel_id, state, started_at)
             VALUES (?, ?, 'running', ?)`,
          )
          .run('m2', 'chan-meet2', NOW + 200),
      ).not.toThrow();
    });
  });

  describe('UNIQUE(project_id, name) on channels', () => {
    it('rejects duplicate (project_id, name) pairs', () => {
      insertProject(db, 'proj-u');
      insertChannel(db, 'ch-u1', 'proj-u', 'user', 'general');
      expect(() =>
        db
          .prepare(
            `INSERT INTO channels (id, project_id, name, kind, created_at)
             VALUES (?, ?, 'general', 'user', ?)`,
          )
          .run('ch-u2', 'proj-u', NOW),
      ).toThrow(/UNIQUE constraint failed/);
    });
  });

  describe('ON DELETE CASCADE', () => {
    it('deleting a provider cascades to member_profiles', () => {
      insertProvider(db, 'prov-cascade');
      db.prepare(
        `INSERT INTO member_profiles (provider_id, updated_at) VALUES (?, ?)`,
      ).run('prov-cascade', NOW);

      db.prepare(`DELETE FROM providers WHERE id = ?`).run('prov-cascade');

      const row = db
        .prepare(`SELECT provider_id FROM member_profiles WHERE provider_id = ?`)
        .get('prov-cascade');
      expect(row).toBeUndefined();
    });

    it('deleting a project cascades to project_members, channels, channel_members, meetings', () => {
      insertProvider(db, 'prov-casc2');
      insertProject(db, 'proj-casc');
      insertProjectMember(db, 'proj-casc', 'prov-casc2');
      insertChannel(db, 'chan-casc', 'proj-casc');
      db.prepare(
        `INSERT INTO channel_members (channel_id, project_id, provider_id)
         VALUES (?, ?, ?)`,
      ).run('chan-casc', 'proj-casc', 'prov-casc2');
      db.prepare(
        `INSERT INTO meetings (id, channel_id, state, started_at)
         VALUES (?, ?, 'running', ?)`,
      ).run('mtg-casc', 'chan-casc', NOW);

      db.prepare(`DELETE FROM projects WHERE id = ?`).run('proj-casc');

      const pm = db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ?`)
        .get('proj-casc');
      const ch = db
        .prepare(`SELECT 1 FROM channels WHERE project_id = ?`)
        .get('proj-casc');
      const cm = db
        .prepare(`SELECT 1 FROM channel_members WHERE channel_id = ?`)
        .get('chan-casc');
      const mt = db
        .prepare(`SELECT 1 FROM meetings WHERE channel_id = ?`)
        .get('chan-casc');

      expect(pm).toBeUndefined();
      expect(ch).toBeUndefined();
      expect(cm).toBeUndefined();
      expect(mt).toBeUndefined();

      // The provider itself must survive (project deletion does not cascade to providers).
      const prov = db
        .prepare(`SELECT id FROM providers WHERE id = ?`)
        .get('prov-casc2') as { id: string } | undefined;
      expect(prov?.id).toBe('prov-casc2');
    });
  });
});
