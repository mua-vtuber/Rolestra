/**
 * Integration tests: Deep Debate Turn Budget.
 *
 * Tests the deep debate feature where conversations have a configurable
 * turn budget. The budget is tracked by ConversationSession and
 * enforced via isDeepDebateBudgetExhausted().
 *
 * Integrates ConversationSession + TurnManager to verify that deep debate
 * budget interacts correctly with the round/turn system.
 */

import { describe, it, expect } from 'vitest';
import { ConversationSession } from '../conversation';
import { DEFAULT_CONVERSATION_TASK_SETTINGS } from '../../../shared/config-types';
import { PARTICIPANTS_3AI, PARTICIPANTS_2AI } from '../../../test-utils';
import type { Participant } from '../../../shared/engine-types';

// ── Helpers ──────────────────────────────────────────────────────────

function createSessionWithBudget(
  budget: number,
  participants: Participant[] = PARTICIPANTS_3AI,
  roundSetting: number | 'unlimited' = 'unlimited',
): ConversationSession {
  return new ConversationSession({
    participants: [...participants],
    roundSetting,
    taskSettings: { ...DEFAULT_CONVERSATION_TASK_SETTINGS, deepDebateTurnBudget: budget },
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Deep Debate Turn Budget integration', () => {
  it('tracks turns incrementally during active deep debate', () => {
    const session = createSessionWithBudget(10);

    session.startDeepDebate();
    expect(session.deepDebateActive).toBe(true);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnBudget).toBe(10);

    // Record turns
    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(1);
    expect(session.deepDebateTurnsRemaining).toBe(9);

    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(3);
    expect(session.deepDebateTurnsRemaining).toBe(7);
  });

  it('detects budget exhaustion at exact boundary', () => {
    const session = createSessionWithBudget(3);

    session.startDeepDebate();

    session.recordDeepDebateTurn(); // 1 of 3
    expect(session.isDeepDebateBudgetExhausted()).toBe(false);
    expect(session.deepDebateTurnsRemaining).toBe(2);

    session.recordDeepDebateTurn(); // 2 of 3
    expect(session.isDeepDebateBudgetExhausted()).toBe(false);
    expect(session.deepDebateTurnsRemaining).toBe(1);

    session.recordDeepDebateTurn(); // 3 of 3 — at budget
    expect(session.isDeepDebateBudgetExhausted()).toBe(true);
    expect(session.deepDebateTurnsRemaining).toBe(0);
  });

  it('stopDeepDebate resets and allows conversation to continue', () => {
    const session = createSessionWithBudget(5);

    session.startDeepDebate();
    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();
    expect(session.deepDebateTurnsUsed).toBe(2);

    session.stopDeepDebate();
    expect(session.deepDebateActive).toBe(false);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnsRemaining).toBe(0);

    // Session can still continue operating (add messages, manage turns)
    session.start();
    expect(session.state).toBe('running');

    // Start a new deep debate
    session.startDeepDebate();
    expect(session.deepDebateActive).toBe(true);
    expect(session.deepDebateTurnsUsed).toBe(0);
    expect(session.deepDebateTurnBudget).toBe(5);
  });

  it('user can abort (stop session) before budget exhausted', () => {
    const session = createSessionWithBudget(20);

    session.startDeepDebate();
    session.start();

    // Record some turns, not exhausting budget
    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();
    expect(session.isDeepDebateBudgetExhausted()).toBe(false);

    // User stops the session mid-debate
    session.stop();
    expect(session.state).toBe('stopped');

    // Deep debate is still technically active until explicitly stopped
    expect(session.deepDebateActive).toBe(true);
    expect(session.deepDebateTurnsUsed).toBe(2);
  });

  it('conversation state allows continuation after debate concludes with budget exhaustion', () => {
    const session = createSessionWithBudget(2, PARTICIPANTS_2AI);

    session.startDeepDebate();
    session.start();

    // Exhaust budget
    session.recordDeepDebateTurn();
    session.recordDeepDebateTurn();
    expect(session.isDeepDebateBudgetExhausted()).toBe(true);

    // Stop deep debate (as TurnExecutor would do)
    session.stopDeepDebate();
    expect(session.deepDebateActive).toBe(false);

    // Session is still running — conversation can continue
    expect(session.state).toBe('running');

    // Messages can still be added
    session.createMessage({
      participantId: 'user',
      participantName: 'User',
      role: 'user',
      content: 'Lets wrap up.',
    });

    expect(session.messages).toHaveLength(1);
  });
});
