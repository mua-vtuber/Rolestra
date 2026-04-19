/**
 * Schema contract tests for v3 migrations 005~007
 * (messages + FTS5, approval_items, queue_items).
 *
 * Canonical proof that the migration SQL shipped in
 * `src/main/database/migrations/005-messages.ts` through `007-queue.ts`
 * matches the constraints declared in spec §5.2
 * (docs/superpowers/specs/2026-04-18-rolestra-design.md lines 344-438).
 *
 * Coverage:
 * - messages: FTS5 MATCH on INSERT/UPDATE/DELETE, conditional author FK trigger,
 *   `id` UNIQUE
 * - approval_items: kind/status CHECKs, ON DELETE SET NULL (audit preserving),
 *   idx_approval_status
 * - queue_items: status CHECK, duplicate order_index allowed within project,
 *   ON DELETE CASCADE on project, idx_queue_project_order
 * - projects.slug UNIQUE negative case (Task 1 code review follow-up; placed
 *   here because this file already provisions projects)
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import {
  NOW,
  indexExists,
  insertChannel,
  insertProject,
  insertProvider,
  tableExists,
  triggerExists,
} from './_helpers';

/** Inserts a valid meeting belonging to `channelId`. */
function insertMeeting(
  db: Database.Database,
  id: string,
  channelId: string,
): void {
  db.prepare(
    `INSERT INTO meetings (id, channel_id, state, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).run(id, channelId, NOW);
}

/** Inserts a system-authored message (author_kind='system' bypasses FK trigger). */
function insertSystemMessage(
  db: Database.Database,
  id: string,
  channelId: string,
  content: string,
  createdAt: number = NOW,
): void {
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
     VALUES (?, ?, 'system', 'system', 'system', ?, ?)`,
  ).run(id, channelId, content, createdAt);
}

describe('v3 migrations 005-007 — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('sqlite_master presence', () => {
    it('creates messages + messages_fts + approval_items + queue_items tables', () => {
      const expected = [
        'messages',
        'messages_fts',
        'approval_items',
        'queue_items',
      ];
      for (const name of expected) {
        expect(tableExists(db, name), `table ${name} missing`).toBe(true);
      }
    });

    it('creates all expected indexes from migrations 005-007', () => {
      const expected = [
        'idx_messages_channel_time',
        'idx_messages_meeting',
        'idx_messages_id',
        'idx_approval_status',
        'idx_queue_project_order',
      ];
      for (const name of expected) {
        expect(indexExists(db, name), `index ${name} missing`).toBe(true);
      }
    });

    it('creates the conditional author FK trigger and the three FTS triggers', () => {
      const expected = [
        'messages_author_fk_check',
        'messages_fts_ai',
        'messages_fts_ad',
        'messages_fts_au',
      ];
      for (const name of expected) {
        expect(triggerExists(db, name), `trigger ${name} missing`).toBe(true);
      }
    });

    it('records 005/006/007 migration ids in the migrations tracking table', () => {
      const rows = db
        .prepare('SELECT id FROM migrations ORDER BY rowid')
        .all() as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toEqual([
        '001-core',
        '002-projects',
        '003-channels',
        '004-meetings',
        '005-messages',
        '006-approval-inbox',
        '007-queue',
      ]);
    });
  });

  describe('005 messages + FTS5', () => {
    beforeEach(() => {
      insertProject(db, 'proj-msg');
      insertChannel(db, 'chan-msg', 'proj-msg');
    });

    describe('FTS5 MATCH', () => {
      it('INSERT: returns only messages whose content matches the query', () => {
        insertSystemMessage(db, 'msg-1', 'chan-msg', 'hello foo world', NOW);
        insertSystemMessage(db, 'msg-2', 'chan-msg', 'bar baz qux', NOW + 1);
        insertSystemMessage(db, 'msg-3', 'chan-msg', 'foo again here', NOW + 2);

        const rows = db
          .prepare(
            `SELECT m.id FROM messages m
               JOIN messages_fts f ON f.rowid = m.rowid
             WHERE messages_fts MATCH ?
             ORDER BY m.created_at`,
          )
          .all('foo') as Array<{ id: string }>;

        expect(rows.map((r) => r.id)).toEqual(['msg-1', 'msg-3']);
      });

      it('UPDATE: FTS reflects the new content and drops the old match', () => {
        insertSystemMessage(db, 'msg-u', 'chan-msg', 'alpha keyword here', NOW);

        // Old keyword matches.
        expect(
          (
            db
              .prepare(
                `SELECT count(*) AS c FROM messages_fts WHERE messages_fts MATCH ?`,
              )
              .get('alpha') as { c: number }
          ).c,
        ).toBe(1);

        db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(
          'omega rewritten text',
          'msg-u',
        );

        // Old keyword no longer matches.
        expect(
          (
            db
              .prepare(
                `SELECT count(*) AS c FROM messages_fts WHERE messages_fts MATCH ?`,
              )
              .get('alpha') as { c: number }
          ).c,
        ).toBe(0);

        // New keyword does.
        const rows = db
          .prepare(
            `SELECT m.id FROM messages m
               JOIN messages_fts f ON f.rowid = m.rowid
             WHERE messages_fts MATCH ?`,
          )
          .all('omega') as Array<{ id: string }>;
        expect(rows.map((r) => r.id)).toEqual(['msg-u']);
      });

      it('DELETE: FTS no longer matches the deleted row', () => {
        insertSystemMessage(db, 'msg-d', 'chan-msg', 'ephemeral content', NOW);

        expect(
          (
            db
              .prepare(
                `SELECT count(*) AS c FROM messages_fts WHERE messages_fts MATCH ?`,
              )
              .get('ephemeral') as { c: number }
          ).c,
        ).toBe(1);

        db.prepare(`DELETE FROM messages WHERE id = ?`).run('msg-d');

        expect(
          (
            db
              .prepare(
                `SELECT count(*) AS c FROM messages_fts WHERE messages_fts MATCH ?`,
              )
              .get('ephemeral') as { c: number }
          ).c,
        ).toBe(0);
      });
    });

    describe('messages_author_fk_check trigger', () => {
      it('rejects author_kind=member when author_id is not a known provider', () => {
        expect(() =>
          db
            .prepare(
              `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
               VALUES (?, ?, ?, 'member', 'assistant', ?, ?)`,
            )
            .run('m-ghost', 'chan-msg', 'ghost-provider', 'hi', NOW),
        ).toThrow(
          /messages\.author_id must reference providers\.id when author_kind=member/,
        );
      });

      it('rejects author_kind=user when author_id is not the literal "user"', () => {
        expect(() =>
          db
            .prepare(
              `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
               VALUES (?, ?, ?, 'user', 'user', ?, ?)`,
            )
            .run('m-bob', 'chan-msg', 'bob', 'hi', NOW),
        ).toThrow(
          /messages\.author_id must be literal "user" when author_kind=user/,
        );
      });

      it('accepts author_kind=user when author_id is exactly "user"', () => {
        expect(() =>
          db
            .prepare(
              `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
               VALUES (?, ?, 'user', 'user', 'user', ?, ?)`,
            )
            .run('m-user-ok', 'chan-msg', 'hi from user', NOW),
        ).not.toThrow();
      });

      it('accepts author_kind=member when author_id references a real provider', () => {
        insertProvider(db, 'prov-real');
        expect(() =>
          db
            .prepare(
              `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
               VALUES (?, ?, ?, 'member', 'assistant', ?, ?)`,
            )
            .run('m-member-ok', 'chan-msg', 'prov-real', 'hi', NOW),
        ).not.toThrow();
      });

      it('accepts author_kind=system regardless of author_id value', () => {
        // author_kind='system' is not constrained by the trigger — spec only
        // enforces the two listed WHEN clauses.
        expect(() =>
          db
            .prepare(
              `INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
               VALUES (?, ?, ?, 'system', 'system', ?, ?)`,
            )
            .run('m-sys-ok', 'chan-msg', 'whatever', 'sys', NOW),
        ).not.toThrow();
      });
    });

    describe('messages.id UNIQUE', () => {
      it('rejects a duplicate application-level id', () => {
        insertSystemMessage(db, 'dup-id', 'chan-msg', 'first', NOW);
        expect(() =>
          insertSystemMessage(db, 'dup-id', 'chan-msg', 'second', NOW + 1),
        ).toThrow(/UNIQUE constraint failed/);
      });
    });

    describe('FK behaviour (meeting_id SET NULL)', () => {
      it('deleting the parent meeting sets meeting_id to NULL (message preserved)', () => {
        insertMeeting(db, 'mtg-m', 'chan-msg');
        db.prepare(
          `INSERT INTO messages (id, channel_id, meeting_id, author_id, author_kind, role, content, created_at)
           VALUES (?, ?, ?, 'system', 'system', 'system', ?, ?)`,
        ).run('m-with-mtg', 'chan-msg', 'mtg-m', 'in a meeting', NOW);

        db.prepare(`DELETE FROM meetings WHERE id = ?`).run('mtg-m');

        const row = db
          .prepare(`SELECT meeting_id FROM messages WHERE id = ?`)
          .get('m-with-mtg') as { meeting_id: string | null } | undefined;
        expect(row?.meeting_id).toBeNull();
      });
    });
  });

  describe('006 approval_items', () => {
    it('rejects invalid kind values', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO approval_items (id, kind, payload_json, created_at)
             VALUES (?, ?, '{}', ?)`,
          )
          .run('a-bad-kind', 'not_a_real_kind', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects invalid status values', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO approval_items (id, kind, payload_json, status, created_at)
             VALUES (?, 'cli_permission', '{}', ?, ?)`,
          )
          .run('a-bad-status', 'maybe', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('accepts a fully-populated valid row (all five kinds, status defaults to pending)', () => {
      const kinds = [
        'cli_permission',
        'mode_transition',
        'consensus_decision',
        'review_outcome',
        'failure_report',
      ];
      for (let i = 0; i < kinds.length; i++) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO approval_items (id, kind, payload_json, created_at)
               VALUES (?, ?, '{"x":1}', ?)`,
            )
            .run(`a-${i}`, kinds[i], NOW + i),
        ).not.toThrow();
      }

      const row = db
        .prepare(`SELECT status FROM approval_items WHERE id = ?`)
        .get('a-0') as { status: string } | undefined;
      expect(row?.status).toBe('pending');
    });

    it('preserves the approval record when the parent project is deleted (ON DELETE SET NULL)', () => {
      insertProject(db, 'proj-audit', 'proj-audit');
      db.prepare(
        `INSERT INTO approval_items (id, kind, project_id, payload_json, created_at)
         VALUES (?, 'consensus_decision', ?, '{}', ?)`,
      ).run('a-audit', 'proj-audit', NOW);

      db.prepare(`DELETE FROM projects WHERE id = ?`).run('proj-audit');

      const row = db
        .prepare(
          `SELECT id, project_id, kind FROM approval_items WHERE id = ?`,
        )
        .get('a-audit') as
        | { id: string; project_id: string | null; kind: string }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.project_id).toBeNull();
      expect(row?.kind).toBe('consensus_decision');
    });
  });

  describe('007 queue_items', () => {
    beforeEach(() => {
      insertProject(db, 'proj-q');
      insertChannel(db, 'chan-q', 'proj-q');
    });

    it('rejects invalid status values', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO queue_items (id, project_id, order_index, prompt, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('q-bad', 'proj-q', 1000, 'hi', 'zombie', NOW),
      ).toThrow(/CHECK constraint failed/);
    });

    it('accepts all six valid status values', () => {
      const statuses = [
        'pending',
        'in_progress',
        'done',
        'failed',
        'cancelled',
        'paused',
      ];
      for (let i = 0; i < statuses.length; i++) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO queue_items (id, project_id, order_index, prompt, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(`q-s-${i}`, 'proj-q', 1000 + i, 'p', statuses[i], NOW + i),
        ).not.toThrow();
      }
    });

    it('allows duplicate order_index within the same project (not a PK or UNIQUE)', () => {
      db.prepare(
        `INSERT INTO queue_items (id, project_id, order_index, prompt, created_at)
         VALUES (?, ?, 1000, ?, ?)`,
      ).run('q-dup-1', 'proj-q', 'first', NOW);

      expect(() =>
        db
          .prepare(
            `INSERT INTO queue_items (id, project_id, order_index, prompt, created_at)
             VALUES (?, ?, 1000, ?, ?)`,
          )
          .run('q-dup-2', 'proj-q', 'second', NOW + 1),
      ).not.toThrow();
    });

    it('deleting the parent project cascades and removes all queue_items', () => {
      insertProject(db, 'proj-qc', 'proj-qc');
      db.prepare(
        `INSERT INTO queue_items (id, project_id, order_index, prompt, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('q-casc', 'proj-qc', 1000, 'go', NOW);

      db.prepare(`DELETE FROM projects WHERE id = ?`).run('proj-qc');

      const row = db
        .prepare(`SELECT 1 FROM queue_items WHERE id = ?`)
        .get('q-casc');
      expect(row).toBeUndefined();
    });

    it('SET NULL fires when the referenced channel or meeting is deleted', () => {
      insertMeeting(db, 'mtg-q', 'chan-q');
      db.prepare(
        `INSERT INTO queue_items
         (id, project_id, target_channel_id, started_meeting_id, order_index, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('q-links', 'proj-q', 'chan-q', 'mtg-q', 1000, 'p', NOW);

      // Deleting the meeting first (SET NULL) is safe.
      db.prepare(`DELETE FROM meetings WHERE id = ?`).run('mtg-q');
      let row = db
        .prepare(
          `SELECT target_channel_id, started_meeting_id FROM queue_items WHERE id = ?`,
        )
        .get('q-links') as
        | { target_channel_id: string | null; started_meeting_id: string | null }
        | undefined;
      expect(row?.started_meeting_id).toBeNull();
      expect(row?.target_channel_id).toBe('chan-q');

      // Now delete the channel: target_channel_id becomes NULL, queue row preserved.
      db.prepare(`DELETE FROM channels WHERE id = ?`).run('chan-q');
      row = db
        .prepare(
          `SELECT target_channel_id, started_meeting_id FROM queue_items WHERE id = ?`,
        )
        .get('q-links') as
        | { target_channel_id: string | null; started_meeting_id: string | null }
        | undefined;
      expect(row?.target_channel_id).toBeNull();
    });
  });

  describe('projects.slug UNIQUE (Task 1 follow-up)', () => {
    it('rejects a second project insert with the same slug', () => {
      insertProject(db, 'proj-slug-1', 'duplicate-slug');

      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
             VALUES (?, ?, ?, 'new', 'auto', ?)`,
          )
          .run('proj-slug-2', 'duplicate-slug', 'Other Project', NOW + 1),
      ).toThrow(/UNIQUE constraint failed/);
    });
  });
});
