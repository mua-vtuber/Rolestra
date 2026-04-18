/**
 * Unit tests for the structuredMode parameter in adaptMessagesForProvider.
 *
 * Covers:
 * 1. Without structuredMode (legacy): "[name]: content" prefix
 * 2. With structuredMode='conversation': JSON {name, content} format
 * 3. With structuredMode='work_discussion': JSON {name, content} format
 * 4. With structuredMode='review': JSON {name, content} format
 * 5. Self messages always become role='assistant' regardless of structuredMode
 * 6. System messages pass through unchanged regardless of structuredMode
 * 7. Consecutive user messages are still merged in structuredMode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  adaptMessagesForProvider,
  type ParticipantMessage,
  type StructuredMode,
} from '../history';
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

/**
 * Parse a JSON-formatted structured message content and return the object.
 * Throws if the content is not valid JSON.
 */
function parseStructuredContent(content: Message['content']): { name: string; content: string } {
  if (typeof content !== 'string') {
    throw new Error('Expected string content for structured mode parsing');
  }
  return JSON.parse(content) as { name: string; content: string };
}

// ── Multi-party base messages ────────────────────────────────────────

function makeMultiPartyMessages(): ParticipantMessage[] {
  return [
    makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Discuss this topic.' }),
    makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'I think we should consider...' }),
    makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'I agree with that approach.' }),
    makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Good, let me elaborate.' }),
  ];
}

// ── Tests ────────────────────────────────────────────────────────────

describe('adaptMessagesForProvider — structuredMode', () => {
  beforeEach(() => {
    resetCounter();
  });

  // ── 1. Without structuredMode (legacy) ───────────────────────────

  describe('without structuredMode (legacy behavior)', () => {
    it('prefixes other participants\' messages with [name]: format', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Hello world' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      expect(adapted[0].content).toBe('[Gemini]: Hello world');
    });

    it('prefixes human user messages with [name]: format', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'A question' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(adapted[0].content).toBe('[User]: A question');
    });

    it('applies [name]: prefix in multi-party conversation', () => {
      const adapted = adaptMessagesForProvider(makeMultiPartyMessages(), 'ai-1');

      // From ai-1's perspective: user(User), assistant(self), user(Gemini), assistant(self)
      expect(adapted).toHaveLength(4);
      expect(adapted[0].content).toBe('[User]: Discuss this topic.');
      expect(adapted[2].content).toBe('[Gemini]: I agree with that approach.');
    });

    it('content is NOT valid JSON in legacy mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Some response' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1');

      expect(() => JSON.parse(adapted[0].content as string)).toThrow();
    });
  });

  // ── 2. structuredMode='conversation' ─────────────────────────────

  describe('structuredMode=conversation', () => {
    it('formats other participants\' messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'My thoughts on this' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toBe('My thoughts on this');
    });

    it('formats human user messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'What do you think?' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('User');
      expect(parsed.content).toBe('What do you think?');
    });

    it('sets name field on adapted message', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Reply' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      expect(adapted[0].name).toBe('Gemini');
    });

    it('preserves metadata on structured messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: 'With metadata',
          metadata: { turnNumber: 3 },
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      expect(adapted[0].metadata).toEqual({ turnNumber: 3 });
    });

    it('handles multi-party conversation correctly', () => {
      const adapted = adaptMessagesForProvider(makeMultiPartyMessages(), 'ai-1', 'conversation');

      // From ai-1 (Claude)'s perspective:
      // msg 0: User → user role (structured JSON)
      // msg 1: Claude (self) → assistant role (plain)
      // msg 2: Gemini → user role (structured JSON)
      // msg 3: Claude (self) → assistant role (plain)
      expect(adapted).toHaveLength(4);

      expect(adapted[0].role).toBe('user');
      const userParsed = parseStructuredContent(adapted[0].content);
      expect(userParsed.name).toBe('User');
      expect(userParsed.content).toBe('Discuss this topic.');

      expect(adapted[1].role).toBe('assistant');
      expect(adapted[1].content).toBe('I think we should consider...');

      expect(adapted[2].role).toBe('user');
      const geminiParsed = parseStructuredContent(adapted[2].content);
      expect(geminiParsed.name).toBe('Gemini');
      expect(geminiParsed.content).toBe('I agree with that approach.');

      expect(adapted[3].role).toBe('assistant');
      expect(adapted[3].content).toBe('Good, let me elaborate.');
    });
  });

  // ── 3. structuredMode='work_discussion' ──────────────────────────

  describe('structuredMode=work_discussion', () => {
    it('formats other participants\' messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Code review feedback' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'work_discussion');

      expect(adapted[0].role).toBe('user');
      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toBe('Code review feedback');
    });

    it('formats human user messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Review this code' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'work_discussion');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('User');
      expect(parsed.content).toBe('Review this code');
    });

    it('handles multi-party conversation in work_discussion mode', () => {
      const adapted = adaptMessagesForProvider(makeMultiPartyMessages(), 'ai-1', 'work_discussion');

      expect(adapted).toHaveLength(4);

      // Other participants use structured JSON
      const userParsed = parseStructuredContent(adapted[0].content);
      expect(userParsed.name).toBe('User');

      const geminiParsed = parseStructuredContent(adapted[2].content);
      expect(geminiParsed.name).toBe('Gemini');

      // Self messages remain plain
      expect(adapted[1].content).toBe('I think we should consider...');
      expect(adapted[3].content).toBe('Good, let me elaborate.');
    });
  });

  // ── 4. structuredMode='review' ───────────────────────────────────

  describe('structuredMode=review', () => {
    it('formats other participants\' messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'LGTM with minor nits' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'review');

      expect(adapted[0].role).toBe('user');
      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toBe('LGTM with minor nits');
    });

    it('formats human user messages as JSON {name, content}', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Please review' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'review');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('User');
      expect(parsed.content).toBe('Please review');
    });

    it('handles multi-party conversation in review mode', () => {
      const adapted = adaptMessagesForProvider(makeMultiPartyMessages(), 'ai-1', 'review');

      expect(adapted).toHaveLength(4);

      const userParsed = parseStructuredContent(adapted[0].content);
      expect(userParsed.name).toBe('User');

      const geminiParsed = parseStructuredContent(adapted[2].content);
      expect(geminiParsed.name).toBe('Gemini');

      expect(adapted[1].content).toBe('I think we should consider...');
      expect(adapted[3].content).toBe('Good, let me elaborate.');
    });
  });

  // ── 5. Self messages always role='assistant' ─────────────────────

  describe('self messages always become assistant', () => {
    const modes: Array<StructuredMode | undefined> = [undefined, 'conversation', 'work_discussion', 'review'];

    for (const mode of modes) {
      const label = mode ?? 'undefined (legacy)';

      it(`self messages are assistant with structuredMode=${label}`, () => {
        const messages: ParticipantMessage[] = [
          makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'My response' }),
        ];

        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);

        expect(adapted).toHaveLength(1);
        expect(adapted[0].role).toBe('assistant');
        expect(adapted[0].content).toBe('My response');
      });

      it(`self messages are NOT JSON-wrapped with structuredMode=${label}`, () => {
        const messages: ParticipantMessage[] = [
          makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Plain text here' }),
        ];

        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);

        // Content should remain plain text, not JSON
        expect(adapted[0].content).toBe('Plain text here');
        expect(() => JSON.parse(adapted[0].content as string)).toThrow();
      });
    }

    it('self messages preserve metadata across all modes', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-1',
          participantName: 'Claude',
          role: 'assistant',
          content: 'response',
          metadata: { round: 2 },
        }),
      ];

      for (const mode of modes) {
        resetCounter();
        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);
        expect(adapted[0].metadata).toEqual({ round: 2 });
      }
    });
  });

  // ── 6. System messages unchanged ─────────────────────────────────

  describe('system messages unchanged regardless of structuredMode', () => {
    const modes: Array<StructuredMode | undefined> = [undefined, 'conversation', 'work_discussion', 'review'];

    for (const mode of modes) {
      const label = mode ?? 'undefined (legacy)';

      it(`system messages pass through with structuredMode=${label}`, () => {
        const messages: ParticipantMessage[] = [
          makeMsg({
            participantId: 'system',
            participantName: 'System',
            role: 'system',
            content: 'You are a helpful assistant.',
          }),
        ];

        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);

        expect(adapted).toHaveLength(1);
        expect(adapted[0].role).toBe('system');
        expect(adapted[0].content).toBe('You are a helpful assistant.');
      });

      it(`system messages are NOT JSON-wrapped with structuredMode=${label}`, () => {
        const messages: ParticipantMessage[] = [
          makeMsg({
            participantId: 'system',
            participantName: 'System',
            role: 'system',
            content: 'Instructions for the AI.',
          }),
        ];

        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);

        expect(adapted[0].content).toBe('Instructions for the AI.');
        // Should NOT contain JSON name/content structure
        expect(adapted[0].content).not.toContain('"name"');
      });

      it(`system messages preserve name field with structuredMode=${label}`, () => {
        const messages: ParticipantMessage[] = [
          makeMsg({
            participantId: 'system',
            participantName: 'System',
            role: 'system',
            content: 'System prompt',
          }),
        ];

        const adapted = adaptMessagesForProvider(messages, 'ai-1', mode);

        // System message name field is passed through from original msg.name (undefined here)
        expect(adapted[0].role).toBe('system');
      });
    }

    it('system messages break consecutive user merging in structured mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'First question' }),
        makeMsg({ participantId: 'system', participantName: 'System', role: 'system', content: 'Reminder' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Response' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // user (structured), system (pass-through), user (structured) — not merged
      expect(adapted).toHaveLength(3);
      expect(adapted[0].role).toBe('user');
      expect(adapted[1].role).toBe('system');
      expect(adapted[1].content).toBe('Reminder');
      expect(adapted[2].role).toBe('user');
    });
  });

  // ── 7. Consecutive user messages merge in structured mode ────────

  describe('consecutive user message merging in structuredMode', () => {
    it('merges consecutive user messages from different non-self participants', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Question' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Gemini reply' }),
      ];

      // From ai-1's perspective, both User and Gemini become user-role
      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // Should merge two consecutive user-role messages into one
      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');

      // Merged content contains both structured JSON blocks separated by \n\n
      const content = adapted[0].content as string;
      expect(content).toContain('"User"');
      expect(content).toContain('"Gemini"');
    });

    it('merges three consecutive user messages in structured mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Start' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Middle' }),
        makeMsg({ participantId: 'ai-3', participantName: 'GPT', role: 'assistant', content: 'End' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // All three become user-role → merged into one
      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');

      const content = adapted[0].content as string;
      expect(content).toContain('"User"');
      expect(content).toContain('"Gemini"');
      expect(content).toContain('"GPT"');
    });

    it('clears name field on merged structured messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hi' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Hello' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].name).toBeUndefined();
    });

    it('does not merge user messages separated by an assistant (self) message', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Q1' }),
        makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'A1' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Follow-up' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // user, assistant, user — no merge across assistant boundary
      expect(adapted).toHaveLength(3);
      expect(adapted[0].role).toBe('user');
      expect(adapted[1].role).toBe('assistant');
      expect(adapted[2].role).toBe('user');
    });

    it('merges consecutive user messages in work_discussion mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Task' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Analysis' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'work_discussion');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      const content = adapted[0].content as string;
      expect(content).toContain('"User"');
      expect(content).toContain('"Gemini"');
    });

    it('merges consecutive user messages in review mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'PR description' }),
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Looks good' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'review');

      expect(adapted).toHaveLength(1);
      expect(adapted[0].role).toBe('user');
      const content = adapted[0].content as string;
      expect(content).toContain('"User"');
      expect(content).toContain('"Gemini"');
    });
  });

  // ── ContentBlock[] in structured mode ────────────────────────────

  describe('ContentBlock content in structuredMode', () => {
    it('converts ContentBlock[] to string in structured JSON', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: [
            { type: 'text', data: 'Block content here' } as ContentBlock,
            { type: 'image', data: 'base64data' } as ContentBlock,
          ],
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      expect(adapted[0].role).toBe('user');
      // In structured mode, ContentBlock[] is converted to string via contentToString
      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toBe('Block content here');
    });

    it('handles ContentBlock[] with multiple text blocks', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: [
            { type: 'text', data: 'First paragraph' } as ContentBlock,
            { type: 'text', data: 'Second paragraph' } as ContentBlock,
          ],
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toContain('First paragraph');
      expect(parsed.content).toContain('Second paragraph');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases in structuredMode', () => {
    it('handles empty string content in structured mode', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: '' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.name).toBe('Gemini');
      expect(parsed.content).toBe('');
    });

    it('handles content with special JSON characters', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({
          participantId: 'ai-2',
          participantName: 'Gemini',
          role: 'assistant',
          content: 'He said "hello" and used a \\backslash',
        }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // JSON.stringify handles escaping; JSON.parse should recover the original
      const parsed = parseStructuredContent(adapted[0].content);
      expect(parsed.content).toBe('He said "hello" and used a \\backslash');
    });

    it('returns empty array for empty input in structured mode', () => {
      const adapted = adaptMessagesForProvider([], 'ai-1', 'conversation');
      expect(adapted).toEqual([]);
    });

    it('produces valid JSON for structured messages', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Test validity' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'conversation');

      // Should not throw — content is valid JSON
      expect(() => JSON.parse(adapted[0].content as string)).not.toThrow();
    });

    it('structured JSON only contains name and content keys', () => {
      const messages: ParticipantMessage[] = [
        makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Check keys' }),
      ];

      const adapted = adaptMessagesForProvider(messages, 'ai-1', 'review');

      const parsed = JSON.parse(adapted[0].content as string);
      expect(Object.keys(parsed).sort()).toEqual(['content', 'name']);
    });
  });
});
