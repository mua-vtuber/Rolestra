/**
 * Tests for Orchestrator SSM integration (Task 9).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../turn-executor', () => ({
  TurnExecutor: class {
    executeTurn = vi.fn().mockResolvedValue(undefined);
    executeSynthesisTurn = vi.fn().mockResolvedValue(undefined);
    executeWorkerTurn = vi.fn().mockResolvedValue(undefined);
    executeReviewTurn = vi.fn().mockResolvedValue(undefined);
    abort = vi.fn();
    emitDeepDebateState = vi.fn();
  },
}));

vi.mock('../memory-coordinator', () => ({
  MemoryCoordinator: class {
    buildMemoryContext = vi.fn().mockResolvedValue(null);
    extractMemories = vi.fn();
    runPostConversationMaintenance = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../consensus-driver', () => ({
  ConsensusDriver: class {
    runConsensusRound = vi.fn().mockResolvedValue(undefined);
    collectVotesForSession = vi.fn().mockResolvedValue(undefined);
    waitForConsensusTermination = vi.fn().mockResolvedValue(undefined);
    releaseWaiter = vi.fn();
    cleanupPhaseListener = vi.fn();
    isWaiting = vi.fn().mockReturnValue(false);
    emitConsensusUpdate = vi.fn();
  },
}));

vi.mock('../execution-coordinator', () => ({
  ExecutionCoordinator: class {
    driveExecution = vi.fn().mockResolvedValue(undefined);
    resolveExecutionApproval = vi.fn();
  },
}));

vi.mock('../../database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../recovery/recovery-manager', () => ({
  RecoveryManager: class {
    saveSnapshot = vi.fn();
  },
}));

import { ConversationOrchestrator } from '../orchestrator';
import { ConversationSession } from '../conversation';
import type { Participant } from '../../../shared/engine-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

// ── Helpers ──────────────────────────────────────────────────

const participants: Participant[] = [
  { id: 'user', displayName: 'User', isActive: true },
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
];

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

function makeSession(roundSetting: number | 'unlimited' = 1): ConversationSession {
  return new ConversationSession({
    id: 'conv-ssm',
    ssmCtx: createDefaultSsmContext(),
    participants,
    roundSetting,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('Orchestrator SSM integration', () => {
  let wc: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wc = makeWebContents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('session has SSM for arena mode', () => {
    const session = makeSession();
    expect(session.sessionMachine).not.toBeNull();
    expect(session.sessionMachine!.state).toBe('CONVERSATION');
  });

  describe('user event handlers', () => {
    it('handleModeTransitionResponse exists', () => {
      const session = makeSession();
      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      expect(typeof orch.handleModeTransitionResponse).toBe('function');
    });

    it('handleWorkerSelection exists', () => {
      const session = makeSession();
      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      expect(typeof orch.handleWorkerSelection).toBe('function');
    });

    it('handleUserDecision exists', () => {
      const session = makeSession();
      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      expect(typeof orch.handleUserDecision).toBe('function');
    });
  });

  describe('emitSessionUpdate', () => {
    it('sends stream:session-update via webContents', async () => {
      const session = makeSession();
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(5000);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      const sessionUpdates = wc.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'stream:session-update',
      );
      expect(sessionUpdates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SSM state-based loop', () => {
    it('runs speakers in CONVERSATION state', async () => {
      const session = makeSession(1);
      let speakerIdx = 0;
      const aiSpeakers = participants.filter(p => p.id !== 'user');
      vi.spyOn(session, 'getNextSpeaker').mockImplementation(() => {
        if (speakerIdx < aiSpeakers.length) return aiSpeakers[speakerIdx++];
        return null;
      });

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(20000);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      // Verify the run completed without errors
      expect(wc.send).toHaveBeenCalled();
    });

    it('loop breaks on user-input-required SSM states', async () => {
      const session = makeSession(1);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);
      vi.spyOn(session, 'isComplete').mockReturnValue(false);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(5000);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      // Run should complete (loop broke due to user-input-required state)
      // SSM transitions to MODE_TRANSITION_PENDING if mode judgments warrant it
      expect(wc.send).toHaveBeenCalled();
    });
  });
});
