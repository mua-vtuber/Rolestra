/**
 * Tests for deep debate turn budget enforcement in ConversationSession.
 */

import { describe, it, expect } from 'vitest';
import { ConversationSession } from '../conversation';
import { DEFAULT_CONVERSATION_TASK_SETTINGS } from '../../../shared/config-types';
import type { Participant } from '../../../shared/engine-types';

const makeParticipants = (): Participant[] => [
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
  { id: 'user', displayName: 'User', isActive: true },
];

describe('Deep Debate Turn Budget', () => {
  it('starts inactive by default', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: DEFAULT_CONVERSATION_TASK_SETTINGS,
    });

    expect(session.deepDebateActive).toBe(false);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnsRemaining).toBe(0);
  });

  it('activates and tracks turns', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: { ...DEFAULT_CONVERSATION_TASK_SETTINGS, deepDebateTurnBudget: 5 },
    });

    session.startDeepDebate();
    expect(session.deepDebateActive).toBe(true);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnBudget).toBe(5);
    expect(session.deepDebateTurnsRemaining).toBe(5);

    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(1);
    expect(session.deepDebateTurnsRemaining).toBe(4);
  });

  it('detects budget exhaustion at exact boundary', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: { ...DEFAULT_CONVERSATION_TASK_SETTINGS, deepDebateTurnBudget: 3 },
    });

    session.startDeepDebate();

    session.recordDeepDebateTurn(); // 1
    expect(session.isDeepDebateBudgetExhausted()).toBe(false);

    session.recordDeepDebateTurn(); // 2
    expect(session.isDeepDebateBudgetExhausted()).toBe(false);

    session.recordDeepDebateTurn(); // 3 — exactly at budget
    expect(session.isDeepDebateBudgetExhausted()).toBe(true);
    expect(session.deepDebateTurnsRemaining).toBe(0);
  });

  it('stopDeepDebate resets state', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: { ...DEFAULT_CONVERSATION_TASK_SETTINGS, deepDebateTurnBudget: 10 },
    });

    session.startDeepDebate();
    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();

    session.stopDeepDebate();
    expect(session.deepDebateActive).toBe(false);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnsRemaining).toBe(0);
  });

  it('recordDeepDebateTurn is no-op when inactive', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: DEFAULT_CONVERSATION_TASK_SETTINGS,
    });

    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(0);
  });

  it('isDeepDebateBudgetExhausted returns false when inactive', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: DEFAULT_CONVERSATION_TASK_SETTINGS,
    });

    expect(session.isDeepDebateBudgetExhausted()).toBe(false);
  });

  it('uses default budget (30) when taskSettings omits deepDebateTurnBudget', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
    });

    session.startDeepDebate();
    expect(session.deepDebateTurnBudget).toBe(30);
    expect(session.deepDebateTurnsRemaining).toBe(30);
  });

  it('supports custom budget via taskSettings', () => {
    // @ts-expect-error R2-Task21 — SsmContext now required; cleanup pending
    const session = new ConversationSession({
      participants: makeParticipants(),
      taskSettings: { ...DEFAULT_CONVERSATION_TASK_SETTINGS, deepDebateTurnBudget: 50 },
    });

    session.startDeepDebate();
    expect(session.deepDebateTurnBudget).toBe(50);
    expect(session.deepDebateTurnsRemaining).toBe(50);
  });
});
