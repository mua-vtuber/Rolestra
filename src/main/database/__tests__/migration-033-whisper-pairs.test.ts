import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function whisper(db: Database.Database, id: string, author: string, recipient: string,
  replyTo: string | null = null): void {
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at,
      visibility, whisper_recipient_id, whisper_sender_name, whisper_recipient_name,
      whisper_source_message_id, whisper_reply_to_message_id)
    VALUES (?, 'room', ?, 'member', 'assistant', ?, 2, 'whisper', ?, ?, ?, 'u1', ?)`)
    .run(id, author, id, recipient, author.toUpperCase(), recipient.toUpperCase(), replyTo);
}

function rootIndexColumns(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM pragma_index_info('idx_messages_whisper_root_source') ORDER BY seqno")
    .all() as Array<{ name: string }>).map((row) => row.name);
}

function indexNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'
    AND tbl_name = 'messages' AND name LIKE 'idx_messages_whisper%' ORDER BY name`)
    .all() as Array<{ name: string }>).map((row) => row.name);
}

describe('033 whisper pairs', () => {
  it('keeps 032-era whisper rows and allows one root per sender and recipient for each user message', () => {
    const db = new Database(':memory:');
    opened.push(db);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations.slice(0, migrations.findIndex((item) => item.id === '032-whispers') + 1));
    for (const id of ['alice', 'bob', 'carol']) {
      db.prepare(`INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
        VALUES (?, ?, 'api', '{}', 1, 1)`).run(id, id);
    }
    db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room', NULL, 'Room', 'user', 1)").run();
    db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
      VALUES ('u1', 'room', 'user', 'user', 'user', 'hello', 1)`).run();
    whisper(db, 'root-ab', 'alice', 'bob');
    whisper(db, 'reply-ba', 'bob', 'alice', 'root-ab');
    expect(() => whisper(db, 'root-cb-032', 'carol', 'bob')).toThrow(/UNIQUE/);
    expect(rootIndexColumns(db)).toEqual(['whisper_source_message_id']);

    // This test checks 033's own rule, so it stops at 033: from 035 on every
    // whisper row carries a thread position (migration-035-whisper-threads.test.ts).
    const through033 = migrations.slice(0, migrations.findIndex((item) => item.id === '033-whisper-pairs') + 1);
    runMigrations(db, through033);
    runMigrations(db, through033);

    expect(db.prepare(`SELECT id, author_id, whisper_recipient_id, whisper_reply_to_message_id
      FROM messages WHERE visibility = 'whisper' ORDER BY rowid`).all()).toEqual([
      { id: 'root-ab', author_id: 'alice', whisper_recipient_id: 'bob', whisper_reply_to_message_id: null },
      { id: 'reply-ba', author_id: 'bob', whisper_recipient_id: 'alice', whisper_reply_to_message_id: 'root-ab' },
    ]);
    expect(indexNames(db)).toEqual(['idx_messages_whisper_reply_root', 'idx_messages_whisper_root_source']);
    expect(rootIndexColumns(db)).toEqual(['whisper_source_message_id', 'author_id', 'whisper_recipient_id']);
    whisper(db, 'root-cb', 'carol', 'bob');
    whisper(db, 'root-ac', 'alice', 'carol');
    whisper(db, 'root-ba', 'bob', 'alice');
    whisper(db, 'reply-bc', 'bob', 'carol', 'root-cb');
    expect(() => whisper(db, 'root-ab-again', 'alice', 'bob')).toThrow(/UNIQUE/);
    expect(() => whisper(db, 'reply-ba-again', 'bob', 'alice', 'root-ab')).toThrow(/UNIQUE/);
    expect(() => whisper(db, 'reply-wrong-pair', 'carol', 'alice', 'root-ab')).toThrow(/invalid whisper reply/);
    expect((db.prepare("SELECT count(*) AS n FROM migrations WHERE id = '033-whisper-pairs'").get() as { n: number }).n)
      .toBe(1);
  });
});
