import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageViewer } from '../../../shared/message-types';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { insertChannel, insertProvider } from '../../database/__tests__/_helpers';
import { MessageRepository } from '../message-repository';
import { MessageService } from '../message-service';

const PROVIDER: MessageViewer = { kind: 'provider', providerId: 'carol' };
const PUBLIC: MessageViewer = { kind: 'public' };
const OBSERVER: MessageViewer = { kind: 'observer' };

describe('observer-only chat failure notices (A4)', () => {
  let db: Database.Database;
  let service: MessageService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    for (const id of ['bob', 'carol']) insertProvider(db, id);
    insertChannel(db, 'room', null, 'user');
    service = new MessageService(new MessageRepository(db));
    const user = (content: string) => service.append({ channelId: 'room', meetingId: null,
      authorId: 'user', authorKind: 'user', role: 'user', content });
    const failure = (content: string) => service.append({ channelId: 'room', meetingId: null,
      authorId: 'bob', authorKind: 'member', role: 'system', content,
      meta: { chatError: 'invalid_response' } });
    user('first question');
    failure('invalid_response');
    user('second question');
    service.append({ channelId: 'room', meetingId: null, authorId: 'bob',
      authorKind: 'member', role: 'system', content: 'legacy system row' });
    failure('invalid_response');
    failure('invalid_response');
  });
  afterEach(() => db.close());

  it('lists notices for the observer only, filtering before LIMIT for model viewers', () => {
    expect(service.listByChannel('room', { limit: 3 }, OBSERVER).map((m) => m.content))
      .toEqual(['invalid_response', 'invalid_response', 'legacy system row']);
    for (const viewer of [PROVIDER, PUBLIC]) {
      // Legacy system rows are observer-only too (spec 2026-09-29 §C): old
      // failure lines carry provider error text that names the CLI or model.
      expect(service.listByChannel('room', { limit: 3 }, viewer).map((m) => m.content))
        .toEqual(['second question', 'first question']);
      expect(service.search('legacy', { channelId: 'room' }, viewer)).toEqual([]);
    }
    expect(service.searchWithContext('legacy', { channelId: 'room' }, OBSERVER)).toHaveLength(1);
  });

  it('finds notices through observer search only', () => {
    expect(service.searchWithContext('invalid_response', { channelId: 'room' }, OBSERVER)).toHaveLength(3);
    for (const viewer of [PROVIDER, PUBLIC]) {
      expect(service.search('invalid_response', { channelId: 'room' }, viewer)).toEqual([]);
      expect(service.searchWithContext('invalid_response', { channelId: 'room' }, viewer)).toEqual([]);
    }
  });

  it('treats silence notices as observer-only too, before LIMIT and in search (W4)', () => {
    for (const code of ['turn_passed', 'reply_passed'] as const) {
      service.append({ channelId: 'room', meetingId: null, authorId: 'bob', authorKind: 'member',
        role: 'system', content: code, meta: { chatSilence: { code, speakerName: 'Bob' } } });
    }
    expect(service.listByChannel('room', { limit: 2 }, OBSERVER).map((m) => m.content))
      .toEqual(['reply_passed', 'turn_passed']);
    for (const viewer of [PROVIDER, PUBLIC]) {
      expect(service.listByChannel('room', { limit: 2 }, viewer).map((m) => m.content))
        .toEqual(['second question', 'first question']);
      expect(service.search('passed', { channelId: 'room' }, viewer)).toEqual([]);
    }
    expect(service.searchWithContext('passed', { channelId: 'room' }, OBSERVER)).toHaveLength(2);
  });
});
