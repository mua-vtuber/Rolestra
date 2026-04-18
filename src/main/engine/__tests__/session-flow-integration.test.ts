/**
 * Integration tests for the full session flow (Orchestrator + SSM).
 *
 * Sub-modules (TurnExecutor, ConsensusDriver, etc.) are mocked,
 * but the real Orchestrator ↔ SessionStateMachine interaction is tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PermissionAction } from '../../../shared/session-state-types';

// ── Mock instance trackers ─────────────────────────────────────────
let consensusDriverInstance: any;

vi.mock('../turn-executor', () => ({
  TurnExecutor: class {
    executeTurn = vi.fn().mockResolvedValue(undefined);
    executeSynthesisTurn = vi.fn().mockResolvedValue(undefined);
    executeWorkerTurn = vi.fn().mockResolvedValue(undefined);
    executeReviewTurn = vi.fn().mockResolvedValue(undefined);
    abort = vi.fn();
    emitDeepDebateState = vi.fn();
    getFormatInstruction = vi.fn().mockReturnValue(null);
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
    constructor() { consensusDriverInstance = this; }
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

// ── Helpers ──────────────────────────────────────────────────────────

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

function makeSession(opts?: {
  roundSetting?: number | 'unlimited';
  maxRetries?: number;
}): ConversationSession {
  return new ConversationSession({
    id: 'conv-integ',
    participants,
    roundSetting: opts?.roundSetting ?? 1,
    sessionConfig: {
      maxRetries: opts?.maxRetries ?? 1,
      phaseTimeout: 0,
    },
  });
}

/** Pre-record mode judgments so ROUND_COMPLETE → MODE_TRANSITION_PENDING. */
function recordWorkJudgments(session: ConversationSession): void {
  const ssm = session.sessionMachine!;
  ssm.recordModeJudgment({
    participantId: 'ai-1',
    participantName: 'Claude',
    judgment: 'work',
    reason: 'test',
  });
  ssm.recordModeJudgment({
    participantId: 'ai-2',
    participantName: 'Gemini',
    judgment: 'work',
    reason: 'test',
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Session flow integration', () => {
  let wc: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wc = makeWebContents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Happy path ────────────────────────────────────────────────────

  describe('happy path', () => {
    it('full flow: CONVERSATION → MODE_TRANSITION → WORK → SYNTHESIZE → VOTE → EXECUTE → REVIEW → DONE', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      expect(ssm.state).toBe('CONVERSATION');

      // Pre-record mode judgments
      recordWorkJudgments(session);

      // Skip turns — getNextSpeaker always returns null
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      // Configure mock: collectVotesForSession transitions ALL_AGREE
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('ALL_AGREE');
      });

      // ─── Phase 1: CONVERSATION → MODE_TRANSITION_PENDING ─────────
      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('MODE_TRANSITION_PENDING');

      // Verify mode-transition-request event was emitted
      const modeEvents = wc.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'stream:mode-transition-request',
      );
      expect(modeEvents.length).toBe(1);

      // ─── Phase 2: User approves → WORK_DISCUSSING → ... → CONSENSUS_APPROVED
      await orch.handleModeTransitionResponse(true);
      // Need enough time for: WORK_DISCUSSING → SYNTHESIZING (2s delay) → VOTING → CONSENSUS_APPROVED (2s delay)
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('CONSENSUS_APPROVED');

      // ─── Phase 3: User selects worker → EXECUTING → REVIEWING → USER_DECISION
      await orch.handleWorkerSelection('ai-1');
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('USER_DECISION');

      // Verify review-request event was emitted
      const reviewEvents = wc.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'stream:review-request',
      );
      expect(reviewEvents.length).toBe(1);

      // ─── Phase 4: User accepts → DONE
      await orch.handleUserDecision('accept');
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('DONE');

      // run() should complete
      await runPromise;
    });
  });

  // ── Permission side effects ───────────────────────────────────────

  describe('permission side effects', () => {
    it('emits grant_worker on CONSENSUS_APPROVED→EXECUTING and revoke_worker on EXECUTING→REVIEWING', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const permissionActions: PermissionAction[] = [];
      ssm.onPermissionAction((action) => permissionActions.push(action));

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('ALL_AGREE');
      });

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);

      // Approve mode → work
      await orch.handleModeTransitionResponse(true);
      await vi.advanceTimersByTimeAsync(10000);

      // Select worker
      await orch.handleWorkerSelection('ai-1');
      await vi.advanceTimersByTimeAsync(10000);

      // Verify grant_worker was emitted when entering EXECUTING
      expect(permissionActions).toContainEqual({ type: 'grant_worker', workerId: 'ai-1' });

      // Verify revoke_worker was emitted when entering REVIEWING
      expect(permissionActions).toContainEqual({ type: 'revoke_worker', workerId: 'ai-1' });

      // Accept → DONE
      await orch.handleUserDecision('accept');
      await vi.advanceTimersByTimeAsync(100);

      // Verify revoke_all on terminal state from work mode
      expect(permissionActions).toContainEqual({ type: 'revoke_all' });

      await runPromise;
    });
  });

  // ── Error paths ───────────────────────────────────────────────────

  describe('error paths', () => {
    it('DISAGREE with maxRetries=1 → FAILED', async () => {
      const session = makeSession({ maxRetries: 1 });
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      // collectVotesForSession triggers DISAGREE
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('DISAGREE');
      });

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);

      // Approve mode transition
      await orch.handleModeTransitionResponse(true);
      await vi.advanceTimersByTimeAsync(10000);

      // With maxRetries=1, first DISAGREE → FAILED (terminal)
      expect(ssm.state).toBe('FAILED');

      // run() should complete since FAILED is terminal
      await runPromise;
    });

    it('user rejects mode transition → transitions through CONVERSATION', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('MODE_TRANSITION_PENDING');

      // Reject mode transition — SSM goes to CONVERSATION,
      // but existing mode judgments persist so the next round
      // immediately triggers MODE_TRANSITION_PENDING again.
      await orch.handleModeTransitionResponse(false);

      // Verify the SSM visited CONVERSATION via snapshots
      const snapshots = ssm.snapshots;
      const visitedConversation = snapshots.some(
        (s) => s.state === 'CONVERSATION' && s.event === 'USER_REJECT_MODE',
      );
      expect(visitedConversation).toBe(true);

      // Stop to end the test cleanly
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);
      await runPromise;
    });

    it('user rework → re-enters EXECUTING', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('ALL_AGREE');
      });

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);

      // Drive to USER_DECISION
      await orch.handleModeTransitionResponse(true);
      await vi.advanceTimersByTimeAsync(10000);
      await orch.handleWorkerSelection('ai-1');
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('USER_DECISION');

      // Rework → back to EXECUTING
      await orch.handleUserDecision('rework');
      await vi.advanceTimersByTimeAsync(10000);

      // After rework, EXECUTING → REVIEWING → USER_DECISION again
      expect(ssm.state).toBe('USER_DECISION');

      // Now accept to finish
      await orch.handleUserDecision('accept');
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('DONE');
      await runPromise;
    });

    it('user reassign → back to CONSENSUS_APPROVED for new worker selection', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('ALL_AGREE');
      });

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);

      // Drive to USER_DECISION
      await orch.handleModeTransitionResponse(true);
      await vi.advanceTimersByTimeAsync(10000);
      await orch.handleWorkerSelection('ai-1');
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('USER_DECISION');

      // Reassign to ai-2 → CONSENSUS_APPROVED
      await orch.handleUserDecision('reassign', 'ai-2');
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('CONSENSUS_APPROVED');

      // Select new worker
      await orch.handleWorkerSelection('ai-2');
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('USER_DECISION');

      // Accept
      await orch.handleUserDecision('accept');
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('DONE');
      await runPromise;
    });

    it('user stop during USER_DECISION → DONE', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );
      consensusDriverInstance.collectVotesForSession.mockImplementation(async () => {
        ssm.transition('ALL_AGREE');
      });

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      await orch.handleModeTransitionResponse(true);
      await vi.advanceTimersByTimeAsync(10000);
      await orch.handleWorkerSelection('ai-1');
      await vi.advanceTimersByTimeAsync(10000);
      expect(ssm.state).toBe('USER_DECISION');

      // User stops
      await orch.handleUserDecision('stop');
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('DONE');
      await runPromise;
    });
  });

  // ── Stop during arena loop ─────────────────────────────────────────

  describe('stop', () => {
    it('stop() during waitForUserAction releases the arena loop', async () => {
      const session = makeSession();
      const ssm = session.sessionMachine!;
      recordWorkJudgments(session);
      vi.spyOn(session, 'getNextSpeaker').mockReturnValue(null);

      const orch = new ConversationOrchestrator(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const runPromise = orch.run();
      await vi.advanceTimersByTimeAsync(100);
      expect(ssm.state).toBe('MODE_TRANSITION_PENDING');

      // Stop while waiting for user action
      orch.stop();
      await vi.advanceTimersByTimeAsync(100);

      // run() should complete
      await runPromise;
    });
  });
});
