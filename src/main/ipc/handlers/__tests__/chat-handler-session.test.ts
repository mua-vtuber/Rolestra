/**
 * Tests for session:* IPC handlers in chat-handler.ts.
 *
 * These handlers bridge SSM user events (mode transition, worker selection,
 * user decision, status query) to the ConversationOrchestrator and Session.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Mocks --

vi.mock('../../../providers/registry', () => ({
  providerRegistry: {
    listAll: vi.fn(() => []),
  },
}));

vi.mock('../../../memory/instance', () => ({
  getMemoryFacade: vi.fn(() => null),
}));

vi.mock('../../../config/instance', async () => {
  const configTypes = await import('../../../../shared/config-types');
  return {
    getConfigService: vi.fn(() => ({
      getSettings: () => ({ ...configTypes.DEFAULT_SETTINGS }),
    })),
  };
});

vi.mock('../execution-handler', () => ({
  submitPatchForReview: vi.fn(),
  clearPendingPatches: vi.fn(),
}));

vi.mock('../workspace-handler', () => ({
  workspaceService: { getProjectFolder: vi.fn(() => null) },
}));

vi.mock('../../../database/connection', () => ({
  getDatabase: vi.fn(() => null),
}));

// Mock the orchestrator module with class-based mock (vitest 4.x requirement)
vi.mock('../../../engine/orchestrator', () => {
  class MockOrchestrator {
    handleModeTransitionResponse = vi.fn().mockResolvedValue(undefined);
    handleWorkerSelection = vi.fn().mockResolvedValue(undefined);
    handleUserDecision = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();
    stop = vi.fn();
    run = vi.fn().mockResolvedValue(undefined);
    handleUserInterjection = vi.fn();
  }
  return { ConversationOrchestrator: MockOrchestrator };
});

async function loadHandlers() {
  vi.resetModules();
  return import('../chat-handler');
}

// -- Tests --

describe('handleSessionModeTransitionRespond', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('throws when no active orchestrator', async () => {
    const mod = await loadHandlers();
    expect(() => mod.handleSessionModeTransitionRespond({ approved: true }))
      .toThrow('No active conversation.');
  });

  it('calls activeOrchestrator.handleModeTransitionResponse(approved)', async () => {
    const mod = await loadHandlers();
    // Set up session + orchestrator via a chat:send with a mock window
    mod.setMainWindow({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never);
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });

    const orch = mod.getActiveOrchestrator()!;
    expect(orch).not.toBeNull();

    mod.handleSessionModeTransitionRespond({ approved: true });
    expect(orch.handleModeTransitionResponse).toHaveBeenCalledWith(true);

    mod.handleSessionModeTransitionRespond({ approved: false });
    expect(orch.handleModeTransitionResponse).toHaveBeenCalledWith(false);
  });
});

describe('handleSessionSelectWorker', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('throws when no active orchestrator', async () => {
    const mod = await loadHandlers();
    expect(() => mod.handleSessionSelectWorker({ workerId: 'w1' }))
      .toThrow('No active conversation.');
  });

  it('calls activeOrchestrator.handleWorkerSelection(workerId)', async () => {
    const mod = await loadHandlers();
    mod.setMainWindow({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never);
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });

    const orch = mod.getActiveOrchestrator()!;
    mod.handleSessionSelectWorker({ workerId: 'worker-42' });
    expect(orch.handleWorkerSelection).toHaveBeenCalledWith('worker-42');
  });
});

describe('handleSessionUserDecision', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('throws when no active orchestrator', async () => {
    const mod = await loadHandlers();
    expect(() => mod.handleSessionUserDecision({ decision: 'accept' }))
      .toThrow('No active conversation.');
  });

  it('calls activeOrchestrator.handleUserDecision(decision, reassignWorkerId)', async () => {
    const mod = await loadHandlers();
    mod.setMainWindow({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never);
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });

    const orch = mod.getActiveOrchestrator()!;

    mod.handleSessionUserDecision({ decision: 'accept' });
    expect(orch.handleUserDecision).toHaveBeenCalledWith('accept', undefined);

    mod.handleSessionUserDecision({ decision: 'reassign', reassignWorkerId: 'w2' });
    expect(orch.handleUserDecision).toHaveBeenCalledWith('reassign', 'w2');
  });
});

describe('handleSessionStatus', () => {
  beforeEach(async () => {
    const mod = await loadHandlers();
    mod.setActiveSession(null);
    mod.setMainWindow(null);
  });

  it('returns { session: null } when no active session', async () => {
    const mod = await loadHandlers();
    const result = mod.handleSessionStatus();
    expect(result).toEqual({ session: null });
  });

  it('returns { session: null } when session has no sessionMachine', async () => {
    const mod = await loadHandlers();
    // Create a session with no SSM (0 or 1 participants -> no SSM)
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });
    const session = mod.getActiveSession()!;
    // Verify no SSM (no providers registered -> 0 AI participants -> no SSM)
    expect(session.sessionMachine).toBeNull();

    const result = mod.handleSessionStatus();
    expect(result).toEqual({ session: null });
  });

  it('returns { session: <info> } when SSM exists', async () => {
    const mod = await loadHandlers();

    // Create a mock session info
    const mockSessionInfo = {
      state: 'CONVERSATION',
      projectPath: null,
      conversationRound: 1,
      modeJudgments: [],
      workRound: 0,
      retryCount: 0,
      maxRetries: 3,
      proposal: null,
      proposalHash: null,
      votes: [],
      workerId: null,
      aggregatorId: null,
      aggregatorStrategy: 'designated',
    };

    // Create a session, then monkey-patch sessionMachine
    mod.handleChatSend({ content: 'hello', activeProviderIds: [] });
    const session = mod.getActiveSession();

    // Attach a mock sessionMachine with toInfo
    Object.defineProperty(session, 'sessionMachine', {
      get: () => ({ toInfo: () => mockSessionInfo }),
      configurable: true,
    });

    const result = mod.handleSessionStatus();
    expect(result).toEqual({ session: mockSessionInfo });
  });
});
