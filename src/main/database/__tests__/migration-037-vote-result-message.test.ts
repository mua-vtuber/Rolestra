import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrations } from '../migrations';
import { runMigrations } from '../migrator';
import { insertChannel, tableExists } from './_helpers';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function open() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  insertChannel(db, 'room', null, 'user');
  for (const id of ['a', 'b']) {
    db.prepare(`INSERT INTO opinion(id,channel_id,kind,author_label,status,created_at,updated_at)
      VALUES (?,'room','user-raised','user','pending',1,1)`).run(`op-${id}`);
    db.prepare(`INSERT INTO chat_votes(id,opinion_id,channel_id,status,created_at)
      VALUES (?,?,'room','completed',1)`).run(`vote-${id}`, `op-${id}`);
  }
  return db;
}

function insert(db: Database.Database, id: string, meta: object | null) {
  db.prepare(`INSERT INTO messages (id,channel_id,author_id,author_kind,role,content,meta_json,created_at)
    VALUES (?,'room','user','user','user','code',?,1)`).run(id, meta === null ? null : JSON.stringify(meta));
}

describe('037 vote result message', () => {
  it('enforces one stored result per vote while allowing different votes and ordinary messages', () => {
    const db = open();
    insert(db, 'first', { chatVoteResult: { voteId: 'vote-a' } });
    expect(() => insert(db, 'duplicate', { chatVoteResult: { voteId: 'vote-a' } })).toThrow(/UNIQUE/);
    insert(db, 'second', { chatVoteResult: { voteId: 'vote-b' } });
    insert(db, 'ordinary-1', null);
    insert(db, 'ordinary-2', { chatPass: 'user_pass' });
    expect((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n).toBe(4);
  });

  it('adds durable deliveries during upgrade and reruns without changing existing messages', () => {
    const db = new Database(':memory:');
    opened.push(db);
    runMigrations(db, migrations.filter((item) => item.id < '037-vote-result-message'));
    insertChannel(db, 'room', null, 'user');
    insert(db, 'ordinary', { chatPass: 'user_pass' });
    runMigrations(db, migrations);
    expect(tableExists(db, 'chat_vote_result_deliveries')).toBe(true);
    const migration = migrations.find((item) => item.id === '037-vote-result-message');
    expect(migration).toBeDefined();
    expect(() => db.exec(migration!.sql)).not.toThrow();
    expect(() => runMigrations(db, migrations)).not.toThrow();
    expect((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n).toBe(1);
  });

  it('retains a delivery after message deletion and removes it with the owning vote', () => {
    const db = open();
    insert(db, 'first', { chatVoteResult: { voteId: 'vote-a' } });
    db.prepare("DELETE FROM messages WHERE id = 'first'").run();
    expect(db.prepare('SELECT vote_id, message_id FROM chat_vote_result_deliveries').all())
      .toEqual([{ vote_id: 'vote-a', message_id: 'first' }]);
    expect(() => insert(db, 'second', { chatVoteResult: { voteId: 'vote-a' } })).toThrow(/UNIQUE/);
    db.prepare("DELETE FROM chat_votes WHERE id = 'vote-a'").run();
    expect(db.prepare('SELECT * FROM chat_vote_result_deliveries').all()).toEqual([]);
  });

  it('does not let an unrelated channel or malformed metadata mark a vote as sent', () => {
    const db = open();
    insertChannel(db, 'other-room', null, 'user');
    db.prepare(`INSERT INTO messages (id,channel_id,author_id,author_kind,role,content,meta_json,created_at)
      VALUES ('other','other-room','user','user','user','code',?,1)`)
      .run(JSON.stringify({ chatVoteResult: { voteId: 'vote-a' } }));
    db.prepare(`INSERT INTO messages (id,channel_id,author_id,author_kind,role,content,meta_json,created_at)
      VALUES ('malformed','room','user','user','user','code','not JSON',1)`).run();
    expect(db.prepare('SELECT * FROM chat_vote_result_deliveries').all()).toEqual([]);
    expect(() => insert(db, 'valid', { chatVoteResult: { voteId: 'vote-a' } })).not.toThrow();
  });
});
