import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ChannelSummaryRepository } from '../../channels/channel-summary-repository';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';
import { indexExists, insertChannel, tableExists } from './_helpers';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function open(): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  return db;
}

const migration036 = migrations.find((item) => item.id === '036-channel-read-state');
const BEFORE_036 = migrations.filter((item) => item.id !== '036-channel-read-state');

/** A database as it stood before 036: the chain up to 035 only. */
function openBefore036(): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, BEFORE_036);
  return db;
}

let clock = 1_000;
function message(db: Database.Database, id: string, channelId: string,
  author: 'user' | 'ai', role: 'user' | 'assistant' | 'system' = author === 'user' ? 'user' : 'assistant'): void {
  clock += 1;
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, channelId, author === 'user' ? 'user' : 'ai-a',
    author === 'user' ? 'user' : 'member', role, `text ${id}`, clock);
}

function markers(db: Database.Database): Record<string, number> {
  const rows = db.prepare('SELECT channel_id, last_read_rowid FROM channel_read_state ORDER BY channel_id')
    .all() as Array<{ channel_id: string; last_read_rowid: number }>;
  return Object.fromEntries(rows.map((row) => [row.channel_id, row.last_read_rowid]));
}

function maxRowid(db: Database.Database, channelId: string): number {
  return (db.prepare('SELECT MAX(rowid) AS id FROM messages WHERE channel_id = ?').get(channelId) as { id: number }).id;
}

function unreadByChannel(db: Database.Database): Record<string, number> {
  const summaries = new ChannelSummaryRepository(db).listSummaries([]);
  return Object.fromEntries(summaries.map((summary) => [summary.channelId, summary.unreadCount]));
}

/** Pre-036 data: general with history, a DM with history, a DM with none. */
function seedExistingChats(db: Database.Database): void {
  // One DM per AI (unique DM member index), so the two DMs need two AIs.
  for (const [id, name] of [['ai-a', 'Alice'], ['ai-b', 'Bob']]) {
    db.prepare(`INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
      VALUES (?, ?, 'api', '{}', 1, 1)`).run(id, name);
  }
  insertChannel(db, 'general', null, 'system_general');
  insertChannel(db, 'dm-busy', null, 'dm');
  insertChannel(db, 'dm-empty', null, 'dm');
  db.prepare("INSERT INTO channel_members (channel_id, project_id, provider_id) VALUES ('dm-busy', NULL, 'ai-a')").run();
  db.prepare("INSERT INTO channel_members (channel_id, project_id, provider_id) VALUES ('dm-empty', NULL, 'ai-b')").run();
  message(db, 'g1', 'general', 'user');
  message(db, 'g2', 'general', 'ai');
  message(db, 'g3', 'general', 'ai');
  message(db, 'd1', 'dm-busy', 'ai');
  message(db, 'd2', 'dm-busy', 'user');
}

describe('036 channel read state', () => {
  it('is the last migration in the chain', () => {
    expect(migration036).toBeDefined();
    expect(migrations[migrations.length - 1]?.id).toBe('036-channel-read-state');
  });

  it('adds the read-marker table and the unread-count index', () => {
    const db = open();
    expect(tableExists(db, 'channel_read_state')).toBe(true);
    expect(indexExists(db, 'idx_messages_channel_unread')).toBe(true);
    const columns = (db.prepare("SELECT name FROM pragma_index_info('idx_messages_channel_unread') ORDER BY seqno")
      .all() as Array<{ name: string }>).map((row) => row.name);
    expect(columns).toEqual(['channel_id', 'author_kind', 'role']);
  });

  it('is safe to run again: the SQL itself re-executes and the runner skips it', () => {
    const db = open();
    expect(() => db.exec(migration036!.sql)).not.toThrow();
    expect(() => runMigrations(db, migrations)).not.toThrow();
    const applied = db.prepare("SELECT count(*) AS n FROM migrations WHERE id = '036-channel-read-state'")
      .get() as { n: number };
    expect(applied.n).toBe(1);
  });

  it('drops a channel\'s marker with the channel and refuses a negative marker', () => {
    const db = open();
    insertChannel(db, 'dm', null, 'dm');
    db.prepare("INSERT INTO channel_read_state (channel_id, last_read_rowid) VALUES ('dm', 3)").run();
    expect(() => db.prepare("INSERT INTO channel_read_state (channel_id, last_read_rowid) VALUES ('x', 1)").run())
      .toThrow();
    db.prepare("DELETE FROM channels WHERE id = 'dm'").run();
    expect((db.prepare('SELECT count(*) AS n FROM channel_read_state').get() as { n: number }).n).toBe(0);
    insertChannel(db, 'dm2', null, 'dm');
    expect(() => db.prepare("INSERT INTO channel_read_state (channel_id, last_read_rowid) VALUES ('dm2', -1)").run())
      .toThrow();
  });
});

describe('036 backfill — history stored before unread tracking counts as read', () => {
  it('marks every channel with messages read up to its newest message, so nothing is unread', () => {
    const db = openBefore036();
    seedExistingChats(db);
    runMigrations(db, migrations);
    expect(markers(db)).toEqual({ 'dm-busy': maxRowid(db, 'dm-busy'), general: maxRowid(db, 'general') });
    expect(unreadByChannel(db)).toEqual({ general: 0, 'dm-busy': 0, 'dm-empty': 0 });
  });

  it('gives a channel without messages no marker; its first AI message counts as unread', () => {
    const db = openBefore036();
    seedExistingChats(db);
    runMigrations(db, migrations);
    expect(markers(db)['dm-empty']).toBeUndefined();
    message(db, 'e1', 'dm-empty', 'ai');
    expect(unreadByChannel(db)['dm-empty']).toBe(1);
  });

  it('counts an AI message added after 036 as one unread', () => {
    const db = openBefore036();
    seedExistingChats(db);
    runMigrations(db, migrations);
    message(db, 'g4', 'general', 'ai');
    message(db, 'g5', 'general', 'user');
    expect(unreadByChannel(db)).toEqual({ general: 1, 'dm-busy': 0, 'dm-empty': 0 });
  });

  it('never moves a marker when the SQL runs again', () => {
    const db = openBefore036();
    seedExistingChats(db);
    runMigrations(db, migrations);
    message(db, 'g4', 'general', 'ai');
    new ChannelSummaryRepository(db).markRead('general', 'g4');
    const before = markers(db);
    message(db, 'g6', 'general', 'ai');
    expect(() => db.exec(migration036!.sql)).not.toThrow();
    expect(markers(db)).toEqual(before);
    expect(unreadByChannel(db).general).toBe(1);
  });

  it('skips message rows whose channel no longer exists instead of blocking startup', () => {
    const db = openBefore036();
    seedExistingChats(db);
    db.pragma('foreign_keys = OFF');
    message(db, 'orphan', 'deleted-channel', 'ai');
    db.pragma('foreign_keys = ON');
    expect(() => runMigrations(db, migrations)).not.toThrow();
    expect(markers(db)['deleted-channel']).toBeUndefined();
    expect(Object.keys(markers(db)).sort()).toEqual(['dm-busy', 'general']);
  });
});
