/**
 * Integration test: Database Branch Operations
 *
 * Verifies branch-related message storage and retrieval using
 * the messages table branch_id and parent_message_id columns.
 *
 * Since ConversationRepository.getMessages returns all messages
 * for a conversation (not filtered by branch), these tests verify
 * correct storage of branch metadata and test SQL-level filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationRepository } from '../../database/conversation-repository';
import {
  createTestDb,
  makeMessage,
  makeParticipantsJson,
} from '../../../test-utils';

describe('Database Branch Operations', () => {
  let db: Database.Database;
  let repo: ConversationRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new ConversationRepository(db);
    repo.createConversation('conv-1', 'Branch Test', 'arena', makeParticipantsJson());
  });

  afterEach(() => {
    db.close();
  });

  // ── Default branch ────────────────────────────────────────────────

  it('defaults branchId to "main" when not specified', () => {
    repo.insertMessage(
      makeMessage({ id: 'msg-no-branch', conversationId: 'conv-1', branchId: undefined }),
    );

    const row = db
      .prepare('SELECT branch_id FROM messages WHERE id = ?')
      .get('msg-no-branch') as { branch_id: string };

    expect(row.branch_id).toBe('main');
  });

  // ── Messages on main branch ───────────────────────────────────────

  it('inserts and retrieves messages on the main branch', () => {
    repo.insertMessage(makeMessage({ id: 'msg-1', conversationId: 'conv-1', branchId: 'main', content: 'Main 1' }));
    repo.insertMessage(makeMessage({ id: 'msg-2', conversationId: 'conv-1', branchId: 'main', content: 'Main 2' }));

    const messages = repo.getMessages('conv-1');
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.branchId === 'main')).toBe(true);
  });

  // ── Messages on fork-1 branch ─────────────────────────────────────

  it('stores messages with branchId fork-1 and verifies in results', () => {
    repo.insertMessage(makeMessage({ id: 'msg-f1', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork msg' }));

    const messages = repo.getMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].branchId).toBe('fork-1');
  });

  // ── Fork isolation via SQL-level filtering ────────────────────────

  it('isolates messages per branch via SQL-level filtering', () => {
    // Main branch messages
    repo.insertMessage(makeMessage({ id: 'msg-m1', conversationId: 'conv-1', branchId: 'main', content: 'Main 1' }));
    repo.insertMessage(makeMessage({ id: 'msg-m2', conversationId: 'conv-1', branchId: 'main', content: 'Main 2' }));

    // Fork-1 branch messages
    repo.insertMessage(makeMessage({ id: 'msg-f1', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork 1' }));
    repo.insertMessage(makeMessage({ id: 'msg-f2', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork 2' }));
    repo.insertMessage(makeMessage({ id: 'msg-f3', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork 3' }));

    // SQL-level filtering by branch_id
    const mainMessages = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? AND branch_id = ? ORDER BY created_at ASC')
      .all('conv-1', 'main') as Array<{ id: string }>;

    const forkMessages = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? AND branch_id = ? ORDER BY created_at ASC')
      .all('conv-1', 'fork-1') as Array<{ id: string }>;

    expect(mainMessages).toHaveLength(2);
    expect(forkMessages).toHaveLength(3);

    // No overlap
    const mainIds = new Set(mainMessages.map((m) => m.id));
    const forkIds = new Set(forkMessages.map((m) => m.id));
    for (const id of forkIds) {
      expect(mainIds.has(id)).toBe(false);
    }
  });

  // ── Multiple forks from same conversation ─────────────────────────

  it('supports multiple independent forks from the same conversation', () => {
    repo.insertMessage(makeMessage({ id: 'msg-m', conversationId: 'conv-1', branchId: 'main', content: 'Root' }));
    repo.insertMessage(makeMessage({ id: 'msg-f1', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork 1 msg' }));
    repo.insertMessage(makeMessage({ id: 'msg-f2', conversationId: 'conv-1', branchId: 'fork-2', content: 'Fork 2 msg' }));
    repo.insertMessage(makeMessage({ id: 'msg-f3', conversationId: 'conv-1', branchId: 'fork-3', content: 'Fork 3 msg' }));

    // Verify all messages stored
    const all = repo.getMessages('conv-1');
    expect(all).toHaveLength(4);

    // Count unique branches
    const branches = new Set(all.map((m) => m.branchId));
    expect(branches.size).toBe(4); // main + fork-1 + fork-2 + fork-3
  });

  // ── Branch message ordering ───────────────────────────────────────

  it('orders messages within a branch by created_at', () => {
    // Insert in the same branch
    repo.insertMessage(makeMessage({ id: 'msg-1', conversationId: 'conv-1', branchId: 'fork-1', content: 'First' }));
    repo.insertMessage(makeMessage({ id: 'msg-2', conversationId: 'conv-1', branchId: 'fork-1', content: 'Second' }));
    repo.insertMessage(makeMessage({ id: 'msg-3', conversationId: 'conv-1', branchId: 'fork-1', content: 'Third' }));

    const forkMessages = db
      .prepare('SELECT id, content FROM messages WHERE conversation_id = ? AND branch_id = ? ORDER BY created_at ASC')
      .all('conv-1', 'fork-1') as Array<{ id: string; content: string }>;

    expect(forkMessages).toHaveLength(3);
    expect(forkMessages[0].id).toBe('msg-1');
    expect(forkMessages[1].id).toBe('msg-2');
    expect(forkMessages[2].id).toBe('msg-3');
  });

  // ── Parent message link ───────────────────────────────────────────

  it('stores and retrieves parentMessageId correctly', () => {
    repo.insertMessage(
      makeMessage({
        id: 'msg-parent',
        conversationId: 'conv-1',
        branchId: 'main',
        content: 'Parent',
      }),
    );
    repo.insertMessage(
      makeMessage({
        id: 'msg-child',
        conversationId: 'conv-1',
        branchId: 'fork-1',
        parentMessageId: 'msg-parent',
        content: 'Child',
      }),
    );

    const row = db
      .prepare('SELECT parent_message_id FROM messages WHERE id = ?')
      .get('msg-child') as { parent_message_id: string | null };

    expect(row.parent_message_id).toBe('msg-parent');

    // Parent should have null parent_message_id
    const parentRow = db
      .prepare('SELECT parent_message_id FROM messages WHERE id = ?')
      .get('msg-parent') as { parent_message_id: string | null };

    expect(parentRow.parent_message_id).toBeNull();
  });

  // ── getMessages returns all branches ──────────────────────────────

  it('getMessages returns messages from all branches for a conversation', () => {
    repo.insertMessage(makeMessage({ id: 'msg-m1', conversationId: 'conv-1', branchId: 'main', content: 'Main' }));
    repo.insertMessage(makeMessage({ id: 'msg-f1', conversationId: 'conv-1', branchId: 'fork-1', content: 'Fork' }));

    const messages = repo.getMessages('conv-1');
    expect(messages).toHaveLength(2);

    const branchIds = messages.map((m) => m.branchId);
    expect(branchIds).toContain('main');
    expect(branchIds).toContain('fork-1');
  });
});
