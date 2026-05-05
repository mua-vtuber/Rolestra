/**
 * Schema contract tests for v3 migrations 008~011
 * (memory / audit / remote / notifications).
 *
 * Canonical proof that the migration SQL shipped in
 * `src/main/database/migrations/008-memory.ts` through
 * `011-notifications.ts` matches the constraints declared in spec §5.2
 * (docs/specs/2026-04-18-rolestra-design.md lines 440-463) and
 * preserves the audit-safety invariants from §12 Security.
 *
 * Coverage:
 * - sqlite_master enumeration: 11 v3 migrations registered, every expected
 *   table/index/trigger present.
 * - 008 memory: knowledge_nodes carries v2 enhancement columns, FTS5 triggers
 *   keep `knowledge_fts` in sync, knowledge_nodes does NOT FK any v3-side
 *   table (independence per spec §5.2 008).
 * - 009 audit: action/result CHECKs reject garbage; no FK exists, so deleting
 *   any other v3 row leaves audit history intact.
 * - 010 remote: remote_audit_log survives `remote_access_grants` deletion
 *   (no FK); CHECK that grant uniqueness on token_hash holds.
 * - 011 notifications: key CHECK rejects unknown kinds; channel_id FK is
 *   ON DELETE SET NULL (audit preservation).
 * - Idempotency: running `runMigrations` twice on the same DB is a no-op.
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
  tableExists,
  triggerExists,
} from './_helpers';

describe('v3 migrations 008-011 — schema contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  // ── sqlite_master enumeration ──────────────────────────────────────────
  describe('sqlite_master presence', () => {
    it('creates all expected tables from migrations 008-011', () => {
      const expected = [
        // 008 memory
        'knowledge_nodes',
        'knowledge_fts',
        'knowledge_edges',
        // 009 audit
        'audit_log',
        // 010 remote
        'remote_access_grants',
        'remote_audit_log',
        // 011 notifications
        'notification_prefs',
        'notification_log',
      ];
      for (const name of expected) {
        expect(tableExists(db, name), `table ${name} missing`).toBe(true);
      }
    });

    it('creates all expected indexes from migrations 008-010', () => {
      const expected = [
        // 008 memory
        'idx_knowledge_nodes_topic',
        'idx_knowledge_nodes_conversation_id',
        'idx_knowledge_nodes_dedupe_key',
        'idx_knowledge_nodes_deleted_at',
        'idx_knowledge_edges_source_node_id',
        'idx_knowledge_edges_target_node_id',
        'idx_knowledge_nodes_participant',
        'idx_knowledge_nodes_mention',
        // 009 audit
        'idx_audit_log_ai_id',
        'idx_audit_log_timestamp',
        'idx_audit_log_action',
        'idx_audit_log_result',
        // 010 remote
        'idx_remote_audit_log_session_id',
        'idx_remote_audit_log_timestamp',
        'idx_remote_grants_token_hash',
      ];
      for (const name of expected) {
        expect(indexExists(db, name), `index ${name} missing`).toBe(true);
      }
    });

    it('creates the three FTS5 sync triggers from migration 008', () => {
      const expected = [
        'knowledge_fts_insert',
        'knowledge_fts_update',
        'knowledge_fts_delete',
      ];
      for (const name of expected) {
        expect(triggerExists(db, name), `trigger ${name} missing`).toBe(true);
      }
    });

    it('records all 18 migration ids in the migrations tracking table', () => {
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
        '008-memory',
        '009-audit',
        '010-remote',
        '011-notifications',
        '012-circuit-breaker-state',
        '013-onboarding-state',
        '014-llm-cost-audit-log',
        '015-approval-circuit-breaker-kind',
        '016-meeting-paused-and-kind',
        '017-providers-roles-skills',
        '018-channels-role-purpose-handoff',
      ]);
    });
  });

  // ── 008 memory ─────────────────────────────────────────────────────────
  describe('008 memory (knowledge graph + FTS5)', () => {
    it('knowledge_nodes accepts the v2 base + 004 enhancement columns in one INSERT', () => {
      // Single INSERT exercising every enhancement column proves the schema is
      // the merged shape (v2 ALTER TABLE outputs collapsed into v3 single-shot).
      db.prepare(
        `INSERT INTO knowledge_nodes
          (id, content, node_type, topic,
           participant_id, last_mentioned_at, mention_count, confidence,
           created_at, updated_at)
         VALUES (?, ?, 'fact', 'general',
                 ?, ?, ?, ?,
                 datetime('now'), datetime('now'))`,
      ).run(
        'kn-1',
        'Claude prefers explicit error handling.',
        'prov-claude',
        '2026-04-19 10:00:00',
        3,
        0.85,
      );

      const row = db
        .prepare(
          `SELECT participant_id, mention_count, confidence
             FROM knowledge_nodes WHERE id = ?`,
        )
        .get('kn-1') as
        | {
            participant_id: string | null;
            mention_count: number;
            confidence: number;
          }
        | undefined;

      expect(row?.participant_id).toBe('prov-claude');
      expect(row?.mention_count).toBe(3);
      expect(row?.confidence).toBeCloseTo(0.85);
    });

    it('FTS5 INSERT trigger lets MATCH find a freshly inserted node', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, content, node_type, topic)
         VALUES (?, ?, 'fact', 'general')`,
      ).run('kn-fts-1', 'the quick brown fox jumps');

      const matches = db
        .prepare(
          `SELECT n.id FROM knowledge_nodes n
             JOIN knowledge_fts f ON f.rowid = n.rowid
           WHERE knowledge_fts MATCH ?`,
        )
        .all('quick') as Array<{ id: string }>;
      expect(matches.map((r) => r.id)).toEqual(['kn-fts-1']);
    });

    it('FTS5 UPDATE trigger drops the old term and indexes the new one', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, content, node_type, topic)
         VALUES (?, ?, 'fact', 'general')`,
      ).run('kn-fts-u', 'alpha keyword present');

      db.prepare(`UPDATE knowledge_nodes SET content = ? WHERE id = ?`).run(
        'omega rewritten payload',
        'kn-fts-u',
      );

      const oldHits = (
        db
          .prepare(
            `SELECT count(*) AS c FROM knowledge_fts WHERE knowledge_fts MATCH ?`,
          )
          .get('alpha') as { c: number }
      ).c;
      const newHits = (
        db
          .prepare(
            `SELECT count(*) AS c FROM knowledge_fts WHERE knowledge_fts MATCH ?`,
          )
          .get('omega') as { c: number }
      ).c;
      expect(oldHits).toBe(0);
      expect(newHits).toBe(1);
    });

    it('FTS5 soft-delete trigger removes a node from FTS when deleted_at is set', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, content, node_type, topic)
         VALUES (?, ?, 'fact', 'general')`,
      ).run('kn-soft', 'ephemeral memory entry');

      expect(
        (
          db
            .prepare(
              `SELECT count(*) AS c FROM knowledge_fts WHERE knowledge_fts MATCH ?`,
            )
            .get('ephemeral') as { c: number }
        ).c,
      ).toBe(1);

      db.prepare(
        `UPDATE knowledge_nodes SET deleted_at = datetime('now') WHERE id = ?`,
      ).run('kn-soft');

      expect(
        (
          db
            .prepare(
              `SELECT count(*) AS c FROM knowledge_fts WHERE knowledge_fts MATCH ?`,
            )
            .get('ephemeral') as { c: number }
        ).c,
      ).toBe(0);
    });

    it('knowledge_nodes is independent — no FK to v3 messages/channels/projects', () => {
      // Spec §5.2 008: memory must not reference v3 messages.
      // Storing a non-existent conversation_id / message_id must succeed.
      expect(() =>
        db
          .prepare(
            `INSERT INTO knowledge_nodes
              (id, content, node_type, topic, conversation_id, message_id)
             VALUES (?, 'x', 'fact', 'general', ?, ?)`,
          )
          .run('kn-indep', 'no-such-conv', 'no-such-msg'),
      ).not.toThrow();

      // Confirm via PRAGMA: the table has zero foreign keys.
      const fks = db.pragma('foreign_key_list(knowledge_nodes)') as Array<{
        table: string;
      }>;
      expect(fks).toHaveLength(0);
    });
  });

  // ── 009 audit ──────────────────────────────────────────────────────────
  describe('009 audit_log', () => {
    it('rejects an invalid action value via CHECK', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO audit_log (operation_id, ai_id, action, target_path, timestamp, result)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('op-bad-act', 'prov-x', 'demolish', '/tmp/x', NOW, 'success'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('rejects an invalid result value via CHECK', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO audit_log (operation_id, ai_id, action, target_path, timestamp, result)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('op-bad-res', 'prov-x', 'read', '/tmp/x', NOW, 'maybe'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('accepts every valid (action, result) combination', () => {
      const actions = ['read', 'write', 'execute', 'apply-patch'] as const;
      const results = ['success', 'denied', 'failed'] as const;
      let i = 0;
      for (const action of actions) {
        for (const result of results) {
          expect(() =>
            db
              .prepare(
                `INSERT INTO audit_log
                  (operation_id, ai_id, action, target_path, timestamp, result, rollbackable, details)
                 VALUES (?, 'prov-x', ?, '/tmp/x', ?, ?, 0, NULL)`,
              )
              .run(`op-ok-${i}`, action, NOW + i, result),
          ).not.toThrow();
          i++;
        }
      }
    });

    it('survives parent-row deletion: audit_log has no FK', () => {
      // Insert audit rows that reference (by string) a project, a channel,
      // and a provider that we then delete. The audit row must remain intact.
      const provId = 'prov-audit';
      db.prepare(
        `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
         VALUES (?, 'p', 'api', '{}', ?, ?)`,
      ).run(provId, NOW, NOW);
      insertProject(db, 'proj-audit');
      insertChannel(db, 'chan-audit', 'proj-audit');

      db.prepare(
        `INSERT INTO audit_log (operation_id, ai_id, action, target_path, timestamp, result, details)
         VALUES (?, ?, 'execute', ?, ?, 'success', ?)`,
      ).run('op-keep', provId, '/tmp/some.txt', NOW, 'project=proj-audit channel=chan-audit');

      // Wipe the would-be parents.
      db.prepare(`DELETE FROM channels WHERE id = ?`).run('chan-audit');
      db.prepare(`DELETE FROM projects WHERE id = ?`).run('proj-audit');
      db.prepare(`DELETE FROM providers WHERE id = ?`).run(provId);

      const row = db
        .prepare(`SELECT operation_id, ai_id FROM audit_log WHERE operation_id = ?`)
        .get('op-keep') as { operation_id: string; ai_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.ai_id).toBe(provId);

      // Defensive: confirm the schema declares zero FKs.
      const fks = db.pragma('foreign_key_list(audit_log)') as Array<{
        table: string;
      }>;
      expect(fks).toHaveLength(0);
    });
  });

  // ── 010 remote ─────────────────────────────────────────────────────────
  describe('010 remote_*', () => {
    it('rejects a duplicate token_hash on remote_access_grants', () => {
      db.prepare(
        `INSERT INTO remote_access_grants (grant_id, token_hash, created_at, permissions)
         VALUES (?, ?, ?, '{}')`,
      ).run('g1', 'tokenABC', NOW);

      expect(() =>
        db
          .prepare(
            `INSERT INTO remote_access_grants (grant_id, token_hash, created_at, permissions)
             VALUES (?, ?, ?, '{}')`,
          )
          .run('g2', 'tokenABC', NOW + 1),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it('remote_audit_log has no FK and survives grant deletion', () => {
      db.prepare(
        `INSERT INTO remote_access_grants (grant_id, token_hash, created_at, permissions)
         VALUES (?, ?, ?, '{}')`,
      ).run('g-del', 'tokDEL', NOW);

      db.prepare(
        `INSERT INTO remote_audit_log
          (audit_id, timestamp, session_id, action, result)
         VALUES (?, ?, ?, 'login', 'success')`,
      ).run('a-keep', NOW, 'sess-1');

      db.prepare(`DELETE FROM remote_access_grants WHERE grant_id = ?`).run('g-del');

      const row = db
        .prepare(`SELECT audit_id FROM remote_audit_log WHERE audit_id = ?`)
        .get('a-keep');
      expect(row).toBeDefined();

      const fks = db.pragma('foreign_key_list(remote_audit_log)') as Array<{
        table: string;
      }>;
      expect(fks).toHaveLength(0);
    });
  });

  // ── 011 notifications ──────────────────────────────────────────────────
  describe('011 notifications', () => {
    it('notification_prefs.key CHECK rejects an unknown kind', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO notification_prefs (key, enabled, sound_enabled)
             VALUES (?, 1, 1)`,
          )
          .run('foo'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('notification_prefs.key CHECK accepts each of the six valid kinds', () => {
      const kinds = [
        'new_message',
        'approval_pending',
        'work_done',
        'error',
        'queue_progress',
        'meeting_state',
      ];
      for (const k of kinds) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO notification_prefs (key, enabled, sound_enabled)
               VALUES (?, 1, 0)`,
            )
            .run(k),
        ).not.toThrow();
      }
      const stored = db
        .prepare(`SELECT key FROM notification_prefs ORDER BY key`)
        .all() as Array<{ key: string }>;
      expect(stored.map((r) => r.key).sort()).toEqual([...kinds].sort());
    });

    it('notification_log.channel_id FK is ON DELETE SET NULL (log row preserved)', () => {
      insertProject(db, 'proj-nlog');
      insertChannel(db, 'chan-nlog', 'proj-nlog');

      db.prepare(
        `INSERT INTO notification_log
          (id, kind, title, body, channel_id, clicked, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).run('n-keep', 'new_message', 'hi', 'body', 'chan-nlog', NOW);

      db.prepare(`DELETE FROM channels WHERE id = ?`).run('chan-nlog');

      const row = db
        .prepare(
          `SELECT id, kind, channel_id FROM notification_log WHERE id = ?`,
        )
        .get('n-keep') as
        | { id: string; kind: string; channel_id: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.kind).toBe('new_message');
      expect(row?.channel_id).toBeNull();
    });

    it('notification_log accepts a NULL channel_id (e.g. system-wide notice)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO notification_log
              (id, kind, title, body, channel_id, clicked, created_at)
             VALUES (?, ?, ?, ?, NULL, 0, ?)`,
          )
          .run('n-sys', 'error', 'oops', 'circuit breaker fired', NOW),
      ).not.toThrow();
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────────
  describe('idempotency', () => {
    it('runMigrations a second time is a no-op (no rows added, no SQL re-run)', () => {
      const before = db
        .prepare('SELECT COUNT(*) AS c FROM migrations')
        .get() as { c: number };
      // R10-Task9 added 012-circuit-breaker-state, R11-Task6 added
      // 013-onboarding-state, R11-Task8 added 014-llm-cost-audit-log.
      // B-fix added 015-approval-circuit-breaker-kind, D-A T1 added
      // 016-meeting-paused-and-kind, R12-S Task 1 added
      // 017-providers-roles-skills, R12-C Task 1 added
      // 018-channels-role-purpose-handoff. The test stays at "no-op on re-run"
      // — only the absolute count changes.
      expect(before.c).toBe(18);

      // A second pass must not throw (would throw on duplicate CREATE TABLE
      // because v3 migrations omit IF NOT EXISTS, so this proves the migrator
      // correctly skipped them).
      expect(() => runMigrations(db, migrations)).not.toThrow();

      const after = db
        .prepare('SELECT COUNT(*) AS c FROM migrations')
        .get() as { c: number };
      expect(after.c).toBe(18);
    });
  });
});
