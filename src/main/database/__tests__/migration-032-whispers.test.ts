import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';

describe('032 whispers', () => {
  it('upgrades a 031 database and keeps old messages public', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const through031 = migrations.slice(0, migrations.findIndex((item) => item.id === '032-whispers'));
      runMigrations(db, through031);
      db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room', NULL, 'Room', 'user', 1)").run();
      db.prepare("INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at) VALUES ('old', 'room', 'user', 'user', 'user', 'hello', 1)").run();
      runMigrations(db, migrations);
      runMigrations(db, migrations);
      expect(db.prepare("SELECT visibility, whisper_recipient_id FROM messages WHERE id = 'old'").get())
        .toEqual({ visibility: 'public', whisper_recipient_id: null });
      expect((db.prepare("SELECT count(*) AS n FROM migrations WHERE id='032-whispers'").get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });
});
