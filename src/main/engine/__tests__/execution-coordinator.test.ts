import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionCoordinator, type OrchestratorDeps } from '../execution-coordinator';
import type { ConversationSession } from '../conversation';
import type { ConsensusDriver } from '../consensus-driver';
import type { ConsensusStateMachine } from '../consensus-machine';

// ── Helpers ──────────────────────────────────────────────────

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

function makeCsm(overrides?: Record<string, unknown>): ConsensusStateMachine {
  return {
    phase: 'APPLYING',
    proposal: 'test proposal',
    aggregatorId: 'ai-1',
    transition: vi.fn().mockReturnValue('REVIEWING'),
    ...overrides,
  } as unknown as ConsensusStateMachine;
}

function makeSession(csm?: ConsensusStateMachine): ConversationSession {
  return {
    id: 'conv-1',
    consensus: csm ?? makeCsm(),
  } as unknown as ConversationSession;
}

function makeConsensusDriver(): ConsensusDriver {
  return {
    emitConsensusUpdate: vi.fn(),
  } as unknown as ConsensusDriver;
}

// ── Tests ────────────────────────────────────────────────────

describe('ExecutionCoordinator', () => {
  let wc: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    vi.clearAllMocks();
    wc = makeWebContents();
  });

  describe('driveExecution', () => {
    it('returns early when CSM is null', async () => {
      const session = { id: 'conv-1', consensus: null } as unknown as ConversationSession;
      const consensusDriver = makeConsensusDriver();

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        {},
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(consensusDriver.emitConsensusUpdate).not.toHaveBeenCalled();
    });

    it('returns early when CSM phase is not APPLYING', async () => {
      const csm = makeCsm({ phase: 'DISCUSSING' });
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        {},
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(csm.transition).not.toHaveBeenCalled();
    });

    it('auto-succeeds when no execution deps are provided', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        {},
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
      expect(consensusDriver.emitConsensusUpdate).toHaveBeenCalled();
    });

    it('auto-succeeds and transitions to DONE via REVIEWING', async () => {
      const csm = makeCsm({
        transition: vi.fn().mockImplementation((event: string) => {
          if (event === 'APPLY_SUCCESS') return 'REVIEWING';
          if (event === 'REVIEW_SUCCESS') return 'DONE';
          return null;
        }),
      });
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        {},
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
      expect(csm.transition).toHaveBeenCalledWith('REVIEW_SUCCESS');
      // emitConsensusUpdate called twice: after APPLY_SUCCESS and REVIEW_SUCCESS
      expect(consensusDriver.emitConsensusUpdate).toHaveBeenCalledTimes(2);
    });

    it('extracts patch and submits for review when deps provided', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const patchSet = { entries: [{ path: 'test.ts', content: 'new' }] };
      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue(patchSet),
        submitPatchForReview: vi.fn().mockReturnValue({
          operationId: 'op-1',
          diffs: [],
        }),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      // Start driveExecution and resolve approval in parallel
      const drivePromise = coordinator.driveExecution();

      // Wait for the approval promise to be set up
      await new Promise(resolve => setTimeout(resolve, 10));

      coordinator.resolveExecutionApproval(true);
      await drivePromise;

      expect(deps.extractPatchSet).toHaveBeenCalledWith('test proposal', 'ai-1', 'conv-1');
      expect(deps.submitPatchForReview).toHaveBeenCalledWith(patchSet, 'conv-1');
      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
    });

    it('transitions to APPLY_FAILED when user rejects', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue({
          entries: [{ path: 'test.ts', content: 'new' }],
        }),
        submitPatchForReview: vi.fn().mockReturnValue({
          operationId: 'op-1',
          diffs: [],
        }),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      const drivePromise = coordinator.driveExecution();
      await new Promise(resolve => setTimeout(resolve, 10));

      coordinator.resolveExecutionApproval(false);
      await drivePromise;

      expect(csm.transition).toHaveBeenCalledWith('APPLY_FAILED');
      expect(consensusDriver.emitConsensusUpdate).toHaveBeenCalled();
      expect(wc.send).toHaveBeenCalledWith(
        'stream:failure-report',
        expect.objectContaining({
          stage: 'EXECUTE',
          reason: expect.stringContaining('rejected'),
        }),
      );
    });

    it('auto-succeeds when extractPatchSet returns null', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue(null),
        submitPatchForReview: vi.fn(),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(deps.submitPatchForReview).not.toHaveBeenCalled();
      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
    });

    it('auto-succeeds when patchSet has no entries', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue({ entries: [] }),
        submitPatchForReview: vi.fn(),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      await coordinator.driveExecution();

      expect(deps.submitPatchForReview).not.toHaveBeenCalled();
      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
    });
  });

  describe('resolveExecutionApproval', () => {
    it('resolves pending approval promise', async () => {
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue({
          entries: [{ path: 'a.ts', content: 'x' }],
        }),
        submitPatchForReview: vi.fn().mockReturnValue({
          operationId: 'op-1',
          diffs: [],
        }),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      const drivePromise = coordinator.driveExecution();
      await new Promise(resolve => setTimeout(resolve, 10));

      coordinator.resolveExecutionApproval(true);
      await drivePromise;

      // Verify it completed successfully (did not reject)
      expect(csm.transition).toHaveBeenCalledWith('APPLY_SUCCESS');
    });

    it('is safe to call when no approval is pending', () => {
      const session = makeSession();
      const consensusDriver = makeConsensusDriver();

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        {},
        consensusDriver,
      );

      // Should not throw
      coordinator.resolveExecutionApproval(true);
      coordinator.resolveExecutionApproval(false);
    });
  });

  describe('emit (via webContents)', () => {
    it('skips sending when webContents is destroyed', async () => {
      wc.isDestroyed.mockReturnValue(true);
      const csm = makeCsm();
      const session = makeSession(csm);
      const consensusDriver = makeConsensusDriver();

      const deps: OrchestratorDeps = {
        extractPatchSet: vi.fn().mockResolvedValue({
          entries: [{ path: 'a.ts', content: 'x' }],
        }),
        submitPatchForReview: vi.fn().mockReturnValue({
          operationId: 'op-1',
          diffs: [],
        }),
      };

      const coordinator = new ExecutionCoordinator(
        session,
        wc as unknown as import('electron').WebContents,
        deps,
        consensusDriver,
      );

      const drivePromise = coordinator.driveExecution();
      await new Promise(resolve => setTimeout(resolve, 10));
      coordinator.resolveExecutionApproval(false);
      await drivePromise;

      // webContents.send should not have been called since it's destroyed
      expect(wc.send).not.toHaveBeenCalled();
    });
  });
});
