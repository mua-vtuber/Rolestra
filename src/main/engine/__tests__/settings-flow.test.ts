/**
 * Integration test: Settings → Session → SSM config flow.
 *
 * Verifies that SessionConfig from session-state-types are correctly
 * passed through ConversationSession to SessionStateMachine.
 */

import { describe, it, expect } from 'vitest';
import { ConversationSession } from '../conversation';
import type { SessionConfig } from '../../../shared/session-state-types';
import type { ConversationTaskSettings } from '../../../shared/config-types';
import { DEFAULT_CONVERSATION_TASK_SETTINGS } from '../../../shared/config-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

const TEST_PARTICIPANTS = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', providerId: 'ai-1', displayName: 'AI 1', isActive: true },
  { id: 'ai-2', providerId: 'ai-2', displayName: 'AI 2', isActive: true },
];

describe('Settings → Session → SSM Flow', () => {
  it('passes sessionConfig to SSM', () => {
    const sessionConfig: Partial<SessionConfig> = {
      maxRetries: 5,
      phaseTimeout: 120_000,
      aggregatorStrategy: 'designated',
      parseRetryLimit: 3,
    };

    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
      sessionConfig,
    });

    expect(session.sessionMachine).not.toBeNull();
    expect(session.sessionMachine!.config.maxRetries).toBe(5);
    expect(session.sessionMachine!.config.phaseTimeout).toBe(120_000);
    expect(session.sessionMachine!.config.aggregatorStrategy).toBe('designated');
    expect(session.sessionMachine!.config.parseRetryLimit).toBe(3);
  });

  it('uses default session config when not provided', () => {
    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
    });

    expect(session.sessionMachine).not.toBeNull();
    expect(session.sessionMachine!.config.maxRetries).toBe(3);
    expect(session.sessionMachine!.config.aggregatorStrategy).toBe('designated');
  });

  it('stores taskSettings and exposes via accessor', () => {
    const taskSettings: ConversationTaskSettings = {
      ...DEFAULT_CONVERSATION_TASK_SETTINGS,
      aiDecisionParseRetryLimit: 5,
      twoParticipantUnanimousRequired: false,
    };

    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
      taskSettings,
    });

    expect(session.taskSettings).not.toBeNull();
    expect(session.taskSettings!.aiDecisionParseRetryLimit).toBe(5);
    expect(session.taskSettings!.twoParticipantUnanimousRequired).toBe(false);
  });

  it('returns null taskSettings when not provided', () => {
    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
    });

    expect(session.taskSettings).toBeNull();
  });

  it('creates SSM for arena mode (2+ AI)', () => {
    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
      sessionConfig: { maxRetries: 10 },
    });

    expect(session.sessionMachine).not.toBeNull();
    expect(session.sessionMachine!.config.maxRetries).toBe(10);
  });

  it('maps settings fields to session config correctly', () => {
    // Simulates what chat-handler does
    const settings = {
      maxRetries: 7,
      phaseTimeoutMs: 90_000,
      aggregatorStrategy: 'designated' as const,
    };
    const taskSettings = {
      ...DEFAULT_CONVERSATION_TASK_SETTINGS,
      aiDecisionParseRetryLimit: 4,
      deepDebateTurnBudget: 50,
    };

    const session = new ConversationSession({
      ssmCtx: createDefaultSsmContext(),
      participants: TEST_PARTICIPANTS,
      sessionConfig: {
        maxRetries: settings.maxRetries,
        phaseTimeout: settings.phaseTimeoutMs,
        aggregatorStrategy: settings.aggregatorStrategy,
        parseRetryLimit: taskSettings.aiDecisionParseRetryLimit,
      },
      taskSettings,
    });

    const ssm = session.sessionMachine!;
    expect(ssm.config.maxRetries).toBe(7);
    expect(ssm.config.phaseTimeout).toBe(90_000);
    expect(ssm.config.aggregatorStrategy).toBe('designated');
    expect(ssm.config.parseRetryLimit).toBe(4);
  });
});
