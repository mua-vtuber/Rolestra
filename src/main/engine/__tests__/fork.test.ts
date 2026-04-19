/**
 * Unit tests for conversation fork (branch) functionality.
 *
 * Verifies:
 * 1. Fork creates a new branch from a specific message
 * 2. Branch messages include ancestor chain up to fork point
 * 3. New messages go to the current branch
 * 4. Switching branches returns correct message sets
 * 5. Multiple nested forks work correctly
 * 6. Provider message adaptation respects branches
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationSession } from '../conversation';
import { DEFAULT_BRANCH_ID } from '../../../shared/engine-types';
import type { Participant } from '../../../shared/engine-types';

const participants: Participant[] = [
  { id: 'ai-1', providerId: 'ai-1', displayName: 'AI-1', isActive: true },
  { id: 'ai-2', providerId: 'ai-2', displayName: 'AI-2', isActive: true },
];

describe('Conversation Fork', () => {
  let session: ConversationSession;

  beforeEach(() => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    session = new ConversationSession({
      participants,
    });
  });

  // ── Basic fork creation ──────────────────────────────────────────

  it('starts on the main branch by default', () => {
    expect(session.currentBranchId).toBe(DEFAULT_BRANCH_ID);
    expect(session.listBranches()).toHaveLength(0);
  });

  it('creates a fork from a specific message', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Hello',
    });

    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Hi there',
    });

    const result = session.fork(msg1.id);

    expect(result.branchId).toBeDefined();
    expect(result.branchRootMessageId).toBe(msg1.id);
    expect(session.currentBranchId).toBe(result.branchId);
    expect(session.listBranches()).toHaveLength(1);

    const branch = session.listBranches()[0];
    expect(branch.parentBranchId).toBe(DEFAULT_BRANCH_ID);
    expect(branch.branchRootMessageId).toBe(msg1.id);
    expect(branch.createdAt).toBeGreaterThan(0);
  });

  it('throws when forking from nonexistent message', () => {
    expect(() => session.fork('nonexistent')).toThrow('Message not found');
  });

  // ── Branch message isolation ─────────────────────────────────────

  it('fork branch inherits messages up to fork point', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Message 1',
    });

    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Message 2',
    });

    session.createMessage({
      participantId: 'ai-2',
      participantName: 'AI-2',
      role: 'assistant',
      content: 'Message 3',
    });

    // Fork from message 1 — should only see message 1
    const result = session.fork(msg1.id);
    const branchMessages = session.getMessagesForBranch(result.branchId);

    expect(branchMessages).toHaveLength(1);
    expect(branchMessages[0].content).toBe('Message 1');
  });

  it('new messages after fork go to the new branch', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Original',
    });

    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Original reply',
    });

    const result = session.fork(msg1.id);

    // Add message on the new branch
    session.createMessage({
      participantId: 'ai-2',
      participantName: 'AI-2',
      role: 'assistant',
      content: 'Fork reply',
    });

    // Fork branch should have: inherited msg1 + new fork reply
    const forkMessages = session.getMessagesForBranch(result.branchId);
    expect(forkMessages).toHaveLength(2);
    expect(forkMessages[0].content).toBe('Original');
    expect(forkMessages[1].content).toBe('Fork reply');

    // Main branch should still have original 2 messages
    const mainMessages = session.getMessagesForBranch(DEFAULT_BRANCH_ID);
    expect(mainMessages).toHaveLength(2);
    expect(mainMessages[0].content).toBe('Original');
    expect(mainMessages[1].content).toBe('Original reply');
  });

  it('main branch is unaffected by fork-branch messages', () => {
    session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'A',
    });

    const msg2 = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'B',
    });

    session.fork(msg2.id);

    // Add many messages on the fork
    for (let i = 0; i < 5; i++) {
      session.createMessage({
        participantId: 'ai-1',
        participantName: 'AI-1',
        role: 'assistant',
        content: `Fork msg ${i}`,
      });
    }

    // Main branch still only has 2 messages
    const mainMessages = session.getMessagesForBranch(DEFAULT_BRANCH_ID);
    expect(mainMessages).toHaveLength(2);
  });

  // ── Branch switching ─────────────────────────────────────────────

  it('can switch back to main branch', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Hello',
    });

    session.fork(msg1.id);
    expect(session.currentBranchId).not.toBe(DEFAULT_BRANCH_ID);

    session.switchBranch(DEFAULT_BRANCH_ID);
    expect(session.currentBranchId).toBe(DEFAULT_BRANCH_ID);
  });

  it('throws when switching to nonexistent branch', () => {
    expect(() => session.switchBranch('nonexistent')).toThrow('Branch not found');
  });

  it('messages created after switch go to the correct branch', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Root',
    });

    const fork1 = session.fork(msg1.id);
    session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'On fork 1',
    });

    session.switchBranch(DEFAULT_BRANCH_ID);
    session.createMessage({
      participantId: 'ai-2',
      participantName: 'AI-2',
      role: 'assistant',
      content: 'On main after switch',
    });

    const mainMessages = session.getMessagesForBranch(DEFAULT_BRANCH_ID);
    const forkMessages = session.getMessagesForBranch(fork1.branchId);

    expect(mainMessages).toHaveLength(2);
    expect(mainMessages[1].content).toBe('On main after switch');

    expect(forkMessages).toHaveLength(2);
    expect(forkMessages[1].content).toBe('On fork 1');
  });

  // ── Nested forks ─────────────────────────────────────────────────

  it('supports nested forks (fork from a fork)', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Root',
    });

    // Fork 1 from root
    const fork1 = session.fork(msg1.id);
    const msg2 = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Fork 1 msg',
    });

    // Fork 2 from fork 1's message
    const fork2 = session.fork(msg2.id);
    session.createMessage({
      participantId: 'ai-2',
      participantName: 'AI-2',
      role: 'assistant',
      content: 'Fork 2 msg',
    });

    // Fork 2 should see: Root → Fork 1 msg → Fork 2 msg
    const fork2Messages = session.getMessagesForBranch(fork2.branchId);
    expect(fork2Messages).toHaveLength(3);
    expect(fork2Messages[0].content).toBe('Root');
    expect(fork2Messages[1].content).toBe('Fork 1 msg');
    expect(fork2Messages[2].content).toBe('Fork 2 msg');

    // Fork 1 should see: Root → Fork 1 msg
    const fork1Messages = session.getMessagesForBranch(fork1.branchId);
    expect(fork1Messages).toHaveLength(2);
    expect(fork1Messages[0].content).toBe('Root');
    expect(fork1Messages[1].content).toBe('Fork 1 msg');

    // Branch info
    const branches = session.listBranches();
    expect(branches).toHaveLength(2);

    const fork2Info = branches.find((b) => b.id === fork2.branchId);
    expect(fork2Info?.parentBranchId).toBe(fork1.branchId);
  });

  // ── Provider adaptation with branches ────────────────────────────

  it('getMessagesForProvider uses current branch messages', () => {
    session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Hello',
    });

    const msg2 = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Main reply',
    });

    // Fork from msg2 and add a new message
    session.fork(msg2.id);
    session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Fork question',
    });

    // Messages for provider should only include branch messages (Hello, Main reply, Fork question)
    const adapted = session.getMessagesForProvider('ai-1');
    const allContent = adapted.map((m) =>
      typeof m.content === 'string' ? m.content : '',
    ).join('\n');

    // adaptMessagesForProvider prefixes user messages with "[Name]: "
    expect(allContent).toContain('Fork question');
    expect(adapted).toHaveLength(3); // Hello + Main reply + Fork question (merged user msgs possible)
  });

  // ── Serialization ────────────────────────────────────────────────

  it('toInfo includes branch data', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Hello',
    });

    session.fork(msg1.id);

    const info = session.toInfo();
    expect(info.currentBranchId).toBe(session.currentBranchId);
    expect(info.branches).toHaveLength(1);
    expect(info.branches[0].branchRootMessageId).toBe(msg1.id);
  });

  // ── parentMessageId chain ────────────────────────────────────────

  it('sets parentMessageId correctly on main branch', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'First',
    });

    const msg2 = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Second',
    });

    expect(msg1.parentMessageId).toBeUndefined();
    expect(msg2.parentMessageId).toBe(msg1.id);
  });

  it('sets parentMessageId correctly after fork', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Root',
    });

    session.fork(msg1.id);

    const forkMsg = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Fork reply',
    });

    // First message on fork branch should chain to the last ancestor message (msg1)
    expect(forkMsg.parentMessageId).toBe(msg1.id);
  });

  // ── branchId assignment ──────────────────────────────────────────

  it('assigns branchId automatically to new messages', () => {
    const msg1 = session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Main msg',
    });

    expect(msg1.branchId).toBe(DEFAULT_BRANCH_ID);

    session.fork(msg1.id);

    const msg2 = session.createMessage({
      participantId: 'ai-1',
      participantName: 'AI-1',
      role: 'assistant',
      content: 'Fork msg',
    });

    expect(msg2.branchId).toBe(session.currentBranchId);
    expect(msg2.branchId).not.toBe(DEFAULT_BRANCH_ID);
  });
});
