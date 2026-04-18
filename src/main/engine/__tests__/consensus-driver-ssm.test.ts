import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsensusDriver } from '../consensus-driver';
import type { ConversationSession } from '../conversation';
import type { SessionStateMachine } from '../session-state-machine';
import type { SessionSnapshot } from '../../../shared/session-state-types';
import type { Participant } from '../../../shared/engine-types';

// ── Mock external dependencies ────────────────────────────────

const mockProviderGet = vi.fn();

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: (...args: unknown[]) => mockProviderGet(...args),
  },
}));

vi.mock('../decision-collector', () => ({
  DecisionCollector: vi.fn().mockImplementation(function () {
    return { collect: vi.fn().mockResolvedValue({ errors: [] }) };
  }),
}));

vi.mock('../consensus-evaluator', () => ({
  ConsensusEvaluator: vi.fn().mockImplementation(function () {
    return { evaluate: vi.fn().mockReturnValue({ outcome: 'passed' }) };
  }),
}));

vi.mock('../../database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

function makeSsm(overrides?: Record<string, unknown>): SessionStateMachine {
  return {
    state: 'WORK_DISCUSSING',
    isTerminal: false,
    proposal: null,
    aggregatorId: null,
    workRound: 1,
    retryCount: 0,
    votes: [],
    snapshots: [],
    transition: vi.fn().mockReturnValue('SYNTHESIZING'),
    startPhaseTimeout: vi.fn(),
    selectAggregator: vi.fn().mockReturnValue('ai-1'),
    setProposal: vi.fn(),
    onStateChange: vi.fn().mockReturnValue(vi.fn()),
    toInfo: vi.fn().mockReturnValue({ state: 'WORK_DISCUSSING' }),
    ...overrides,
  } as unknown as SessionStateMachine;
}

function makeSession(ssm?: SessionStateMachine | null): ConversationSession {
  const sessionMachine = ssm === undefined ? makeSsm() : ssm;
  return {
    id: 'conv-1',
    sessionMachine,
    taskSettings: null,
    participants: [
      { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
      { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
      { id: 'user', displayName: 'User', isActive: true },
    ] as Participant[],
    getMessagesForProvider: vi.fn().mockReturnValue([]),
    createMessage: vi.fn(),
  } as unknown as ConversationSession;
}

function makeProvider(tokens?: string[]) {
  const tokenList = tokens ?? ['proposal text'];
  return {
    streamCompletion: vi.fn().mockImplementation(async function* () {
      for (const t of tokenList) yield t;
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('ConsensusDriver (SSM migration)', () => {
  let wc: ReturnType<typeof makeWebContents>;

  beforeEach(() => {
    vi.clearAllMocks();
    wc = makeWebContents();
  });

  // ── Core: accesses session.sessionMachine, not session.consensus ──

  describe('uses session.sessionMachine instead of session.consensus', () => {
    it('runConsensusRound accesses sessionMachine', async () => {
      const ssm = makeSsm();
      const session = makeSession(ssm);
      const provider = makeProvider();
      mockProviderGet.mockReturnValue(provider);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.runConsensusRound();

      // Should use SSM event name ROUND_COMPLETE (not CSM's ROUND_DONE)
      expect(ssm.transition).toHaveBeenCalledWith('ROUND_COMPLETE');
      expect(ssm.startPhaseTimeout).toHaveBeenCalled();
      expect(ssm.selectAggregator).toHaveBeenCalled();
    });

    it('runConsensusRound returns early when sessionMachine is null', async () => {
      const session = makeSession(null);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      // Should not throw
      await driver.runConsensusRound();
      expect(wc.send).not.toHaveBeenCalled();
    });

    it('collectVotes accesses sessionMachine and checks state === VOTING', async () => {
      const ssm = makeSsm({ state: 'VOTING' });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.collectVotes('proposal');

      // The evaluator mock returns 'passed', so ALL_AGREE should be called
      expect(ssm.transition).toHaveBeenCalledWith('ALL_AGREE');
    });

    it('collectVotes exits early when sessionMachine is null', async () => {
      const session = makeSession(null);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.collectVotes('proposal');
      expect(wc.send).not.toHaveBeenCalled();
    });

    it('collectVotes exits early when state is not VOTING', async () => {
      const ssm = makeSsm({ state: 'WORK_DISCUSSING' });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.collectVotes('proposal');
      expect(ssm.transition).not.toHaveBeenCalled();
    });

    it('emitConsensusUpdate accesses sessionMachine', () => {
      const ssm = makeSsm({
        toInfo: vi.fn().mockReturnValue({ state: 'WORK_DISCUSSING' }),
        snapshots: [],
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:session-update',
        expect.objectContaining({
          conversationId: 'conv-1',
          session: { state: 'WORK_DISCUSSING' },
        }),
      );
    });

    it('emitConsensusUpdate does nothing when sessionMachine is null', () => {
      const session = makeSession(null);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();
      expect(wc.send).not.toHaveBeenCalled();
    });
  });

  // ── SSM state/event name mappings ──

  describe('SSM state and event name mappings', () => {
    it('runConsensusRound uses ROUND_COMPLETE event (not ROUND_DONE)', async () => {
      const ssm = makeSsm();
      const session = makeSession(ssm);
      mockProviderGet.mockReturnValue(makeProvider());

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.runConsensusRound();

      expect(ssm.transition).toHaveBeenCalledWith('ROUND_COMPLETE');
    });

    it('generateConsensusDocument checks state === DONE (not phase === DONE)', async () => {
      const ssm = makeSsm({
        state: 'DONE',
        aggregatorId: 'ai-1',
        votes: [
          { participantId: 'ai-1', participantName: 'Claude', vote: 'agree', comment: 'ok' },
        ],
        proposal: 'the proposal',
        workRound: 2,
        retryCount: 1,
      });
      const session = makeSession(ssm);
      mockProviderGet.mockReturnValue(makeProvider(['summary document']));

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.generateConsensusDocument();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:consensus-document',
        expect.objectContaining({
          document: 'summary document',
        }),
      );
    });

    it('generateConsensusDocument returns early when state is not DONE', async () => {
      const ssm = makeSsm({ state: 'WORK_DISCUSSING' });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.generateConsensusDocument();

      expect(mockProviderGet).not.toHaveBeenCalled();
    });

    it('generateConsensusDocument uses ssm.workRound and ssm.retryCount', async () => {
      const ssm = makeSsm({
        state: 'DONE',
        aggregatorId: 'ai-1',
        votes: [],
        proposal: 'proposal text',
        workRound: 5,
        retryCount: 2,
      });
      const session = makeSession(ssm);

      let capturedPrompt = '';
      mockProviderGet.mockReturnValue({
        streamCompletion: vi.fn().mockImplementation(
          async function* (msgs: Array<{ content: string }>) {
            capturedPrompt = msgs[0].content;
            yield 'doc';
          },
        ),
      });

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      await driver.generateConsensusDocument();

      expect(capturedPrompt).toContain('Round: 5');
      expect(capturedPrompt).toContain('Retries: 2');
    });
  });

  // ── waitForConsensusTermination ──

  describe('waitForConsensusTermination', () => {
    it('resolves immediately when sessionMachine is null', async () => {
      const session = makeSession(null);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const onApplying = vi.fn().mockResolvedValue(undefined);
      const onReenterLoop = vi.fn().mockResolvedValue(undefined);

      await driver.waitForConsensusTermination(onApplying, onReenterLoop);
      expect(onApplying).not.toHaveBeenCalled();
      expect(onReenterLoop).not.toHaveBeenCalled();
    });

    it('resolves immediately when SSM is already terminal', async () => {
      const ssm = makeSsm({ isTerminal: true });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const onApplying = vi.fn().mockResolvedValue(undefined);
      const onReenterLoop = vi.fn().mockResolvedValue(undefined);

      await driver.waitForConsensusTermination(onApplying, onReenterLoop);
      expect(onApplying).not.toHaveBeenCalled();
      expect(onReenterLoop).not.toHaveBeenCalled();
    });

    it('uses onStateChange (not onPhaseChange) to listen for SSM transitions', async () => {
      let stateChangeCallback: ((snapshot: Partial<SessionSnapshot>) => void) | null = null;
      const ssm = makeSsm({
        isTerminal: false,
        onStateChange: vi.fn().mockImplementation((cb: (snapshot: Partial<SessionSnapshot>) => void) => {
          stateChangeCallback = cb;
          return vi.fn();
        }),
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const waitPromise = driver.waitForConsensusTermination(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
      );

      expect(driver.isWaiting()).toBe(true);
      expect(ssm.onStateChange).toHaveBeenCalled();

      // Resolve via terminal
      Object.defineProperty(ssm, 'isTerminal', { get: () => true });
      stateChangeCallback!({ state: 'FAILED', event: 'ERROR' });

      await waitPromise;
    });

    it('calls onApplying when SSM reaches EXECUTING state (not APPLYING)', async () => {
      let stateChangeCallback: ((snapshot: Partial<SessionSnapshot>) => void) | null = null;
      const ssm = makeSsm({
        isTerminal: false,
        onStateChange: vi.fn().mockImplementation((cb: (snapshot: Partial<SessionSnapshot>) => void) => {
          stateChangeCallback = cb;
          return vi.fn();
        }),
      });
      const session = makeSession(ssm);
      const onApplying = vi.fn().mockResolvedValue(undefined);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const waitPromise = driver.waitForConsensusTermination(
        onApplying,
        vi.fn().mockResolvedValue(undefined),
      );

      // Fire EXECUTING state (SSM equivalent of CSM's APPLYING)
      stateChangeCallback!({ state: 'EXECUTING', event: 'USER_SELECT_WORKER' });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(onApplying).toHaveBeenCalled();

      // Resolve
      Object.defineProperty(ssm, 'isTerminal', { get: () => true });
      stateChangeCallback!({ state: 'FAILED', event: 'ERROR' });

      await waitPromise;
    });

    it('calls onReenterLoop when SSM reaches WORK_DISCUSSING via DISAGREE', async () => {
      let stateChangeCallback: ((snapshot: Partial<SessionSnapshot>) => void) | null = null;
      const ssm = makeSsm({
        isTerminal: false,
        onStateChange: vi.fn().mockImplementation((cb: (snapshot: Partial<SessionSnapshot>) => void) => {
          stateChangeCallback = cb;
          return vi.fn();
        }),
      });
      const session = makeSession(ssm);
      const onReenterLoop = vi.fn().mockResolvedValue(undefined);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const waitPromise = driver.waitForConsensusTermination(
        vi.fn().mockResolvedValue(undefined),
        onReenterLoop,
      );

      // Fire WORK_DISCUSSING + DISAGREE (SSM equivalent of CSM's DISCUSSING + DISAGREE)
      stateChangeCallback!({ state: 'WORK_DISCUSSING', event: 'DISAGREE' });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(onReenterLoop).toHaveBeenCalled();

      // Resolve
      Object.defineProperty(ssm, 'isTerminal', { get: () => true });
      stateChangeCallback!({ state: 'FAILED', event: 'ERROR' });

      await waitPromise;
    });

    it('generates consensus document on DONE state', async () => {
      let stateChangeCallback: ((snapshot: Partial<SessionSnapshot>) => void) | null = null;
      const ssm = makeSsm({
        isTerminal: false,
        state: 'WORK_DISCUSSING',
        aggregatorId: 'ai-1',
        proposal: 'final proposal',
        votes: [],
        workRound: 1,
        retryCount: 0,
        onStateChange: vi.fn().mockImplementation((cb: (snapshot: Partial<SessionSnapshot>) => void) => {
          stateChangeCallback = cb;
          return vi.fn();
        }),
      });
      const session = makeSession(ssm);
      mockProviderGet.mockReturnValue(makeProvider(['doc']));

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      const waitPromise = driver.waitForConsensusTermination(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
      );

      // Simulate reaching DONE
      Object.defineProperty(ssm, 'isTerminal', { get: () => true });
      Object.defineProperty(ssm, 'state', { get: () => 'DONE' });
      stateChangeCallback!({ state: 'DONE', event: 'USER_ACCEPT' });

      await waitPromise;
      // generateConsensusDocument should have been called
    });
  });

  // ── Failure stage derivation ──

  describe('emitConsensusUpdate failure report', () => {
    it('emits failure-report with stage EXECUTE when previousState is EXECUTING', () => {
      const failSnapshot: Partial<SessionSnapshot> = {
        state: 'FAILED',
        previousState: 'EXECUTING',
        event: 'ERROR',
      };
      const ssm = makeSsm({
        state: 'FAILED',
        toInfo: vi.fn().mockReturnValue({ state: 'FAILED' }),
        snapshots: [failSnapshot as SessionSnapshot],
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:failure-report',
        expect.objectContaining({
          stage: 'EXECUTE',
          reason: 'Execution step failed',
        }),
      );
    });

    it('emits failure-report with stage REVIEW when previousState is REVIEWING', () => {
      const failSnapshot: Partial<SessionSnapshot> = {
        state: 'FAILED',
        previousState: 'REVIEWING',
        event: 'ERROR',
      };
      const ssm = makeSsm({
        state: 'FAILED',
        toInfo: vi.fn().mockReturnValue({ state: 'FAILED' }),
        snapshots: [failSnapshot as SessionSnapshot],
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();

      expect(wc.send).toHaveBeenCalledWith(
        'stream:failure-report',
        expect.objectContaining({
          stage: 'REVIEW',
          reason: 'Review step failed',
        }),
      );
    });

    it('does not emit failure-report when state is FAILED but previousState is neither EXECUTING nor REVIEWING', () => {
      const failSnapshot: Partial<SessionSnapshot> = {
        state: 'FAILED',
        previousState: 'VOTING',
        event: 'TIMEOUT',
      };
      const ssm = makeSsm({
        state: 'FAILED',
        toInfo: vi.fn().mockReturnValue({ state: 'FAILED' }),
        snapshots: [failSnapshot as SessionSnapshot],
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();

      // Should emit session-update but NOT failure-report
      expect(wc.send).toHaveBeenCalledWith('stream:session-update', expect.anything());
      expect(wc.send).not.toHaveBeenCalledWith('stream:failure-report', expect.anything());
    });

    it('does not emit failure-report when state is not FAILED', () => {
      const ssm = makeSsm({
        state: 'WORK_DISCUSSING',
        toInfo: vi.fn().mockReturnValue({ state: 'WORK_DISCUSSING' }),
        snapshots: [],
      });
      const session = makeSession(ssm);

      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.emitConsensusUpdate();

      expect(wc.send).toHaveBeenCalledWith('stream:session-update', expect.anything());
      expect(wc.send).not.toHaveBeenCalledWith('stream:failure-report', expect.anything());
    });
  });

  // ── Waiter management ──

  describe('releaseWaiter / isWaiting / cleanupPhaseListener', () => {
    it('isWaiting returns false initially', () => {
      const session = makeSession();
      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      expect(driver.isWaiting()).toBe(false);
    });

    it('releaseWaiter is safe to call when not waiting', () => {
      const session = makeSession();
      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.releaseWaiter();
      expect(driver.isWaiting()).toBe(false);
    });

    it('cleanupPhaseListener is safe to call when no listener is registered', () => {
      const session = makeSession();
      const driver = new ConsensusDriver(
        session,
        wc as unknown as import('electron').WebContents,
      );

      driver.cleanupPhaseListener();
    });
  });
});
