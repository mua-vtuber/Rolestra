import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock session and orchestrator
let mockSession: {
  sessionMachine: { state: string; toInfo: () => unknown } | null;
} | null = null;
let mockOrchestrator: {
  handleUserDecision: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock('../chat-handler', () => ({
  getActiveSession: vi.fn(() => mockSession),
  getActiveOrchestrator: vi.fn(() => mockOrchestrator),
}));

import {
  handleConsensusRespond,
  handleConsensusStatus,
  handleConsensusSetFacilitator,
} from '../consensus-handler';

describe('consensus-handler (SSM mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockOrchestrator = null;
  });

  describe('handleConsensusRespond', () => {
    it('no active session — throws error', async () => {
      mockSession = null;

      await expect(handleConsensusRespond({ decision: 'AGREE' })).rejects.toThrow(
        'No active conversation session',
      );
    });

    it('ABORT — routes to orchestrator stop', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({ decision: 'ABORT' });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('stop');
    });

    it('failureResolution retry — routes to orchestrator rework', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({
        decision: 'AGREE',
        failureResolution: 'retry',
      });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('rework', undefined);
    });

    it('failureResolution reassign — routes to orchestrator reassign', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({
        decision: 'AGREE',
        failureResolution: 'reassign',
        reassignFacilitatorId: 'ai-2',
      });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('reassign', 'ai-2');
    });

    it('failureResolution stop — routes to orchestrator stop', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({
        decision: 'AGREE',
        failureResolution: 'stop',
      });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('stop', undefined);
    });

    it('AGREE in USER_DECISION state — routes to orchestrator accept', async () => {
      mockSession = {
        sessionMachine: { state: 'USER_DECISION', toInfo: vi.fn() },
      };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({ decision: 'AGREE' });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('accept');
    });

    it('DISAGREE in USER_DECISION state — routes to orchestrator rework', async () => {
      mockSession = {
        sessionMachine: { state: 'USER_DECISION', toInfo: vi.fn() },
      };
      mockOrchestrator = { handleUserDecision: vi.fn() };

      await handleConsensusRespond({ decision: 'DISAGREE' });

      expect(mockOrchestrator.handleUserDecision).toHaveBeenCalledWith('rework');
    });

    it('AGREE without SSM or orchestrator — no-op', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = null;

      // Should not throw
      await handleConsensusRespond({ decision: 'AGREE' });
    });

    it('failureResolution without orchestrator — throws', async () => {
      mockSession = { sessionMachine: null };
      mockOrchestrator = null;

      await expect(
        handleConsensusRespond({ decision: 'AGREE', failureResolution: 'retry' }),
      ).rejects.toThrow('No active orchestrator');
    });
  });

  describe('handleConsensusStatus', () => {
    it('returns null when no active session', async () => {
      mockSession = null;

      const result = await handleConsensusStatus();

      expect(result.consensus).toBeNull();
    });

    it('returns null when session has no SSM', async () => {
      mockSession = { sessionMachine: null };

      const result = await handleConsensusStatus();

      expect(result.consensus).toBeNull();
    });

    it('returns SSM info mapped to ConsensusInfo when SSM exists', async () => {
      mockSession = {
        sessionMachine: {
          state: 'VOTING',
          toInfo: vi.fn(() => ({
            state: 'VOTING',
            proposalHash: 'abc123',
            retryCount: 1,
            maxRetries: 3,
            aggregatorStrategy: 'designated',
            aggregatorId: 'ai-1',
            votes: [],
          })),
        },
      };
      // Session also needs an id
      Object.defineProperty(mockSession, 'id', { value: 'conv-1' });

      const result = await handleConsensusStatus();

      expect(result.consensus).not.toBeNull();
      expect(result.consensus!.phase).toBe('VOTING');
      expect(result.consensus!.proposalHash).toBe('abc123');
    });
  });

  describe('handleConsensusSetFacilitator', () => {
    it('no active session — throws error', async () => {
      mockSession = null;

      await expect(
        handleConsensusSetFacilitator({ facilitatorId: 'ai-1' }),
      ).rejects.toThrow('No active conversation session');
    });

    it('returns success gracefully when SSM mode', async () => {
      mockSession = { sessionMachine: null };

      const result = await handleConsensusSetFacilitator({ facilitatorId: 'ai-2' });

      expect(result.success).toBe(true);
    });
  });
});
