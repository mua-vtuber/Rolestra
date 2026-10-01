/**
 * The chat list's search field (spec 2026-10-01-messenger-redesign.md R2-2)
 * searches every conversation the user sees — general, rooms (archived
 * ones too) and DMs — but never the archived work-era project channels.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { MessageRepository } from '../message-repository';
import { MessageService, SearchScopeError } from '../message-service';

let db: Database.Database;

function channel(id: string, kind: string, projectId: string | null = null): void {
  db.prepare('INSERT INTO channels (id, project_id, name, kind, created_at) VALUES (?, ?, ?, ?, 1)')
    .run(id, projectId, id, kind);
}

function message(id: string, channelId: string, content: string): void {
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at)
    VALUES (?, ?, 'user', 'user', 'user', ?, 1)`).run(id, channelId, content);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  db.prepare("INSERT INTO projects (id, slug, name, kind, permission_mode, created_at) VALUES ('p', 'p', 'P', 'new', 'auto', 1)").run();
  channel('general', 'system_general');
  channel('dm', 'dm');
  channel('room', 'user');
  channel('archived-room', 'user');
  db.prepare("INSERT INTO chat_rooms (channel_id, created_at, archived_at) VALUES ('room', 1, NULL), ('archived-room', 1, 5)").run();
  channel('legacy', 'user', 'p');
  channel('stray', 'user');
  for (const id of ['general', 'dm', 'room', 'archived-room', 'legacy', 'stray']) {
    message(`m-${id}`, id, `needle in ${id}`);
  }
});

afterEach(() => db.close());

describe('message search — every chat conversation', () => {
  it('finds rows in general, rooms (archived too) and DMs, not in project or stray channels', () => {
    const hits = new MessageRepository(db).searchWithContext('needle', { chatsOnly: true });
    expect(hits.map((hit) => hit.channelId).sort()).toEqual(['archived-room', 'dm', 'general', 'room']);
  });

  it('cannot be combined with a channel or project scope', () => {
    const service = new MessageService(new MessageRepository(db));
    expect(() => service.searchWithContext('needle', { chatsOnly: true, channelId: 'general' }))
      .toThrow(SearchScopeError);
  });
});
