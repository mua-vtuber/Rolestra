/**
 * Unit tests for multi-party message adaptation (history.ts).
 *
 * Covers:
 * - Self messages become assistant, others become user with "[name]:" prefix
 * - Consecutive user messages are merged
 * - System messages are preserved unchanged
 * - Single-party (no transformation needed)
 * - Empty message handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { adaptMessagesForProvider, type ParticipantMessage } from '../history';
import type { ContentBlock, Message } from '../../../shared/provider-types';

// ── Helpers ──────────────────────────────────────────────────────────

let msgCounter = 0;

function makeMsg(opts: {
  participantId: string;
  participantName: string;
  role: 'user' | 'assistant' | 'system';
  content: Message['content'];
  id?: string;
  metadata?: Record<string, unknown>;
}): ParticipantMessage {
  return {
    id: opts.id ?? `msg-${++msgCounter}`,
    role: opts.role,
    content: opts.content,
    participantId: opts.participantId,
    participantName: opts.participantName,
    metadata: opts.metadata,
  };
}

function resetCounter(): void {
  msgCounter = 0;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('adaptMessagesForProvider', () => {
  beforeEach(() => {
    resetCounter();
  });

  // ── Self = assistant, others = user ─────────────────────────────

  describe('role mapping', () => {
    it('converts self messages to assistant role', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Hello' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('assistant');
      expect(adapted[0].content).toBe('Hello');
    });

    it('converts other participant messages to user role with name prefix', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Hi there' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[Gemini]: Hi there');
    });

    it('converts user messages to user role with name prefix', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'What do you think?' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[User]: What do you think?');
    });

    it('handles multi-party conversation correctly', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Discuss this' }),
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'I think...' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'I agree...' }),
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Good point' }),
      ];

      // Adapt for ai-1 (Claude's perspective)
      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // After merge: user message + ai-1 (assistant) + ai-2 (user) + ai-1 (assistant)
      expect(adapted).toHaveLength(4);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[User]: Discuss this');
      expect(adapted[1].role).toBe('assistant');
      expect(adapted[1].content).toBe('I think...');
      expect(adapted[2].role).toBe('user');
      expect(adapted[2].content).toBe('[Gemini]: I agree...');
      expect(adapted[3].role).toBe('assistant');
      expect(adapted[3].content).toBe('Good point');
    });
  });

  // ── Consecutive user message merging ────────────────────────────

  describe('consecutive user message merging', () => {
    it('merges consecutive user messages from different participants', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hello' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Response from Gemini' }),
      ];

      // From ai-1's perspective, both user and ai-2 are "user" role
      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // Both are user-role, so they should be merged into one
      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toContain('[User]: Hello');
      expect(adapted[0].content).toContain('[Gemini]: Response from Gemini');
    });

    it('merges multiple consecutive user messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'First' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Second' }),
        makeMsg({ participantId: 'ai-3', participantName: 'GPT', role: 'assistant', content: 'Third' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // All three become user-role and should be merged
      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      const content = adapted[0].content as string;
      expect(content).toContain('[User]: First');
      expect(content).toContain('[Gemini]: Second');
      expect(content).toContain('[GPT]: Third');
    });

    it('does not merge user messages separated by assistant message', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Q1' }),
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'A1' }),
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Q2' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(3);
      expect(adapted[0].role).toBe('user');
      expect(adapted[1].role).toBe('assistant');
      expect(adapted[2].role).toBe('user');
    });

    it('clears name field on merged messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hi' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Hey' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // Merged message should have name cleared
      expect(adapted).toHaveLength(1);
      expect(adapted[0].name).toBeUndefined();
    });
  });

  // ── System messages ─────────────────────────────────────────────

  describe('system messages', () => {
    it('preserves system messages unchanged', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'system',
          participantName: 'System',
          role: 'system',
          content: 'You are a helpful assistant.',
        }),
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hello' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted[0].role).toBe('system');
      expect(adapted[0].content).toBe('You are a helpful assistant.');
    });

    it('does not add name prefix to system messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'system',
          participantName: 'System',
          role: 'system',
          content: 'Instructions here',
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted[0].content).toBe('Instructions here');
      expect((adapted[0].content as string).startsWith('[')).toBe(false);
    });

    it('system messages break user message merging', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'First' }),
        makeMsg({ participantId: 'system', participantName: 'System', role: 'system', content: 'Note' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Second' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // user, system, user (ai-2 from ai-1's perspective)
      expect(adapted).toHaveLength(3);
      expect(adapted[0].role).toBe('user');
      expect(adapted[1].role).toBe('system');
      expect(adapted[2].role).toBe('user');
    });
  });

  // ── Single-party conversation ───────────────────────────────────

  describe('single-party conversation', () => {
    it('does not transform when only one AI and user', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hi' }),
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Hello!' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(2);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[User]: Hi');
      expect(adapted[1].role).toBe('assistant');
      expect(adapted[1].content).toBe('Hello!');
    });
  });

  // ── Empty and edge cases ────────────────────────────────────────

  describe('empty and edge cases', () => {
    it('returns empty array for empty input', () => {
      const adapted = adaptMessagesForProvider([], 'ai-1');
      expect(adapted).toEqual([]);
    });

    it('handles single message', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Solo' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');
      expect(adapted).toHaveLength(1);
      expect(adapted[0].content).toBe('[User]: Solo');
    });

    it('handles empty string content', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: '' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');
      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[Gemini]: ');
    });

    it('preserves metadata on adapted messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-1',
          participantName: 'Claude',
          role: 'assistant',
          content: 'response',
          metadata: { tokenCount: 50 },
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');
      expect(adapted[0].metadata).toEqual({ tokenCount: 50 });
    });
  });

  // ── ContentBlock[] handling ─────────────────────────────────────

  describe('ContentBlock content handling', () => {
    it('prefixes first text block in ContentBlock array', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: [
            { type: 'text', data: 'Some text' } as ContentBlock,
            { type: 'image', data: 'base64...' } as ContentBlock,
          ],
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');
      expect(adapted[0].role).toBe('user');

      const blocks = adapted[0].content as Array<{ type: string; data: unknown }>;
      expect(blocks[0].data).toBe('[Gemini]: Some text');
      expect(blocks[1].data).toBe('base64...');
    });

    it('merges ContentBlock content with string content', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'user',
          participantName: 'User',
          role: 'user',
          content: 'Text message',
        }),
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: [
            { type: 'text', data: 'Block content' } as ContentBlock,
          ],
        }),
      ];

      // From ai-1's perspective, both are user-role
      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      // Should be merged (mixed → string fallback)
      expect(adapted).toHaveLength(1);
      expect(typeof adapted[0].content).toBe('string');
    });
  });
});
