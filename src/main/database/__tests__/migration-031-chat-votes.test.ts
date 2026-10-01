import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';
import { insertProvider, tableExists } from './_helpers';

function databaseThrough031(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  return db;
}

function seedRoomOpinion(db: Database.Database, opinionId: string): void {
  db.prepare(`INSERT OR IGNORE INTO channels (id, project_id, name, kind, created_at)
    VALUES ('room', NULL, 'Room', 'user', 1)`).run();
  db.prepare("INSERT OR IGNORE INTO chat_rooms (channel_id, created_at) VALUES ('room', 1)").run();
  db.prepare(`INSERT INTO opinion
    (id, channel_id, kind, author_label, status, created_at, updated_at)
    VALUES (?, 'room', 'user-raised', 'user_1', 'pending', 1, 1)`).run(opinionId);
}

function insertVote(db: Database.Database, id: string, opinionId: string): void {
  db.prepare(`INSERT INTO chat_votes (id, opinion_id, channel_id, status, created_at)
    VALUES (?, ?, 'room', 'running', 1)`).run(id, opinionId);
}

describe('031 chat votes', () => {
  it('upgrades a 030 database and reruns the default chain without duplicating migration 031', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const through030 = migrations.slice(0, migrations.findIndex((migration) => migration.id === '031-chat-votes'));
      expect(through030.at(-1)?.id).toBe('030-chat-rooms');
      runMigrations(db, through030);
      expect(tableExists(db, 'chat_votes')).toBe(false);
      runMigrations(db, migrations);
      runMigrations(db, migrations);
      expect(tableExists(db, 'chat_votes')).toBe(true);
      expect(tableExists(db, 'chat_vote_participants')).toBe(true);
      expect((db.prepare("SELECT count(*) AS n FROM migrations WHERE id='031-chat-votes'").get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });

  it('retains a participant identity after its provider is deleted', () => {
    const db = databaseThrough031();
    try {
      insertProvider(db, 'agent');
      seedRoomOpinion(db, 'op');
      insertVote(db, 'vote', 'op');
      db.prepare(`INSERT INTO chat_vote_participants
        (vote_id, provider_id, display_name, persona, sort_order, status, opinion, vote)
        VALUES ('vote', 'agent', 'Original Agent', 'Snapshot', 0, 'submitted', 'Agreeing', 'agree')`).run();
      db.prepare("DELETE FROM providers WHERE id='agent'").run();
      expect(db.prepare('SELECT provider_id, display_name, persona, opinion, vote FROM chat_vote_participants').get())
        .toEqual({ provider_id: 'agent', display_name: 'Original Agent', persona: 'Snapshot',
          opinion: 'Agreeing', vote: 'agree' });
    } finally { db.close(); }
  });

  it('cascades opinion deletion and then room deletion through votes and participants', () => {
    const db = databaseThrough031();
    try {
      seedRoomOpinion(db, 'first');
      seedRoomOpinion(db, 'second');
      insertVote(db, 'vote-first', 'first');
      db.prepare("UPDATE chat_votes SET status='completed' WHERE id='vote-first'").run();
      insertVote(db, 'vote-second', 'second');
      for (const voteId of ['vote-first', 'vote-second']) {
        db.prepare(`INSERT INTO chat_vote_participants
          (vote_id, provider_id, display_name, persona, sort_order, status)
          VALUES (?, 'agent', 'Agent', 'Persona', 0, 'pending')`).run(voteId);
      }
      db.prepare("DELETE FROM opinion WHERE id='first'").run();
      expect((db.prepare('SELECT count(*) AS n FROM chat_votes').get() as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) AS n FROM chat_vote_participants').get() as { n: number }).n).toBe(1);
      db.prepare("DELETE FROM channels WHERE id='room'").run();
      expect((db.prepare('SELECT count(*) AS n FROM chat_votes').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) AS n FROM chat_vote_participants').get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });

  it('enforces one vote per opinion and one running vote per channel', () => {
    const db = databaseThrough031();
    try {
      seedRoomOpinion(db, 'first');
      seedRoomOpinion(db, 'second');
      insertVote(db, 'vote-first', 'first');
      expect(() => insertVote(db, 'duplicate', 'first')).toThrow();
      expect(() => insertVote(db, 'vote-second', 'second')).toThrow();
      db.prepare("UPDATE chat_votes SET status='completed' WHERE id='vote-first'").run();
      insertVote(db, 'vote-second', 'second');
      expect((db.prepare('SELECT count(*) AS n FROM chat_votes').get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });
});
