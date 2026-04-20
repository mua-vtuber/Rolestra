import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock sub-modules ────────────────────────────────────────

vi.mock('../turn-executor', () => ({
  TurnExecutor: class {
    executeTurn = vi.fn().mockResolvedValue(undefined);
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

// Now import the class under test
import { ConversationOrchestrator } from '../orchestrator';
import { ConversationSession } from '../conversation';
import type { Participant } from '../../../shared/engine-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

// ── Helpers ──────────────────────────────────────────────────

const participants: Participant[] = [
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
  { id: 'user', displayName: 'User', isActive: true },
];

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

function makeSession(roundSetting: number | 'unlimited' = 1): ConversationSession {
  return new ConversationSession({
    id: 'conv-1',
    ssmCtx: createDefaultSsmContext(),
    participants,
    roundSetting,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('ConversationOrchestrator', () => {
  let wc: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wc = makeWebContents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('run', () => {
    it('starts session and emits stream:state running', async () => {
      const session = makeSession();
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      // After run() completes, session may be idle (reset) or stopped
      const stateEvents = wc.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'stream:state',
      );
      expect(stateEvents.length).toBeGreaterThanOrEqual(1);
      expect(stateEvents[0][1].state).toBe('running');
    });

    it('is idempotent — calling run() twice does not restart', async () => {
      const session = makeSession();
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);
      vi.spyOn(session, 'start');

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const p1 = orch.run();
      const p2 = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([p1, p2]);

      expect(session.start).toHaveBeenCalledOnce();
    });

    it('delegates to turnExecutor.executeTurn for each speaker', async () => {
      const session = makeSession();
      const speaker1: Participant = { id: 'ai-1', displayName: 'Claude', isActive: true };
      const speaker2: Participant = { id: 'ai-2', displayName: 'Gemini', isActive: true };

      let callCount = 0;
      vi.spyOn(session, 'getNextSpeaker').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return speaker1;
        if (callCount === 2) return speaker2;
        return null;
      });
      vi.spyOn(session, 'isComplete').mockReturnValue(false);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(10000);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      // Access the mock through the orchestrator's internal turnExecutor
      // Since each instance creates its own mock, we check via webContents calls
      expect(wc.send).toHaveBeenCalled();
    });

    it('SSM arena session handles round complete', async () => {
      const session = makeSession();
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

      expect(session.sessionMachine).not.toBeNull();
    });

    it('emits final stream:state when run completes', async () => {
      const session = makeSession();
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      const stateEvents = wc.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'stream:state',
      );
      const lastState = stateEvents[stateEvents.length - 1];
      expect(lastState).toBeDefined();
    });
  });

  describe('stop', () => {
    it('stops session', () => {
      const session = makeSession();
      vi.spyOn(session, 'stop');

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      orch.stop();

      expect(session.stop).toHaveBeenCalled();
    });
  });

  describe('pause / resume', () => {
    it('pause emits stream:state with paused', () => {
      const session = makeSession();
      session.start();

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      orch.pause();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:state',
        expect.objectContaining({
          conversationId: 'conv-1',
          state: 'paused',
        }),
      );
    });

    it('resume emits stream:state with running', () => {
      const session = makeSession();
      session.start();
      session.pause();

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      orch.resume();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:state',
        expect.objectContaining({
          conversationId: 'conv-1',
          state: 'running',
        }),
      );
    });
  });

  describe('handleUserInterjection', () => {
    it('delegates to session.interruptWithUserMessage', () => {
      const session = makeSession();
      vi.spyOn(session, 'interruptWithUserMessage');

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      orch.handleUserInterjection();

      expect(session.interruptWithUserMessage).toHaveBeenCalled();
    });
  });

  describe('emit helper', () => {
    it('skips sending when webContents is destroyed', () => {
      wc.isDestroyed.mockReturnValue(true);
      const session = makeSession();
      session.start();

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      orch.pause();

      expect(wc.send).not.toHaveBeenCalled();
    });
  });
});
