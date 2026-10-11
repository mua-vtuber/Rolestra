import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrations } from '../migrations';
import { runMigrations } from '../migrator';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

const MIGRATION_ID = '039-install-markers';

function upgrade(seed: (db: Database.Database) => void): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  runMigrations(db, migrations.filter((item) => item.id < MIGRATION_ID));
  seed(db);
  runMigrations(db, migrations);
  return db;
}

function insertGeneral(db: Database.Database, id: string, createdAt: number): void {
  db.prepare(`INSERT INTO channels
    (id, project_id, name, kind, read_only, created_at, role, purpose, handoff_mode)
    VALUES (?, NULL, '일반', 'system_general', 0, ?, NULL, NULL, 'check')`).run(id, createdAt);
}

function markers(db: Database.Database): Array<{ marker: string; recorded_at: number }> {
  return db.prepare('SELECT marker, recorded_at FROM app_install_markers ORDER BY marker')
    .all() as Array<{ marker: string; recorded_at: number }>;
}

describe('039 install markers', () => {
  it('marks an existing install whose general channel row exists, dated from that row', () => {
    const db = upgrade((seed) => insertGeneral(seed, 'general', 1_700_000_000_123));
    expect(markers(db)).toEqual([{ marker: 'general_channel_provisioned', recorded_at: 1_700_000_000_123 }]);
  });

  it('leaves a fresh DB without a marker so the first boot creates the channel', () => {
    const db = upgrade(() => undefined);
    expect(markers(db)).toEqual([]);
  });

  it('gives the same result when its SQL runs again', () => {
    const db = upgrade((seed) => insertGeneral(seed, 'general', 42));
    const migration = migrations.find((item) => item.id === MIGRATION_ID);
    if (!migration) throw new Error('039 migration missing');
    db.exec(migration.sql);
    db.exec(migration.sql);
    expect(markers(db)).toEqual([{ marker: 'general_channel_provisioned', recorded_at: 42 }]);
  });
});
