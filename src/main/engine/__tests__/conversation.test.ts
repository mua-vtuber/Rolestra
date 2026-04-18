/**
 * Unit tests for ConversationSession — manages a single conversation's lifecycle.
 *
 * Covers:
 * - Session creation with participants
 * - Message add/create
 * - Branch/fork/switch
 * - Deep debate start/record/budget/stop
 * - State transitions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationSession } from '../conversation';
import { DEFAULT_BRANCH_ID } from '../../../shared/engine-types';
import type { Participant } from '../../../shared/engine-types';
import type { ParticipantMessage } from '../history';
import type { SessionConfig } from '../../../shared/session-state-types';

// ── Helpers ──────────────────────────────────────────────────────────

const participants: Participant[] = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', providerId: 'ai-1', displayName: 'Claude', isActive: true },
  { id: 'ai-2', providerId: 'ai-2', displayName: 'Gemini', isActive: true },
];

const singleAiParticipants: Participant[] = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', providerId: 'ai-1', displayName: 'Claude', isActive: true },
];

function createSession(overrides?: {
  id?: string;
  title?: string;
  participants?: Participant[];
  roundSetting?: number | 'unlimited';
  sessionConfig?: Partial<SessionConfig>;
  taskSettings?: import('../../../shared/config-types').ConversationTaskSettings;
}) {
  return new ConversationSession({
    participants,
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ConversationSession', () => {
  let session: ConversationSession;

  beforeEach(() => {
    session = createSession();
  });

  // ── Session creation ────────────────────────────────────────────

  describe('creation', () => {
    it('generates a unique ID', () => {
      const s1 = createSession();
      const s2 = createSession();
      expect(s1.id).toBeDefined();
      expect(s2.id).toBeDefined();
      expect(s1.id).not.toBe(s2.id);
    });

    it('accepts a custom ID', () => {
      const s = createSession({ id: 'custom-id' });
      expect(s.id).toBe('custom-id');
    });

    it('stores participants', () => {
      expect(session.participants).toHaveLength(3);
      expect(session.participants[0].id).toBe('user');
      expect(session.participants[1].id).toBe('ai-1');
      expect(session.participants[2].id).toBe('ai-2');
    });

    it('starts with empty message history', () => {
      expect(session.messages).toHaveLength(0);
    });

    it('starts in idle state', () => {
      expect(session.state).toBe('idle');
    });

    it('sets default title to empty string', () => {
      expect(session.title).toBe('');
    });

    it('accepts a custom title', () => {
      const s = createSession({ title: 'My Conversation' });
      expect(s.title).toBe('My Conversation');
    });

    it('allows setting title', () => {
      session.title = 'New Title';
      expect(session.title).toBe('New Title');
    });

    it('starts on the main branch', () => {
      expect(session.currentBranchId).toBe(DEFAULT_BRANCH_ID);
    });

    it('uses default round setting of unlimited', () => {
      expect(session.turnManager.roundSetting).toBe('unlimited');
    });

    it('accepts custom round setting', () => {
      const s = createSession({ roundSetting: 5 });
      expect(s.turnManager.roundSetting).toBe(5);
    });

    it('creates SSM for arena mode (2+ AI participants)', () => {
      expect(session.sessionMachine).not.toBeNull();
      expect(session.sessionMachine?.state).toBe('CONVERSATION');
    });

    it('does not create SSM for 1:1 mode (single AI)', () => {
      const s = createSession({ participants: singleAiParticipants });
      expect(s.sessionMachine).toBeNull();
    });

    it('deprecated consensus accessor returns null', () => {
      expect(session.consensus).toBeNull();
    });

    it('passes sessionConfig to SSM', () => {
      const s = createSession({
        sessionConfig: { maxRetries: 7, phaseTimeout: 60_000 },
      });
      expect(s.sessionMachine).not.toBeNull();
      expect(s.sessionMachine!.config.maxRetries).toBe(7);
      expect(s.sessionMachine!.config.phaseTimeout).toBe(60_000);
    });

    it('setProjectPath delegates to SSM', () => {
      session.setProjectPath('/my/project');
      expect(session.sessionMachine?.projectPath).toBe('/my/project');
    });

    it('setProjectPath is no-op when SSM is null', () => {
      const s = createSession({ participants: singleAiParticipants });
      // Should not throw
      s.setProjectPath('/my/project');
    });
  });

  // ── Message management ──────────────────────────────────────────

  describe('message management', () => {
    it('adds a message with addMessage', () => {
      const msg: ParticipantMessage = {
        id: 'msg-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Hello',
      };

      session.addMessage(msg);

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe('Hello');
    });

    it('automatically assigns branchId if not set', () => {
      const msg: ParticipantMessage = {
        id: 'msg-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Hello',
      };

      session.addMessage(msg);

      expect(session.messages[0].branchId).toBe(DEFAULT_BRANCH_ID);
    });

    it('sets parentMessageId automatically', () => {
      session.addMessage({
        id: 'msg-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'First',
      });

      session.addMessage({
        id: 'msg-2',
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Second',
      });

      expect(session.messages[1].parentMessageId).toBe('msg-1');
    });

    it('creates and adds a message with createMessage', () => {
      const msg = session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Created message',
      });

      expect(msg.id).toBeDefined();
      expect(msg.content).toBe('Created message');
      expect(msg.branchId).toBe(DEFAULT_BRANCH_ID);
      expect(session.messages).toHaveLength(1);
    });

    it('createMessage auto-chains parentMessageId', () => {
      session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'First',
      });

      const second = session.createMessage({
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Second',
      });

      expect(second.parentMessageId).toBe(session.messages[0].id);
    });

    it('accepts custom message ID', () => {
      const msg = session.createMessage({
        id: 'custom-msg-id',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Hello',
      });

      expect(msg.id).toBe('custom-msg-id');
    });

    it('preserves metadata', () => {
      const msg = session.createMessage({
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Response',
        metadata: { tokenCount: 50, responseTimeMs: 200 },
      });

      expect(msg.metadata).toEqual({ tokenCount: 50, responseTimeMs: 200 });
    });
  });

  // ── Message adaptation for provider ─────────────────────────────

  describe('getMessagesForProvider', () => {
    it('adapts messages for a specific provider perspective', () => {
      session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Question',
      });

      session.createMessage({
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Answer from Claude',
      });

      session.createMessage({
        participantId: 'ai-2',
        participantName: 'Gemini',
        role: 'assistant',
        content: 'Answer from Gemini',
      });

      // From Claude's perspective
      const forClaude = session.getMessagesForProvider('ai-1');

      // user -> user, ai-1 -> assistant, ai-2 -> user
      // user + ai-2 should NOT be merged because ai-1 (assistant) sits between them
      expect(forClaude).toHaveLength(3);
      expect(forClaude[0].role).toBe('user');
      expect(forClaude[1].role).toBe('assistant');
      expect(forClaude[2].role).toBe('user');
    });
  });

  // ── Branch / Fork / Switch ──────────────────────────────────────

  describe('branching', () => {
    it('starts with no branches', () => {
      expect(session.listBranches()).toHaveLength(0);
    });

    it('fork creates a new branch from a message', () => {
      const msg = session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Fork point',
      });

      const result = session.fork(msg.id);

      expect(result.branchId).toBeDefined();
      expect(result.branchRootMessageId).toBe(msg.id);
      expect(session.currentBranchId).toBe(result.branchId);
      expect(session.listBranches()).toHaveLength(1);
    });

    it('fork throws for nonexistent message', () => {
      expect(() => session.fork('nonexistent')).toThrow('Message not found');
    });

    it('fork resets turn manager', () => {
      session.start();
      session.getNextSpeaker();

      const msg = session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Fork here',
      });

      session.fork(msg.id);

      // Turn manager should be reset to idle
      expect(session.state).toBe('idle');
    });

    it('switch branch changes current branch', () => {
      const msg = session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Base',
      });

      const result = session.fork(msg.id);
      expect(session.currentBranchId).toBe(result.branchId);

      session.switchBranch(DEFAULT_BRANCH_ID);
      expect(session.currentBranchId).toBe(DEFAULT_BRANCH_ID);

      session.switchBranch(result.branchId);
      expect(session.currentBranchId).toBe(result.branchId);
    });

    it('switch branch throws for nonexistent branch', () => {
      expect(() => session.switchBranch('nonexistent-branch')).toThrow('Branch not found');
    });

    it('fork branch inherits ancestor messages up to fork point', () => {
      const msg1 = session.createMessage({
        id: 'msg-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Message 1',
      });

      session.createMessage({
        id: 'msg-2',
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Message 2',
      });

      // Fork from msg-1
      const result = session.fork(msg1.id);

      // Add message on fork branch
      session.createMessage({
        id: 'msg-3',
        participantId: 'ai-2',
        participantName: 'Gemini',
        role: 'assistant',
        content: 'Forked message',
      });

      const branchMessages = session.getMessagesForBranch(result.branchId);

      // Should include msg-1 (ancestor) + msg-3 (fork branch)
      // msg-2 should NOT be included (it's after the fork point on the main branch)
      expect(branchMessages).toHaveLength(2);
      expect(branchMessages[0].id).toBe('msg-1');
      expect(branchMessages[1].id).toBe('msg-3');
    });

    it('main branch messages are not affected by fork', () => {
      session.createMessage({
        id: 'msg-1',
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Message 1',
      });

      session.createMessage({
        id: 'msg-2',
        participantId: 'ai-1',
        participantName: 'Claude',
        role: 'assistant',
        content: 'Message 2',
      });

      const mainMessages = session.getMessagesForBranch(DEFAULT_BRANCH_ID);
      expect(mainMessages).toHaveLength(2);

      // Fork and add message
      session.fork('msg-1');
      session.createMessage({
        id: 'msg-3',
        participantId: 'ai-2',
        participantName: 'Gemini',
        role: 'assistant',
        content: 'Forked',
      });

      // Main branch still has 2 messages
      const mainAfterFork = session.getMessagesForBranch(DEFAULT_BRANCH_ID);
      expect(mainAfterFork).toHaveLength(2);
    });
  });

  // ── Deep debate ─────────────────────────────────────────────────

  describe('deep debate', () => {
    it('is not active by default', () => {
      expect(session.deepDebateActive).toBe(false);
      expect(session.deepDebateTurnsUsed).toBe(0);
    });

    it('starts deep debate mode', () => {
      session.startDeepDebate();

      expect(session.deepDebateActive).toBe(true);
      expect(session.deepDebateTurnsUsed).toBe(0);
    });

    it('records deep debate turns', () => {
      session.startDeepDebate();

      session.recordDeepDebateTurn();
      expect(session.deepDebateTurnsUsed).toBe(1);

      session.recordDeepDebateTurn();
      expect(session.deepDebateTurnsUsed).toBe(2);
    });

    it('does not record turns when deep debate is inactive', () => {
      session.recordDeepDebateTurn();
      expect(session.deepDebateTurnsUsed).toBe(0);
    });

    it('reports budget exhaustion', () => {
      const s = createSession({
        taskSettings: {
          deepDebateTurnBudget: 3,
          aiDecisionParseRetryLimit: 2,
          twoParticipantUnanimousRequired: true,
          majorityAllowedFromParticipants: 3,
          hardBlockReasonTypes: ['security', 'data_loss'],
          softBlockReasonTypes: ['spec_conflict', 'unknown'],
          failureResolutionOptions: ['retry', 'stop', 'reassign'],
        },
      });

      s.startDeepDebate();
      expect(s.isDeepDebateBudgetExhausted()).toBe(false);

      s.recordDeepDebateTurn();
      s.recordDeepDebateTurn();
      expect(s.isDeepDebateBudgetExhausted()).toBe(false);

      s.recordDeepDebateTurn();
      expect(s.isDeepDebateBudgetExhausted()).toBe(true);
    });

    it('reports remaining turns', () => {
      const s = createSession({
        taskSettings: {
          deepDebateTurnBudget: 5,
          aiDecisionParseRetryLimit: 2,
          twoParticipantUnanimousRequired: true,
          majorityAllowedFromParticipants: 3,
          hardBlockReasonTypes: ['security', 'data_loss'],
          softBlockReasonTypes: ['spec_conflict', 'unknown'],
          failureResolutionOptions: ['retry', 'stop', 'reassign'],
        },
      });

      // Not active — remaining is 0
      expect(s.deepDebateTurnsRemaining).toBe(0);

      s.startDeepDebate();
      expect(s.deepDebateTurnsRemaining).toBe(5);

      s.recordDeepDebateTurn();
      s.recordDeepDebateTurn();
      expect(s.deepDebateTurnsRemaining).toBe(3);
    });

    it('uses default budget of 30 when no taskSettings', () => {
      expect(session.deepDebateTurnBudget).toBe(30);
    });

    it('stops deep debate and resets counters', () => {
      session.startDeepDebate();
      session.recordDeepDebateTurn();
      session.recordDeepDebateTurn();

      session.stopDeepDebate();

      expect(session.deepDebateActive).toBe(false);
      expect(session.deepDebateTurnsUsed).toBe(0);
    });

    it('budget exhaustion returns false when not active', () => {
      expect(session.isDeepDebateBudgetExhausted()).toBe(false);
    });
  });

  // ── State transitions (lifecycle) ───────────────────────────────

  describe('state transitions', () => {
    it('start transitions from idle to running', () => {
      session.start();
      expect(session.state).toBe('running');
    });

    it('pause transitions from running to paused', () => {
      session.start();
      session.pause();
      expect(session.state).toBe('paused');
    });

    it('resume transitions from paused to running', () => {
      session.start();
      session.pause();
      session.resume();
      expect(session.state).toBe('running');
    });

    it('stop transitions to stopped', () => {
      session.start();
      session.stop();
      expect(session.state).toBe('stopped');
    });

    it('start throws when not idle', () => {
      session.start();
      expect(() => session.start()).toThrow();
    });

    it('pause throws when not running', () => {
      expect(() => session.pause()).toThrow();
    });

    it('resume throws when not paused', () => {
      session.start();
      expect(() => session.resume()).toThrow();
    });
  });

  // ── Turn delegation ─────────────────────────────────────────────

  describe('turn delegation', () => {
    it('delegates getNextSpeaker to TurnManager', () => {
      session.start();

      const speaker = session.getNextSpeaker();
      expect(speaker?.id).toBe('ai-1');
    });

    it('delegates isComplete', () => {
      const s = createSession({ roundSetting: 1 });
      s.start();

      expect(s.isComplete()).toBe(false);

      s.getNextSpeaker(); // ai-1
      s.getNextSpeaker(); // ai-2

      expect(s.isComplete()).toBe(true);
    });

    it('setRoundSetting updates turn manager', () => {
      session.setRoundSetting(10);
      expect(session.turnManager.roundSetting).toBe(10);
    });
  });

  // ── Serialization ───────────────────────────────────────────────

  describe('serialization', () => {
    it('toInfo returns correct ConversationInfo', () => {
      session.title = 'Test Conv';
      session.start();

      const info = session.toInfo();

      expect(info.id).toBe(session.id);
      expect(info.title).toBe('Test Conv');
      expect(info.state).toBe('running');
      expect(info.participants).toHaveLength(3);
      expect(info.currentRound).toBe(1);
      expect(info.roundSetting).toBe('unlimited');
      expect(info.currentBranchId).toBe(DEFAULT_BRANCH_ID);
      expect(info.branches).toEqual([]);
    });

    it('toInfo includes branches after fork', () => {
      const msg = session.createMessage({
        participantId: 'user',
        participantName: 'User',
        role: 'user',
        content: 'Hello',
      });

      session.fork(msg.id);

      const info = session.toInfo();
      expect(info.branches).toHaveLength(1);
      expect(info.currentBranchId).toBe(info.branches[0].id);
    });
  });
});
