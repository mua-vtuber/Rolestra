import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { ChannelSummaryRepository } from '../channel-summary-repository';
import { CHANNEL_PREVIEW_MAX_CHARS } from '../../../shared/channel-summary-types';
import type { ChannelSummary } from '../../../shared/channel-summary-types';

let db: Database.Database;
let clock = 1_000;

function provider(id: string, name: string): void {
  db.prepare(`INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
    VALUES (?, ?, 'api', '{}', 1, 1)`).run(id, name);
}

function channel(id: string, kind: string, name = id, projectId: string | null = null, createdAt = 10): void {
  db.prepare('INSERT INTO channels (id, project_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, projectId, name, kind, createdAt);
}

function room(id: string, name: string, members: Array<[string, string]>, archivedAt: number | null = null): void {
  channel(id, 'user', name);
  db.prepare('INSERT INTO chat_rooms (channel_id, created_at, archived_at) VALUES (?, 10, ?)').run(id, archivedAt);
  members.forEach(([providerId, displayName], index) => {
    db.prepare(`INSERT INTO chat_room_members (channel_id, provider_id, sort_order, display_name, persona_source,
      role, personality, expertise, legacy_persona, effective_persona)
      VALUES (?, ?, ?, ?, 'default', '', '', '', '', '')`).run(id, providerId, index, displayName);
  });
}

function dm(id: string, providerId: string): void {
  channel(id, 'dm', `dm:${providerId}`);
  db.prepare('INSERT INTO channel_members (channel_id, project_id, provider_id) VALUES (?, NULL, ?)').run(id, providerId);
}

interface Row {
  id: string; author: string; kind: 'user' | 'member' | 'system'; role: 'user' | 'assistant' | 'system';
  content: string; meta?: unknown; at?: number;
}

function message(channelId: string, row: Row): void {
  clock += 1;
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, channelId, row.author, row.kind, row.role, row.content,
    row.meta === undefined ? null : JSON.stringify(row.meta), row.at ?? clock);
}

function whisper(channelId: string, id: string, author: string, recipient: string, source: string): void {
  clock += 1;
  db.prepare(`INSERT INTO messages (id, channel_id, author_id, author_kind, role, content, created_at,
      visibility, whisper_recipient_id, whisper_sender_name, whisper_recipient_name,
      whisper_source_message_id, whisper_reply_to_message_id, whisper_thread_seq)
    VALUES (?, ?, ?, 'member', 'assistant', 'secret whisper text', ?, 'whisper', ?, ?, ?, ?, NULL, 1)`)
    .run(id, channelId, author, clock, recipient, author.toUpperCase(), recipient.toUpperCase(), source);
}

function byId(list: ChannelSummary[], id: string): ChannelSummary {
  const found = list.find((item) => item.channelId === id);
  if (!found) throw new Error(`summary missing: ${id}`);
  return found;
}

const GENERAL_PARTICIPANTS = [{ providerId: 'ai-a', displayName: 'Alice' }, { providerId: 'ai-b', displayName: 'Bob' }];

beforeEach(() => {
  clock = 1_000;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  provider('ai-a', 'Alice');
  provider('ai-b', 'Bob');
  channel('general', 'system_general', 'general');
});

afterEach(() => db.close());

describe('ChannelSummaryRepository.listSummaries — which channels', () => {
  it('lists general, every chat room (archived flagged) and every DM, nothing else', () => {
    room('room-1', 'Night talk', [['ai-b', 'Bob in room'], ['ai-a', 'Alice in room']]);
    room('room-old', 'Old room', [['ai-a', 'Alice']], 500);
    dm('dm-a', 'ai-a');
    db.prepare("INSERT INTO projects (id, slug, name, kind, permission_mode, created_at) VALUES ('p', 'p', 'P', 'new', 'auto', 1)").run();
    channel('legacy-project', 'user', 'legacy', 'p');
    channel('stray-user-channel', 'user', 'not a room');

    const list = new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS);

    expect(list.map((item) => item.channelId).sort()).toEqual(['dm-a', 'general', 'room-1', 'room-old']);
    expect(byId(list, 'general')).toMatchObject({ kind: 'general', participants: GENERAL_PARTICIPANTS, archivedAt: null });
    expect(byId(list, 'room-1')).toMatchObject({
      kind: 'room', name: 'Night talk', archivedAt: null,
      participants: [{ providerId: 'ai-b', displayName: 'Bob in room' }, { providerId: 'ai-a', displayName: 'Alice in room' }],
    });
    expect(byId(list, 'room-old').archivedAt).toBe(500);
    expect(byId(list, 'dm-a')).toMatchObject({ kind: 'dm', participants: [{ providerId: 'ai-a', displayName: 'Alice' }] });
  });

  it('keeps a DM whose AI was deleted, with no participant left', () => {
    provider('ai-gone', 'Gone');
    dm('dm-gone', 'ai-gone');
    db.prepare("DELETE FROM providers WHERE id = 'ai-gone'").run();
    const list = new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS);
    expect(byId(list, 'dm-gone').participants).toEqual([]);
  });
});

describe('ChannelSummaryRepository.listSummaries — last message and activity', () => {
  it('uses the newest row, breaking same-millisecond ties by insertion order', () => {
    message('general', { id: 'u1', author: 'user', kind: 'user', role: 'user', content: 'first', at: 50 });
    message('general', { id: 'a1', author: 'ai-a', kind: 'member', role: 'assistant', content: 'second', at: 50 });
    const summary = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general');
    expect(summary.lastMessage).toMatchObject({ id: 'a1', authorId: 'ai-a', content: 'second', visibility: 'public' });
    expect(summary.lastActivityAt).toBe(50);
  });

  it('falls back to the channel creation time for an empty channel', () => {
    const summary = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general');
    expect(summary.lastMessage).toBeNull();
    expect(summary.lastActivityAt).toBe(10);
  });

  it('shows a whisper as its route only — never its text', () => {
    room('room-1', 'Room', [['ai-a', 'Alice'], ['ai-b', 'Bob']]);
    message('room-1', { id: 'src', author: 'user', kind: 'user', role: 'user', content: 'hi' });
    whisper('room-1', 'w1', 'ai-a', 'ai-b', 'src');
    const last = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'room-1').lastMessage;
    expect(last).toMatchObject({
      id: 'w1', visibility: 'whisper', content: null,
      whisper: { senderName: 'AI-A', recipientName: 'AI-B', threadSeq: 1, isReply: false },
    });
    expect(JSON.stringify(last)).not.toContain('secret whisper text');
  });

  it('keeps notice and pass rows as codes', () => {
    message('general', { id: 'n1', author: 'ai-a', kind: 'member', role: 'system', content: 'turn_passed',
      meta: { chatSilence: { code: 'turn_passed', speakerName: 'Alice' }, opinion: { ignored: true } } });
    let last = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general').lastMessage;
    expect(last).toMatchObject({ content: 'turn_passed', notice: { chatSilence: { code: 'turn_passed', speakerName: 'Alice' } } });
    expect(last?.notice).not.toHaveProperty('opinion');

    message('general', { id: 'p1', author: 'user', kind: 'user', role: 'user', content: 'user_pass', meta: { chatPass: 'user_pass' } });
    last = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general').lastMessage;
    expect(last).toMatchObject({ id: 'p1', notice: { chatPass: 'user_pass' } });
  });

  it('cuts the preview text in SQL', () => {
    message('general', { id: 'long', author: 'ai-a', kind: 'member', role: 'assistant', content: '가'.repeat(500) });
    const last = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general').lastMessage;
    expect(last?.content).toBe('가'.repeat(CHANNEL_PREVIEW_MAX_CHARS));
    expect(last?.notice).toBeNull();
  });

  it('preserves the exhausted AI name in the initial chat list summary', () => {
    message('general', { id: 'quota', author: 'ai-a', kind: 'member', role: 'system', content: 'usage_limit',
      meta: { chatError: 'usage_limit', chatErrorSpeakerName: 'Alice', unrelated: 'not for previews' } });
    const last = byId(new ChannelSummaryRepository(db).listSummaries(GENERAL_PARTICIPANTS), 'general').lastMessage;
    expect(last?.notice).toEqual({ chatError: 'usage_limit', chatErrorSpeakerName: 'Alice' });
  });
});

describe('ChannelSummaryRepository — unread count and read marker', () => {
  function seedRoom(): void {
    room('room-1', 'Room', [['ai-a', 'Alice'], ['ai-b', 'Bob']]);
    message('room-1', { id: 'u1', author: 'user', kind: 'user', role: 'user', content: 'hello' });
    message('room-1', { id: 'a1', author: 'ai-a', kind: 'member', role: 'assistant', content: 'public reply' });
    whisper('room-1', 'w1', 'ai-b', 'ai-a', 'u1');
    message('room-1', { id: 'n1', author: 'ai-a', kind: 'member', role: 'system', content: 'turn_passed',
      meta: { chatSilence: { code: 'turn_passed', speakerName: 'Alice' } } });
    message('room-1', { id: 'e1', author: 'system', kind: 'system', role: 'system', content: 'timeout', meta: { chatError: 'timeout' } });
    message('room-1', { id: 'p1', author: 'user', kind: 'user', role: 'user', content: 'user_pass', meta: { chatPass: 'user_pass' } });
  }

  it('counts AI public messages and whispers only — not notices, the user or pass rows', () => {
    seedRoom();
    expect(byId(new ChannelSummaryRepository(db).listSummaries([]), 'room-1').unreadCount).toBe(2);
  });

  it('marks read up to a message, and only messages after it count again', () => {
    seedRoom();
    const repo = new ChannelSummaryRepository(db);
    repo.markRead('room-1', 'p1');
    expect(byId(repo.listSummaries([]), 'room-1').unreadCount).toBe(0);
    message('room-1', { id: 'a2', author: 'ai-b', kind: 'member', role: 'assistant', content: 'new' });
    expect(byId(repo.listSummaries([]), 'room-1').unreadCount).toBe(1);
  });

  it('never moves the marker back when an older message is marked', () => {
    seedRoom();
    const repo = new ChannelSummaryRepository(db);
    repo.markRead('room-1', 'p1');
    repo.markRead('room-1', 'a1');
    expect(byId(repo.listSummaries([]), 'room-1').unreadCount).toBe(0);
  });

  it('marking an earlier message leaves later AI messages unread', () => {
    seedRoom();
    const repo = new ChannelSummaryRepository(db);
    repo.markRead('room-1', 'a1');
    expect(byId(repo.listSummaries([]), 'room-1').unreadCount).toBe(1);
  });

  it('keeps the marker across a restart (new repository on the same database)', () => {
    seedRoom();
    new ChannelSummaryRepository(db).markRead('room-1', 'p1');
    expect(byId(new ChannelSummaryRepository(db).listSummaries([]), 'room-1').unreadCount).toBe(0);
  });

  it('refuses a message that is unknown or belongs to another channel', () => {
    seedRoom();
    message('general', { id: 'g1', author: 'ai-a', kind: 'member', role: 'assistant', content: 'other' });
    const repo = new ChannelSummaryRepository(db);
    expect(() => repo.markRead('room-1', 'g1')).toThrow('Message g1 not found in channel room-1');
    expect(() => repo.markRead('room-1', 'missing')).toThrow('Message missing not found in channel room-1');
  });
});

describe('ChannelSummaryRepository — query cost', () => {
  /** Statement methods that run SQL against the database. */
  const EXECUTING = new Set(['all', 'get', 'run', 'iterate']);

  /**
   * Counts SQL executions, not prepares (QA Medium-3): a statement prepared
   * once and run per channel would pass a prepare count. The repository is
   * built inside `run`, so statements it prepares up front are counted too.
   */
  function countExecutions(run: () => void): number {
    const original = db.prepare.bind(db);
    let count = 0;
    db.prepare = ((sql: string) => {
      const statement = original(sql);
      return new Proxy(statement, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          if (!EXECUTING.has(String(property))) return method.bind(target);
          return (...args: unknown[]) => {
            count += 1;
            return method.apply(target, args);
          };
        },
      });
    }) as typeof db.prepare;
    try { run(); } finally { db.prepare = original; }
    return count;
  }

  it('runs the same number of SQL statements for 1 and for 30 channels', () => {
    const few = countExecutions(() => new ChannelSummaryRepository(db).listSummaries([]));
    for (let index = 0; index < 30; index += 1) {
      room(`room-${index}`, `Room ${index}`, [['ai-a', 'Alice'], ['ai-b', 'Bob']]);
      message(`room-${index}`, { id: `m-${index}`, author: 'ai-a', kind: 'member', role: 'assistant', content: 'x' });
    }
    const many = countExecutions(() => new ChannelSummaryRepository(db).listSummaries([]));
    expect(few).toBe(2);
    expect(many).toBe(few);
  });

  it('reads the last message and the unread rows through indexes, without a sort pass', () => {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${ChannelSummaryRepository.SUMMARY_SQL}`).all() as Array<{ detail: string }>)
      .map((row) => row.detail).join('\n');
    expect(plan).toContain('idx_messages_channel_time');
    expect(plan).toContain('idx_messages_channel_unread');
    expect(plan).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
  });
});
