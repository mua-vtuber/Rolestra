/**
 * Unit tests for the migration runner.
 *
 * These tests construct their own in-memory `better-sqlite3` databases so
 * that `getDatabase()` (which depends on Electron's `app.getPath`) is never
 * called. They exercise:
 *
 * - `assertNoLegacyMigrations`: throws on v2 DB detection, passes on fresh DB.
 * - `runMigrations(db)` / `runMigrations(db, migrations)` overloads: empty
 *   chain is a no-op, explicit chain applies and is idempotent, failing SQL
 *   blocks startup, legacy guard fires before any migration runs.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrations as liveChain } from '../migrations/index';
import {
  assertNoLegacyMigrations,
  runMigrations,
  type Migration,
} from '../migrator';

describe('assertNoLegacyMigrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('passes on a fresh DB with no `migrations` table', () => {
    // Guard must create the table on demand and succeed.
    expect(() => assertNoLegacyMigrations(db)).not.toThrow();

    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'migrations'")
      .get() as { name: string } | undefined;
    expect(tableRow?.name).toBe('migrations');
  });

  it('passes on an empty `migrations` table', () => {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    expect(() => assertNoLegacyMigrations(db)).not.toThrow();
  });

  it('throws when the v2 id "001-initial-schema" is present', () => {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run('001-initial-schema');

    expect(() => assertNoLegacyMigrations(db)).toThrowError(
      /Legacy v2 migration detected: 001-initial-schema/,
    );
  });

  it.each([
    '002-recovery-tables',
    '003-remote-tables',
    '004-memory-enhancement',
    '005-consensus-records',
    '006-consensus-summary',
    '007-session-mode-columns',
  ])('throws when the v2 id "%s" is present', (legacyId) => {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run(legacyId);

    expect(() => assertNoLegacyMigrations(db)).toThrowError(/Legacy v2 migration detected/);
  });

  it('passes when only non-v2 migration ids are present', () => {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run('001-core');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run('002-projects');

    expect(() => assertNoLegacyMigrations(db)).not.toThrow();
  });
});

describe('runMigrations (injected DB + chain)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('is a no-op on an empty chain (v3 initial state)', () => {
    expect(() => runMigrations(db, [])).not.toThrow();

    // `migrations` table is created by the guard / runner.
    const count = db.prepare('SELECT COUNT(*) as c FROM migrations').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('uses the module-level chain when only `db` is provided', () => {
    // The live v3 chain grows as Phase R2 tasks land. This test asserts only
    // that the single-arg overload wires through to the module-level chain —
    // every recorded id must match the exported chain, in order.
    expect(() => runMigrations(db)).not.toThrow();

    const rows = db
      .prepare('SELECT id FROM migrations ORDER BY rowid')
      .all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(liveChain.map((m) => m.id));
  });

  it('applies an injected chain and records each id', () => {
    const chain: Migration[] = [
      {
        id: 'test-001-example',
        sql: 'CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT);',
      },
      {
        id: 'test-002-add-column',
        sql: 'ALTER TABLE example ADD COLUMN note TEXT;',
      },
    ];

    runMigrations(db, chain);

    const rows = db.prepare('SELECT id FROM migrations ORDER BY rowid').all() as Array<{
      id: string;
    }>;
    expect(rows.map((r) => r.id)).toEqual(['test-001-example', 'test-002-add-column']);

    // Schema effect of migration 2 is visible.
    const columns = db.pragma('table_info(example)') as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'value', 'note']));
  });

  it('is idempotent: re-running the same chain skips applied migrations', () => {
    const chain: Migration[] = [
      { id: 'test-001-once', sql: 'CREATE TABLE once (id INTEGER PRIMARY KEY);' },
    ];

    runMigrations(db, chain);
    // Second run must not throw (CREATE TABLE without IF NOT EXISTS would
    // otherwise fail — the runner is responsible for skipping applied ids).
    expect(() => runMigrations(db, chain)).not.toThrow();

    const count = db.prepare('SELECT COUNT(*) as c FROM migrations').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('throws with startup-blocking message when a migration fails', () => {
    const chain: Migration[] = [
      {
        id: 'test-001-bad',
        sql: 'THIS IS NOT VALID SQL;',
      },
    ];

    expect(() => runMigrations(db, chain)).toThrowError(
      /Startup blocked: migration 'test-001-bad' failed/,
    );

    // Failed migration must not be recorded.
    const rows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
    expect(rows).toHaveLength(0);
  });

  it('refuses to run when the DB carries v2 migration rows, before touching chain', () => {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at DATETIME)');
    db.prepare('INSERT INTO migrations(id) VALUES(?)').run('004-memory-enhancement');

    const chain: Migration[] = [
      {
        id: 'test-001-should-not-run',
        sql: 'CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY);',
      },
    ];

    expect(() => runMigrations(db, chain)).toThrowError(/Legacy v2 migration detected/);

    // Chain must not have executed.
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'should_not_exist'")
      .get() as { name: string } | undefined;
    expect(tableRow).toBeUndefined();
  });

  it('migration 017 adds roles + skill_overrides columns with correct defaults', () => {
    runMigrations(db, liveChain);

    const cols = db.prepare('PRAGMA table_info(providers)').all() as Array<{
      name: string;
      dflt_value: string | null;
      notnull: number;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('roles');
    expect(colNames).toContain('skill_overrides');

    // Verify column constraints
    const rolesCol = cols.find((c) => c.name === 'roles');
    const skillCol = cols.find((c) => c.name === 'skill_overrides');

    expect(rolesCol?.dflt_value).toBe("'[]'");
    expect(rolesCol?.notnull).toBe(1); // NOT NULL
    expect(skillCol?.notnull).toBe(0); // nullable

    // INSERT and verify default values
    db.prepare(
      `INSERT INTO providers (id, display_name, kind, config_json, persona, created_at, updated_at)
       VALUES ('test-provider-1', 'Test Provider', 'api', '{}', 'Test Persona', unixepoch(), unixepoch())`,
    ).run();

    const row = db
      .prepare('SELECT roles, skill_overrides FROM providers WHERE id = ?')
      .get('test-provider-1') as {
      roles: string;
      skill_overrides: string | null;
    };
    expect(row.roles).toBe('[]');
    expect(row.skill_overrides).toBeNull();
  });
});
