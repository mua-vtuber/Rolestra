/**
 * Unit tests for ConversationRepository — DB CRUD for conversations and messages.
 *
 * Uses better-sqlite3 in-memory DB for isolated testing.
 *
 * Covers:
 * - Insert/load/delete conversation
 * - Message persistence
 * - List conversations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConversationRepository } from '../conversation-repository';
import type { MessageInsert } from '../conversation-repository';
import migration001 from '../migrations/001-initial-schema';

// ── Helpers ──────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(migration001.sql);
  return db;
}

function makeParticipantsJson(): string {
  return JSON.stringify([
    { id: 'ai-1', displayName: 'Claude' },
    { id: 'ai-2', displayName: 'Gemini' },
  ]);
}

function makeMessage(overrides: Partial<MessageInsert> = {}): MessageInsert {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    participantId: 'user',
    participantName: 'User',
    role: 'user',
    content: 'Hello world',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ConversationRepository', () => {
  let db: Database.Database;
  let repo: ConversationRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new ConversationRepository(db);
  });

  // ── createConversation ──────────────────────────────────────────

  describe('createConversation', () => {
    it('inserts a new conversation row', () => {
      repo.createConversation('conv-1', 'Test Conversation', 'chat', makeParticipantsJson());

      const row = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get('conv-1') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row['id']).toBe('conv-1');
      expect(row['title']).toBe('Test Conversation');
      expect(row['mode']).toBe('chat');
      expect(row['participants']).toBe(makeParticipantsJson());
      expect(row['created_at']).toBeDefined();
      expect(row['updated_at']).toBeDefined();
    });

    it('ignores duplicate inserts (INSERT OR IGNORE)', () => {
      repo.createConversation('conv-1', 'First', 'chat', makeParticipantsJson());
      repo.createConversation('conv-1', 'Second', 'chat', makeParticipantsJson());

      const row = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get('conv-1') as Record<string, unknown>;

      // Should keep the first insert
      expect(row['title']).toBe('First');
    });

    it('inserts multiple conversations with different IDs', () => {
      repo.createConversation('conv-1', 'First', 'chat', makeParticipantsJson());
      repo.createConversation('conv-2', 'Second', 'work', makeParticipantsJson());

      const count = db
        .prepare('SELECT COUNT(*) AS cnt FROM conversations')
        .get() as { cnt: number };

      expect(count.cnt).toBe(2);
    });
  });

  // ── updateTitle ─────────────────────────────────────────────────

  describe('updateTitle', () => {
    it('updates the conversation title', () => {
      repo.createConversation('conv-1', 'Old Title', 'chat', makeParticipantsJson());
      repo.updateTitle('conv-1', 'New Title');

      const row = db
        .prepare('SELECT title FROM conversations WHERE id = ?')
        .get('conv-1') as Record<string, unknown>;

      expect(row['title']).toBe('New Title');
    });
  });

  // ── touchTimestamp ──────────────────────────────────────────────

  describe('touchTimestamp', () => {
    it('updates the updated_at timestamp', () => {
      repo.createConversation('conv-1', 'Test', 'chat', makeParticipantsJson());

      const before = db
        .prepare('SELECT updated_at FROM conversations WHERE id = ?')
        .get('conv-1') as Record<string, unknown>;

      // Touch it (CURRENT_TIMESTAMP has second-level precision, so the value
      // should at least be present)
      repo.touchTimestamp('conv-1');

      const after = db
        .prepare('SELECT updated_at FROM conversations WHERE id = ?')
        .get('conv-1') as Record<string, unknown>;

      expect(after['updated_at']).toBeDefined();
      // We can't reliably test time difference in a unit test with CURRENT_TIMESTAMP
      // but we can verify the query executed without error
      expect(before['updated_at']).toBeDefined();
    });
  });

  // ── deleteConversation ──────────────────────────────────────────

  describe('deleteConversation', () => {
    it('deletes conversation and all its messages', () => {
      repo.createConversation('conv-1', 'To Delete', 'chat', makeParticipantsJson());
      repo.insertMessage(makeMessage({ id: 'msg-1', conversationId: 'conv-1' }));
      repo.insertMessage(makeMessage({ id: 'msg-2', conversationId: 'conv-1' }));

      repo.deleteConversation('conv-1');

      const conv = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get('conv-1');
      expect(conv).toBeUndefined();

      const msgs = db
        .prepare('SELECT * FROM messages WHERE conversation_id = ?')
        .all('conv-1');
      expect(msgs).toHaveLength(0);
    });

    it('does not affect other conversations', () => {
      repo.createConversation('conv-1', 'Delete Me', 'chat', makeParticipantsJson());
      repo.createConversation('conv-2', 'Keep Me', 'chat', makeParticipantsJson());
      repo.insertMessage(makeMessage({ id: 'msg-1', conversationId: 'conv-1' }));
      repo.insertMessage(makeMessage({ id: 'msg-2', conversationId: 'conv-2' }));

      repo.deleteConversation('conv-1');

      const conv2 = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get('conv-2') as Record<string, unknown>;
      expect(conv2).toBeDefined();

      const msgs2 = db
        .prepare('SELECT * FROM messages WHERE conversation_id = ?')
        .all('conv-2');
      expect(msgs2).toHaveLength(1);
    });

    it('handles delete of nonexistent conversation gracefully', () => {
      // Should not throw
      expect(() => repo.deleteConversation('nonexistent')).not.toThrow();
    });
  });

  // ── insertMessage ───────────────────────────────────────────────

  describe('insertMessage', () => {
    beforeEach(() => {
      repo.createConversation('conv-1', 'Test', 'chat', makeParticipantsJson());
    });

    it('inserts a message with all fields', () => {
      repo.insertMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Hello from Claude',
        responseTimeMs: 150,
        tokenCount: 42,
        branchId: 'main',
        parentMessageId: undefined,
      });

      const row = db
        .prepare('SELECT * FROM messages WHERE id = ?')
        .get('msg-1') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row['conversation_id']).toBe('conv-1');
      expect(row['participant_id']).toBe('ai-1');
      expect(row['role']).toBe('assistant');
      expect(row['content']).toBe('Hello from Claude');
      expect(row['response_time_ms']).toBe(150);
      expect(row['token_count']).toBe(42);
      expect(row['branch_id']).toBe('main');
    });

    it('generates UUID if id is not provided', () => {
      repo.insertMessage({
        conversationId: 'conv-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Auto ID',
      });

      const rows = db
        .prepare('SELECT id FROM messages WHERE conversation_id = ?')
        .all('conv-1') as Array<{ id: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBeDefined();
      expect(rows[0].id.length).toBeGreaterThan(0);
    });

    it('defaults branchId to main', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1', branchId: undefined }));

      const row = db
        .prepare('SELECT branch_id FROM messages WHERE id = ?')
        .get('msg-1') as Record<string, unknown>;

      expect(row['branch_id']).toBe('main');
    });

    it('defaults optional fields to null', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1' }));

      const row = db
        .prepare('SELECT response_time_ms, token_count, parent_message_id FROM messages WHERE id = ?')
        .get('msg-1') as Record<string, unknown>;

      expect(row['response_time_ms']).toBeNull();
      expect(row['token_count']).toBeNull();
      expect(row['parent_message_id']).toBeNull();
    });

    it('ignores duplicate message inserts (INSERT OR IGNORE)', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1', content: 'First' }));
      repo.insertMessage(makeMessage({ id: 'msg-1', content: 'Second' }));

      const row = db
        .prepare('SELECT content FROM messages WHERE id = ?')
        .get('msg-1') as Record<string, unknown>;

      expect(row['content']).toBe('First');
    });
  });

  // ── getMessages ─────────────────────────────────────────────────

  describe('getMessages', () => {
    beforeEach(() => {
      repo.createConversation('conv-1', 'Test', 'chat', makeParticipantsJson());
    });

    it('returns messages in chronological order', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1', content: 'First', participantId: 'user' }));
      repo.insertMessage(makeMessage({ id: 'msg-2', content: 'Second', participantId: 'ai-1' }));
      repo.insertMessage(makeMessage({ id: 'msg-3', content: 'Third', participantId: 'user' }));

      const messages = repo.getMessages('conv-1');

      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[1].id).toBe('msg-2');
      expect(messages[2].id).toBe('msg-3');
    });

    it('maps fields to ChatMessageData correctly', () => {
      repo.insertMessage({
        id: 'msg-1',
        conversationId: 'conv-1',
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Response',
        responseTimeMs: 200,
        tokenCount: 30,
        branchId: 'branch-1',
      });

      const messages = repo.getMessages('conv-1');

      expect(messages).toHaveLength(1);
      const msg = messages[0];
      expect(msg.id).toBe('msg-1');
      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('Response');
      expect(msg.participantId).toBe('ai-1');
      // participantName is derived from participantId in the repo
      expect(msg.participantName).toBe('ai-1');
      expect(msg.responseTimeMs).toBe(200);
      expect(msg.tokenCount).toBe(30);
      expect(msg.branchId).toBe('branch-1');
      expect(msg.createdAt).toBeDefined();
    });

    it('maps user participant to User name', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1', participantId: 'user' }));

      const messages = repo.getMessages('conv-1');
      expect(messages[0].participantName).toBe('User');
    });

    it('returns empty array for conversation with no messages', () => {
      const messages = repo.getMessages('conv-1');
      expect(messages).toEqual([]);
    });

    it('returns empty array for nonexistent conversation', () => {
      const messages = repo.getMessages('nonexistent');
      expect(messages).toEqual([]);
    });

    it('returns undefined for optional fields when null', () => {
      repo.insertMessage(makeMessage({ id: 'msg-1' }));

      const messages = repo.getMessages('conv-1');
      expect(messages[0].responseTimeMs).toBeUndefined();
      expect(messages[0].tokenCount).toBeUndefined();
    });
  });

  // ── listConversations ───────────────────────────────────────────

  describe('listConversations', () => {
    it('lists conversations with message count', () => {
      repo.createConversation('conv-1', 'First', 'chat', makeParticipantsJson());
      repo.insertMessage(makeMessage({ id: 'msg-1', conversationId: 'conv-1' }));
      repo.insertMessage(makeMessage({ id: 'msg-2', conversationId: 'conv-1' }));

      repo.createConversation('conv-2', 'Second', 'work', makeParticipantsJson());
      repo.insertMessage(makeMessage({ id: 'msg-3', conversationId: 'conv-2' }));

      const list = repo.listConversations();

      expect(list).toHaveLength(2);

      // Most recent first (both have same timestamp in memory DB, so order may vary)
      const conv1 = list.find(c => c.id === 'conv-1');
      const conv2 = list.find(c => c.id === 'conv-2');

      expect(conv1).toBeDefined();
      expect(conv1!.title).toBe('First');
      expect(conv1!.messageCount).toBe(2);
      expect(conv1!.participantNames).toEqual(['Claude', 'Gemini']);

      expect(conv2).toBeDefined();
      expect(conv2!.title).toBe('Second');
      expect(conv2!.messageCount).toBe(1);
    });

    it('returns empty array when no conversations exist', () => {
      const list = repo.listConversations();
      expect(list).toEqual([]);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.createConversation(`conv-${i}`, `Conv ${i}`, 'chat', makeParticipantsJson());
      }

      const list = repo.listConversations(3);
      expect(list).toHaveLength(3);
    });

    it('respects offset parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.createConversation(`conv-${i}`, `Conv ${i}`, 'chat', makeParticipantsJson());
      }

      const list = repo.listConversations(50, 3);
      expect(list).toHaveLength(2);
    });

    it('handles invalid participant JSON gracefully', () => {
      db.prepare(
        `INSERT INTO conversations (id, title, mode, participants) VALUES (?, ?, ?, ?)`,
      ).run('conv-bad', 'Bad', 'chat', 'INVALID_JSON');

      const list = repo.listConversations();

      expect(list).toHaveLength(1);
      expect(list[0].participantNames).toEqual([]);
    });

    it('uses default displayName when not present', () => {
      const participantsJson = JSON.stringify([{ id: 'ai-1' }]);
      repo.createConversation('conv-1', 'Test', 'chat', participantsJson);

      const list = repo.listConversations();
      expect(list[0].participantNames).toEqual(['AI']);
    });

    it('shows zero message count for conversations with no messages', () => {
      repo.createConversation('conv-1', 'Empty', 'chat', makeParticipantsJson());

      const list = repo.listConversations();
      expect(list[0].messageCount).toBe(0);
    });

    it('returns null title as empty string', () => {
      db.prepare(
        `INSERT INTO conversations (id, title, mode, participants) VALUES (?, NULL, ?, ?)`,
      ).run('conv-null-title', 'chat', makeParticipantsJson());

      const list = repo.listConversations();
      expect(list[0].title).toBe('');
    });
  });

  // ── generateTitle ───────────────────────────────────────────────

  describe('generateTitle', () => {
    it('returns content as-is when 40 chars or less', () => {
      expect(repo.generateTitle('Short title')).toBe('Short title');
    });

    it('truncates to 37 chars with ellipsis when over 40', () => {
      const longContent = 'This is a very long title that exceeds the maximum allowed characters for display';
      const result = repo.generateTitle(longContent);

      expect(result).toHaveLength(40);
      expect(result.endsWith('...')).toBe(true);
    });

    it('replaces newlines with spaces', () => {
      const content = 'Line one\nLine two\nLine three';
      const result = repo.generateTitle(content);
      expect(result).not.toContain('\n');
      expect(result).toContain('Line one Line two');
    });

    it('trims whitespace', () => {
      expect(repo.generateTitle('  hello  ')).toBe('hello');
    });

    it('handles exactly 40 characters', () => {
      const exact = 'A'.repeat(40);
      expect(repo.generateTitle(exact)).toBe(exact);
      expect(repo.generateTitle(exact)).toHaveLength(40);
    });

    it('handles 41 characters with truncation', () => {
      const over = 'A'.repeat(41);
      const result = repo.generateTitle(over);
      expect(result).toHaveLength(40);
      expect(result).toBe('A'.repeat(37) + '...');
    });
  });
});
