/**
 * Unit tests for structuredMode parameter in adaptMessagesForProvider.
 *
 * Covers:
 * - JSON format for other participants when structuredMode is set
 * - Self messages remain plain assistant without JSON wrapping
 * - Legacy [name]: prefix when structuredMode is undefined
 * - Support for different structuredMode values (conversation, work_discussion, review)
 */

import { describe, it, expect } from 'vitest';
import { adaptMessagesForProvider, type ParticipantMessage } from '../history';

const makeMessages = (): ParticipantMessage[] => [
  { id: '1', role: 'user', content: 'Hello', participantId: 'user', participantName: 'User' },
  { id: '2', role: 'assistant', content: 'Hi from Alpha', participantId: 'ai-1', participantName: 'Alpha' },
  { id: '3', role: 'assistant', content: 'Hello from Beta', participantId: 'ai-2', participantName: 'Beta' },
];

describe('adaptMessagesForProvider — structuredMode', () => {
  it('uses JSON format for other participants in conversation mode', () => {
    const result = adaptMessagesForProvider(makeMessages(), 'ai-1', 'conversation');
    // User message should be JSON
    const userMsg = result.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('"name"'));
    expect(userMsg).toBeTruthy();
    const parsed = JSON.parse(userMsg!.content as string);
    expect(parsed.name).toBe('User');
    expect(parsed.content).toBe('Hello');
  });

  it('uses JSON format for other AI in conversation mode', () => {
    const result = adaptMessagesForProvider(makeMessages(), 'ai-1', 'conversation');
    // Beta's message (other AI) should be JSON-formatted user message
    const betaMsg = result.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Beta'));
    expect(betaMsg).toBeTruthy();
    const parsed = JSON.parse(betaMsg!.content as string);
    expect(parsed.name).toBe('Beta');
  });

  it('keeps self messages as assistant without JSON wrapping', () => {
    const result = adaptMessagesForProvider(makeMessages(), 'ai-1', 'conversation');
    const selfMsg = result.find(m => m.role === 'assistant');
    expect(selfMsg).toBeTruthy();
    expect(selfMsg!.content).toBe('Hi from Alpha');
  });

  it('uses [name]: prefix when structuredMode is undefined', () => {
    const result = adaptMessagesForProvider(makeMessages(), 'ai-1');
    const betaMsg = result.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Beta]'));
    expect(betaMsg).toBeTruthy();
    // Should NOT be JSON
    expect(() => JSON.parse(betaMsg!.content as string)).toThrow();
  });

  it('supports work_discussion mode', () => {
    const result = adaptMessagesForProvider(makeMessages(), 'ai-1', 'work_discussion');
    const userMsg = result.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('"name"'));
    expect(userMsg).toBeTruthy();
  });
});
