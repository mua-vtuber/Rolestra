/**
 * Integration tests: Multi-party message adaptation.
 *
 * Tests the core multi-party message formatting where each AI sees itself
 * as role=assistant and all other participants as role=user with name prefixes.
 *
 * Integrates adaptMessagesForProvider (history.ts) with ConversationSession
 * to verify the full message adaptation pipeline in realistic scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { adaptMessagesForProvider, type ParticipantMessage } from '../history';
import { ConversationSession } from '../conversation';
import { PARTICIPANTS_3AI } from '../../../test-utils';
import type { Message } from '../../../shared/provider-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

// ── Helpers ──────────────────────────────────────────────────────────

let msgCounter = 0;

function makeMsg(opts: {
  participantId: string;
  participantName: string;
  role: Message['role'];
  content: string;
}): ParticipantMessage {
  return {
    id: `msg-${++msgCounter}`,
    role: opts.role,
    content: opts.content,
    participantId: opts.participantId,
    participantName: opts.participantName,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Multi-party message adaptation integration', () => {
  beforeEach(() => {
    msgCounter = 0;
  });

  it('3 AI conversation: AI-1 sees own messages as assistant, others as user with name prefix', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'What do you think about React vs Vue?' }),
      makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'I prefer React for its flexibility.' }),
      makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Vue has better DX for beginners.' }),
      makeMsg({ participantId: 'ai-3', participantName: 'GPT', role: 'assistant', content: 'Both have merit, depends on the team.' }),
    ];

    const adapted = adaptMessagesForProvider(messages, 'ai-1');

    // user + ai-2 + ai-3 are consecutive user-role → merged
    // ai-1 is assistant
    // After merge: user-merged, assistant(ai-1), user(ai-2), user(ai-3)
    // But ai-2 and ai-3 are consecutive user → merged again
    // So: user(User), assistant(ai-1), user(ai-2 + ai-3)
    expect(adapted).toHaveLength(3);
    expect(adapted[0].role).toBe('user');
    expect(adapted[0].content).toContain('[User]:');
    expect(adapted[1].role).toBe('assistant');
    expect(adapted[1].content).toBe('I prefer React for its flexibility.');
    expect(adapted[2].role).toBe('user');
    expect((adapted[2].content as string)).toContain('[Gemini]:');
    expect((adapted[2].content as string)).toContain('[GPT]:');
  });

  it('3 AI conversation: AI-2 sees the same messages differently (its own as assistant)', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'What do you think about React vs Vue?' }),
      makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'I prefer React for its flexibility.' }),
      makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'Vue has better DX for beginners.' }),
      makeMsg({ participantId: 'ai-3', participantName: 'GPT', role: 'assistant', content: 'Both have merit, depends on the team.' }),
    ];

    const adapted = adaptMessagesForProvider(messages, 'ai-2');

    // From ai-2's perspective:
    // user → user "[User]: ..."
    // ai-1 → user "[Claude]: ..."
    // (consecutive user messages merged)
    // ai-2 → assistant
    // ai-3 → user "[GPT]: ..."
    expect(adapted).toHaveLength(3);

    // First message: merged user + ai-1 (both user-role from ai-2's view)
    expect(adapted[0].role).toBe('user');
    expect((adapted[0].content as string)).toContain('[User]:');
    expect((adapted[0].content as string)).toContain('[Claude]:');

    // Second: ai-2's own message as assistant
    expect(adapted[1].role).toBe('assistant');
    expect(adapted[1].content).toBe('Vue has better DX for beginners.');

    // Third: ai-3 as user
    expect(adapted[2].role).toBe('user');
    expect((adapted[2].content as string)).toContain('[GPT]:');
  });

  it('user messages always have role=user for all perspectives', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Hello everyone' }),
      makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Hi!' }),
    ];

    // From ai-1's perspective
    const adapted1 = adaptMessagesForProvider(messages, 'ai-1');
    expect(adapted1[0].role).toBe('user');

    // From ai-2's perspective
    const adapted2 = adaptMessagesForProvider(messages, 'ai-2');
    expect(adapted2[0].role).toBe('user');

    // From ai-3's perspective
    const adapted3 = adaptMessagesForProvider(messages, 'ai-3');
    expect(adapted3[0].role).toBe('user');
  });

  it('system messages preserved for all perspectives', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'system', participantName: 'System', role: 'system', content: 'You are in a discussion.' }),
      makeMsg({ participantId: 'user', participantName: 'User', role: 'user', content: 'Start' }),
      makeMsg({ participantId: 'ai-1', participantName: 'Claude', role: 'assistant', content: 'Ready.' }),
    ];

    for (const perspectiveId of ['ai-1', 'ai-2', 'ai-3']) {
      const adapted = adaptMessagesForProvider(messages, perspectiveId);
      const systemMsgs = adapted.filter(m => m.role === 'system');
      expect(systemMsgs).toHaveLength(1);
      expect(systemMsgs[0].content).toBe('You are in a discussion.');
    }
  });

  it('name prefix format: "[Name]: content" for other AI messages', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: 'My analysis shows...' }),
    ];

    const adapted = adaptMessagesForProvider(messages, 'ai-1');

    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe('user');
    expect(adapted[0].content).toBe('[Gemini]: My analysis shows...');
  });

  it('10+ messages: consistent formatting throughout conversation', () => {
    const messages: ParticipantMessage[] = [];

    // Build a 12-message conversation alternating between 3 AIs and user
    const speakers = [
      { id: 'user', name: 'User', role: 'user' as const },
      { id: 'ai-1', name: 'Claude', role: 'assistant' as const },
      { id: 'ai-2', name: 'Gemini', role: 'assistant' as const },
      { id: 'ai-3', name: 'GPT', role: 'assistant' as const },
    ];

    for (let i = 0; i < 12; i++) {
      const speaker = speakers[i % speakers.length];
      messages.push(makeMsg({
        participantId: speaker.id,
        participantName: speaker.name,
        role: speaker.role,
        content: `Message ${i + 1} from ${speaker.name}`,
      }));
    }

    // Verify from ai-1's perspective
    const adapted = adaptMessagesForProvider(messages, 'ai-1');

    // Every message should be either 'assistant' (ai-1) or 'user' (others) or 'system'
    for (const msg of adapted) {
      expect(['user', 'assistant', 'system']).toContain(msg.role);
    }

    // ai-1's messages should be assistant
    const assistantMsgs = adapted.filter(m => m.role === 'assistant');
    for (const msg of assistantMsgs) {
      // assistant messages should NOT have [name] prefix
      expect((msg.content as string).startsWith('[')).toBe(false);
    }

    // Verify no consecutive messages of the same non-assistant role remain
    // (user messages should be merged)
    for (let i = 1; i < adapted.length; i++) {
      if (adapted[i].role === 'user' && adapted[i - 1].role === 'user') {
        // Should not happen — consecutive users should be merged
        expect.unreachable('Consecutive user messages should be merged');
      }
    }
  });

  it('empty message content is handled correctly', () => {
    const messages: ParticipantMessage[] = [
      makeMsg({ participantId: 'ai-2', participantName: 'Gemini', role: 'assistant', content: '' }),
    ];

    const adapted = adaptMessagesForProvider(messages, 'ai-1');

    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe('user');
    expect(adapted[0].content).toBe('[Gemini]: ');
  });

  it('branch isolation: ConversationSession serves only current branch messages', () => {
    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: [...PARTICIPANTS_3AI],
      roundSetting: 'unlimited',
    });

    // Add messages to main branch
    session.createMessage({
      id: 'msg-main-1',
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Hello on main',
    });
    session.createMessage({
      id: 'msg-main-2',
      participantId: 'ai-1',
      participantName: 'Claude',
      role: 'assistant',
      content: 'Hi from Claude on main',
    });
    session.createMessage({
      id: 'msg-main-3',
      participantId: 'ai-2',
      participantName: 'Gemini',
      role: 'assistant',
      content: 'Hi from Gemini on main',
    });

    // Fork from msg-main-2 (ai-1's response)
    session.fork('msg-main-2');

    // Add a message to the fork branch (from user perspective to break merge)
    session.createMessage({
      id: 'msg-fork-1',
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Forked question',
    });
    session.createMessage({
      id: 'msg-fork-2',
      participantId: 'ai-3',
      participantName: 'GPT',
      role: 'assistant',
      content: 'GPT reply on fork',
    });

    // Get messages for provider on fork branch from ai-1's perspective
    const forkedMessages = session.getMessagesForProvider('ai-1');

    // Should see: msg-main-1 (ancestor user), msg-main-2 (ancestor ai-1)
    //           + msg-fork-1 (fork user), msg-fork-2 (fork ai-3)
    // msg-main-3 should NOT appear (it's on main branch, after fork point)

    // From ai-1's perspective:
    // msg-main-1 (user) → user "[User]: Hello on main"
    // msg-main-2 (ai-1) → assistant "Hi from Claude on main"
    // msg-fork-1 (user) → user "[User]: Forked question"
    // msg-fork-2 (ai-3) → user "[GPT]: GPT reply on fork"
    // consecutive user msgs (fork-1 + fork-2) get merged

    // Verify msg-main-3 (Gemini's main message) is NOT present
    const allContent = forkedMessages.map(m => m.content as string).join(' ');
    expect(allContent).not.toContain('Gemini on main');

    // Verify fork messages ARE present
    expect(allContent).toContain('Forked question');
    expect(allContent).toContain('GPT reply on fork');

    // Verify ancestor messages ARE present
    expect(allContent).toContain('Hello on main');
    expect(allContent).toContain('Hi from Claude on main');
  });
});
