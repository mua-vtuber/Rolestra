import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';
import { insertChannel, insertProvider, tableExists } from './_helpers';

describe('030 chat room storage', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  afterEach(() => db.close());

  it('supports the same provider in multiple projectless rooms and DM checkpoints', () => {
    expect(tableExists(db, 'chat_rooms')).toBe(true);
    expect(tableExists(db, 'chat_room_members')).toBe(true);
    expect(tableExists(db, 'cli_chat_sessions')).toBe(true);
    insertProvider(db, 'agent');
    insertChannel(db, 'room-a', null, 'user');
    insertChannel(db, 'room-b', null, 'user');
    insertChannel(db, 'dm', null, 'dm');
    for (const id of ['room-a', 'room-b']) {
      db.prepare('INSERT INTO chat_rooms (channel_id, created_at) VALUES (?, 1)').run(id);
      db.prepare(`INSERT INTO chat_room_members
        (channel_id, provider_id, sort_order, display_name, persona_source,
         role, personality, expertise, legacy_persona, effective_persona)
        VALUES (?, 'agent', 0, 'Agent', 'default', '', '', '', '', 'Snapshot')`).run(id);
    }
    db.prepare(`INSERT INTO cli_chat_sessions
      (channel_id, provider_id, session_id, context_fingerprint, last_message_id, updated_at)
      VALUES ('dm', 'agent', 'session', 'fingerprint', NULL, 1)`).run();
    expect((db.prepare('SELECT count(*) AS n FROM chat_room_members').get() as { n: number }).n).toBe(2);
    expect((db.prepare('SELECT count(*) AS n FROM cli_chat_sessions').get() as { n: number }).n).toBe(1);
    db.prepare("DELETE FROM channels WHERE id = 'room-a'").run();
    expect((db.prepare('SELECT count(*) AS n FROM chat_room_members').get() as { n: number }).n).toBe(1);
  });
});
