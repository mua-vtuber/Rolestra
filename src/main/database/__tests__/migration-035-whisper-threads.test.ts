import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from '../../channels/chat-limits';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations';
import { WHISPER_THREAD_SEQ_BACKFILL_SQL } from '../migrations/035-whisper-threads';
import { indexExists, triggerExists } from './_helpers';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function openThrough(lastId: string | null): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, lastId === null
    ? migrations
    : migrations.slice(0, migrations.findIndex((item) => item.id === lastId) + 1));
  for (const id of ['alice', 'bob', 'carol']) {
    db.prepare(`INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
      VALUES (?, ?, 'api', '{}', 1, 1)`).run(id, id);
  }
  db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room', NULL, 'Room', 'user', 1)").run();
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
    VALUES ('u1', 'room', 'user', 'user', 'user', 'hello', 1)`).run();
  return db;
}

/** A 034-era whisper row: the thread-sequence column does not exist yet. */
function legacyWhisper(db: Database.Database, id: string, author: string, recipient: string,
  replyTo: string | null = null): void {
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at,
      visibility, whisper_recipient_id, whisper_sender_name, whisper_recipient_name,
      whisper_source_message_id, whisper_reply_to_message_id)
    VALUES (?, 'room', ?, 'member', 'assistant', ?, 2, 'whisper', ?, ?, ?, 'u1', ?)`)
    .run(id, author, id, recipient, author.toUpperCase(), recipient.toUpperCase(), replyTo);
}

function whisper(db: Database.Database, id: string, author: string, recipient: string,
  replyTo: string | null, seq: number | string | null): void {
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at,
      visibility, whisper_recipient_id, whisper_sender_name, whisper_recipient_name,
      whisper_source_message_id, whisper_reply_to_message_id, whisper_thread_seq)
    VALUES (?, 'room', ?, 'member', 'assistant', ?, 2, 'whisper', ?, ?, ?, 'u1', ?, ?)`)
    .run(id, author, id, recipient, author.toUpperCase(), recipient.toUpperCase(), replyTo, seq);
}

function replyIndexColumns(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM pragma_index_info('idx_messages_whisper_reply_root') ORDER BY seqno")
    .all() as Array<{ name: string }>).map((row) => row.name);
}

function threadRows(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare(`SELECT id, author_id, whisper_recipient_id, whisper_reply_to_message_id, whisper_thread_seq
    FROM messages WHERE visibility = 'whisper' ORDER BY rowid`).all() as Array<Record<string, unknown>>;
}

describe('035 whisper threads', () => {
  it('backfills 034-era whisper rows (root = 1, reply = 2) and keeps the reply pointing at its root', () => {
    const db = openThrough('034-character-sheet');
    legacyWhisper(db, 'root-ab', 'alice', 'bob');
    legacyWhisper(db, 'reply-ba', 'bob', 'alice', 'root-ab');
    legacyWhisper(db, 'root-cb', 'carol', 'bob');
    db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
      VALUES ('pub', 'room', 'alice', 'member', 'assistant', 'public line', 3)`).run();

    runMigrations(db, migrations);
    runMigrations(db, migrations);

    expect(threadRows(db)).toEqual([
      { id: 'root-ab', author_id: 'alice', whisper_recipient_id: 'bob', whisper_reply_to_message_id: null, whisper_thread_seq: 1 },
      { id: 'reply-ba', author_id: 'bob', whisper_recipient_id: 'alice', whisper_reply_to_message_id: 'root-ab', whisper_thread_seq: 2 },
      { id: 'root-cb', author_id: 'carol', whisper_recipient_id: 'bob', whisper_reply_to_message_id: null, whisper_thread_seq: 1 },
    ]);
    expect((db.prepare("SELECT whisper_thread_seq AS seq FROM messages WHERE id = 'pub'").get() as { seq: unknown }).seq)
      .toBeNull();
    expect((db.prepare("SELECT count(*) AS n FROM migrations WHERE id = '035-whisper-threads'").get() as { n: number }).n)
      .toBe(1);

    // An existing thread goes on: the root sender answers the backfilled reply.
    whisper(db, 'reply-ab-3', 'alice', 'bob', 'root-ab', 3);
    whisper(db, 'reply-ba-4', 'bob', 'alice', 'root-ab', 4);
    expect(() => whisper(db, 'reply-ab-5', 'alice', 'bob', 'root-ab', 5)).toThrow(/invalid whisper reply/);
  });

  it('keeps the reply index and the insert trigger under their 032 names', () => {
    const db = openThrough(null);
    expect(indexExists(db, 'idx_messages_whisper_reply_root')).toBe(true);
    expect(indexExists(db, 'idx_messages_whisper_root_source')).toBe(true);
    expect(triggerExists(db, 'messages_whisper_insert_check')).toBe(true);
    expect(replyIndexColumns(db)).toEqual(['whisper_reply_to_message_id', 'whisper_thread_seq']);
  });

  it('accepts an alternating thread up to the limit and rejects the next row', () => {
    const db = openThrough(null);
    whisper(db, 'root', 'alice', 'bob', null, 1);
    for (let seq = 2; seq <= CHAT_WHISPER_THREAD_MAX_MESSAGES; seq += 1) {
      const [author, recipient] = seq % 2 === 0 ? ['bob', 'alice'] : ['alice', 'bob'];
      whisper(db, `reply-${seq}`, author, recipient, 'root', seq);
    }
    const next = CHAT_WHISPER_THREAD_MAX_MESSAGES + 1;
    const [author, recipient] = next % 2 === 0 ? ['bob', 'alice'] : ['alice', 'bob'];
    expect(() => whisper(db, 'reply-over', author, recipient, 'root', next)).toThrow(/invalid whisper reply/);
    expect(threadRows(db).map((row) => row.whisper_thread_seq)).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['the wrong direction for an even position', 'alice', 'bob', 2],
    ['the wrong direction for an odd position', 'bob', 'alice', 3],
    ['a pair other than the root pair', 'carol', 'alice', 2],
    ['a pair other than the root pair on an odd position', 'carol', 'bob', 3],
    ['position 1 on a reply', 'bob', 'alice', 1],
    ['position 0', 'bob', 'alice', 0],
    ['a fractional position', 'bob', 'alice', 2.5],
    ['a missing position', 'bob', 'alice', null],
  ])('rejects a reply with %s', (_label, author, recipient, seq) => {
    const db = openThrough(null);
    whisper(db, 'root', 'alice', 'bob', null, 1);
    expect(() => whisper(db, 'bad', author, recipient, 'root', seq)).toThrow(/invalid whisper/);
    expect(threadRows(db).map((row) => row.id)).toEqual(['root']);
  });

  it('rejects a skipped position and a duplicate position', () => {
    const db = openThrough(null);
    whisper(db, 'root', 'alice', 'bob', null, 1);
    expect(() => whisper(db, 'gap', 'alice', 'bob', 'root', 3)).toThrow(/invalid whisper reply/);
    whisper(db, 'reply-2', 'bob', 'alice', 'root', 2);
    expect(() => whisper(db, 'reply-2-again', 'bob', 'alice', 'root', 2)).toThrow(/UNIQUE/);
    expect(() => whisper(db, 'reply-to-reply', 'alice', 'bob', 'reply-2', 3)).toThrow(/invalid whisper reply/);
  });

  it('requires position 1 on a root and no position on a public message', () => {
    const db = openThrough(null);
    expect(() => whisper(db, 'root-2', 'alice', 'bob', null, 2)).toThrow(/invalid whisper/);
    expect(() => whisper(db, 'root-null', 'alice', 'bob', null, null)).toThrow(/invalid whisper/);
    expect(() => db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content,
      created_at, whisper_thread_seq) VALUES ('pub', 'room', 'alice', 'member', 'assistant', 'x', 3, 1)`).run())
      .toThrow(/public message has whisper metadata/);
    whisper(db, 'root', 'alice', 'bob', null, 1);
    expect(() => whisper(db, 'root-again', 'alice', 'bob', null, 1)).toThrow(/UNIQUE/);
  });

  it('still applies every 032 check after the trigger was replaced (QA m1a)', () => {
    const db = openThrough(null);
    db.prepare("INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room-2', NULL, 'Other', 'user', 1)").run();
    db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
      VALUES ('u-other', 'room-2', 'user', 'user', 'user', 'elsewhere', 1),
             ('ai-line', 'room', 'alice', 'member', 'assistant', 'public line', 1),
             ('u2', 'room', 'user', 'user', 'user', 'second', 1)`).run();
    type Row = { id: string; author: string; authorKind: string; role: string; recipient: string;
      senderName: string; recipientName: string; source: string; replyTo: string | null; seq: number };
    const insert = (overrides: Partial<Row>): void => {
      const row: Row = { id: 'w', author: 'alice', authorKind: 'member', role: 'assistant', recipient: 'bob',
        senderName: 'ALICE', recipientName: 'BOB', source: 'u1', replyTo: null, seq: 1, ...overrides };
      db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at,
          visibility, whisper_recipient_id, whisper_sender_name, whisper_recipient_name,
          whisper_source_message_id, whisper_reply_to_message_id, whisper_thread_seq)
        VALUES (?, 'room', ?, ?, ?, 'x', 2, 'whisper', ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.author, row.authorKind, row.role, row.recipient, row.senderName, row.recipientName,
          row.source, row.replyTo, row.seq);
    };
    expect(() => insert({ id: 'by-user', author: 'user', authorKind: 'user' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'not-assistant', role: 'user' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'to-self', recipient: 'alice' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'no-sender-name', senderName: '' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'no-recipient-name', recipientName: '' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'other-channel-source', source: 'u-other' })).toThrow(/invalid whisper/);
    expect(() => insert({ id: 'ai-source', source: 'ai-line' })).toThrow(/invalid whisper/);
    insert({ id: 'root' });
    expect(() => insert({ id: 'reply-other-source', author: 'bob', recipient: 'alice', senderName: 'BOB',
      recipientName: 'ALICE', source: 'u2', replyTo: 'root', seq: 2 })).toThrow(/invalid whisper reply/);
    expect(threadRows(db).map((row) => row.id)).toEqual(['root']);
  });

  it('gives the same backfill when its statement runs a second time', () => {
    const db = openThrough('034-character-sheet');
    legacyWhisper(db, 'root-ab', 'alice', 'bob');
    legacyWhisper(db, 'reply-ba', 'bob', 'alice', 'root-ab');
    runMigrations(db, migrations);
    const before = threadRows(db);
    db.exec(WHISPER_THREAD_SEQ_BACKFILL_SQL);
    expect(threadRows(db)).toEqual(before);
  });
});
