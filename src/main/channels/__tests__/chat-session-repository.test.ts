import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatSessionRepository } from '../chat-session-repository';

describe('ChatSessionRepository', () => {
  let db: Database.Database;
  let repo: ChatSessionRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, meeting_id TEXT,
        author_id TEXT NOT NULL, author_kind TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, meta_json TEXT, created_at INTEGER NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public', whisper_recipient_id TEXT,
        whisper_sender_name TEXT, whisper_recipient_name TEXT,
        whisper_source_message_id TEXT, whisper_reply_to_message_id TEXT,
        whisper_thread_seq INTEGER
      );
      CREATE TABLE cli_chat_sessions (
        channel_id TEXT NOT NULL, provider_id TEXT NOT NULL,
        session_id TEXT NOT NULL, context_fingerprint TEXT NOT NULL,
        last_message_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, provider_id)
      );
    `);
    repo = new ChatSessionRepository(db);
  });
  afterEach(() => db.close());

  function message(id: string, channelId: string, authorId: string, role: string): void {
    db.prepare(`INSERT INTO messages
      (id, channel_id, meeting_id, author_id, author_kind, role, content, meta_json, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 1)`)
      .run(id, channelId, authorId, authorId === 'user' ? 'user' : 'member', role, id);
  }

  function whisper(id: string, authorId: string, recipientId: string): void {
    message(id, 'room-a', authorId, 'assistant');
    db.prepare(`UPDATE messages SET visibility = 'whisper', whisper_recipient_id = ?,
      whisper_sender_name = ?, whisper_recipient_name = ?, whisper_source_message_id = 'seen',
      whisper_thread_seq = 1
      WHERE id = ?`).run(recipientId, authorId, recipientId, id);
  }

  it('returns unseen room messages from user and other AIs, excluding own reply', () => {
    message('seen', 'room-a', 'user', 'user');
    message('own-reply', 'room-a', 'alice', 'assistant');
    message('other-ai', 'room-a', 'bob', 'assistant');
    message('other-room', 'room-b', 'bob', 'assistant');
    message('new-user', 'room-a', 'user', 'user');
    const delta = repo.listVisibleAfter('room-a', 'alice', 'seen');
    expect(delta?.messages.map((m) => m.id)).toEqual(['other-ai', 'new-user']);
    expect(delta?.lastInputMessageId).toBe('new-user');
  });

  it('rejects a missing or foreign cursor and bounds fresh reconstruction', () => {
    message('foreign', 'room-b', 'user', 'user');
    expect(repo.listVisibleAfter('room-a', 'alice', 'foreign')).toBeNull();
    for (let n = 0; n < 55; n += 1) message(`m-${n}`, 'room-a', 'user', 'user');
    const recent = repo.listVisibleRecent('room-a', 'alice', 50);
    expect(recent.messages).toHaveLength(50);
    expect(recent.messages[0]?.id).toBe('m-5');
    expect(recent.lastInputMessageId).toBe('m-54');
  });

  it('filters before recovery LIMIT and rejects a cursor hidden from the viewer', () => {
    message('seen', 'room-a', 'user', 'user');
    whisper('private', 'alice', 'bob');
    message('public', 'room-a', 'user', 'user');
    expect(repo.listVisibleRecent('room-a', 'charlie', 2).messages.map((m) => m.id))
      .toEqual(['seen', 'public']);
    expect(repo.listVisibleRecent('room-a', 'bob', 2).messages.map((m) => m.id))
      .toEqual(['private', 'public']);
    expect(repo.listVisibleAfter('room-a', 'charlie', 'private')).toBeNull();
    expect(repo.listVisibleAfter('room-a', 'bob', 'seen')?.messages.map((m) => m.id))
      .toEqual(['private', 'public']);
  });

  function notice(id: string, authorId: string, meta: Record<string, unknown> | null): void {
    db.prepare(`INSERT INTO messages
      (id, channel_id, meeting_id, author_id, author_kind, role, content, meta_json, created_at)
      VALUES (?, 'room-a', NULL, ?, 'member', 'system', ?, ?, 1)`)
      .run(id, authorId, id, meta === null ? null : JSON.stringify(meta));
  }

  it('keeps chat failure notices and legacy system rows out of model input before LIMIT (spec 2026-09-29 §C)', () => {
    message('seen', 'room-a', 'user', 'user');
    notice('failure-1', 'bob', { chatError: 'invalid_response' });
    message('public-1', 'room-a', 'user', 'user');
    // A pre-pivot failure line: provider error text names the CLI and model.
    notice('legacy-system', 'bob', null);
    notice('failure-2', 'bob', { chatError: 'timeout' });
    notice('failure-3', 'bob', { chatError: 'provider_error', chatErrorDetail: 'dm cause' });
    message('public-2', 'room-a', 'user', 'user');
    expect(repo.listVisibleRecent('room-a', 'alice', 3).messages.map((m) => m.id))
      .toEqual(['seen', 'public-1', 'public-2']);
    expect(repo.listVisibleAfter('room-a', 'alice', 'seen')?.messages.map((m) => m.id))
      .toEqual(['public-1', 'public-2']);
    expect(repo.listVisibleAfter('room-a', 'alice', 'seen')?.lastInputMessageId).toBe('public-2');
    // A checkpoint saved on a legacy system row (before they left model input) still resumes.
    expect(repo.listVisibleAfter('room-a', 'alice', 'legacy-system')?.messages.map((m) => m.id))
      .toEqual(['public-2']);
  });

  it('keeps silence notices out of CLI initial, delta and recovery input like failure notices (W4)', () => {
    message('seen', 'room-a', 'user', 'user');
    notice('turn-silence', 'bob', { chatSilence: { code: 'turn_passed', speakerName: 'Bob' } });
    message('public-1', 'room-a', 'user', 'user');
    notice('reply-silence', 'bob', { chatSilence: { code: 'reply_passed', speakerName: 'Bob' } });
    expect(repo.listVisibleRecent('room-a', 'alice', 2).messages.map((m) => m.id))
      .toEqual(['seen', 'public-1']);
    expect(repo.listVisibleAfter('room-a', 'alice', 'seen')?.messages.map((m) => m.id)).toEqual(['public-1']);
    expect(repo.listVisibleAfter('room-a', 'alice', 'turn-silence')?.messages.map((m) => m.id))
      .toEqual(['public-1']);
  });

  it('resumes from a checkpoint saved on a failure notice instead of rebuilding the session', () => {
    message('seen', 'room-a', 'user', 'user');
    notice('old-failure', 'bob', { chatError: 'invalid_response' });
    message('later', 'room-a', 'user', 'user');
    const delta = repo.listVisibleAfter('room-a', 'alice', 'old-failure');
    expect(delta?.messages.map((m) => m.id)).toEqual(['later']);
    expect(delta?.lastInputMessageId).toBe('later');
    expect(repo.listVisibleAfter('room-a', 'alice', 'later')?.lastInputMessageId).toBe('later');
  });

  it('invalidates an in-flight checkpoint before saving a completed turn', () => {
    repo.save({ channelId: 'room-a', providerId: 'alice', sessionId: 'sid',
      contextFingerprint: 'fp', lastMessageId: 'm-1' });
    expect(repo.load('room-a', 'alice')?.sessionId).toBe('sid');
    expect(repo.load('room-a', 'bob')).toBeNull();
    repo.invalidate('room-a', 'alice');
    expect(repo.load('room-a', 'alice')).toBeNull();
    repo.save({ channelId: 'room-a', providerId: 'alice', sessionId: 'sid-2',
      contextFingerprint: 'fp', lastMessageId: 'm-2' });
    expect(repo.load('room-a', 'alice')?.lastMessageId).toBe('m-2');
  });
});
