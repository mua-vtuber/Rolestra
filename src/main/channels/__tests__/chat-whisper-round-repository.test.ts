import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { ChatWhisperRoundRepository } from '../chat-whisper-round-repository';

describe('ChatWhisperRoundRepository', () => {
  it('claims only a persisted user message once and never replays after interruption', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      runMigrations(db, migrations);
      db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room', NULL, 'Room', 'user', 1)").run();
      db.prepare("INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at) VALUES ('user-1', 'room', 'user', 'user', 'user', 'hi', 1)").run();
      const rounds = new ChatWhisperRoundRepository(db);
      expect(rounds.claim('other-room', 'user-1')).toBe(false);
      expect(rounds.claim('room', 'missing')).toBe(false);
      expect(rounds.claim('room', 'user-1')).toBe(true);
      expect(rounds.claim('room', 'user-1')).toBe(false);
      rounds.interruptRunning();
      expect(rounds.status('room', 'user-1')).toBe('interrupted');
      expect(rounds.claim('room', 'user-1')).toBe(false);
    } finally { db.close(); }
  });

  it('cascades claims on channel deletion', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      runMigrations(db, migrations);
      db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room', NULL, 'Room', 'user', 1)").run();
      db.prepare("INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at) VALUES ('user-1', 'room', 'user', 'user', 'user', 'hi', 1)").run();
      const rounds = new ChatWhisperRoundRepository(db);
      expect(rounds.claim('room', 'user-1')).toBe(true);
      db.prepare("DELETE FROM channels WHERE id='room'").run();
      expect(rounds.status('room', 'user-1')).toBeNull();
    } finally { db.close(); }
  });
});
