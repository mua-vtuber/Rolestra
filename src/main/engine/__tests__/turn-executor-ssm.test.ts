/**
 * Tests for TurnExecutor SSM integration (Task 10 + Task 11).
 *
 * Verifies that when a session has an SSM, the TurnExecutor:
 * 1. Injects format instructions as system message
 * 2. Parses structured output and records mode judgments
 * 3. Provides getFormatInstruction() per SSM state
 * 4. Provides executeSynthesisTurn/executeWorkerTurn/executeReviewTurn aliases
 * 5. Injects SSM permission prompts into persona for CLI providers (Task 11)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnExecutor } from '../turn-executor';

// -- Mock external dependencies (needed for executeTurn tests in Task 11) --

const mockProviderGet = vi.fn();

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: (...args: unknown[]) => mockProviderGet(...args),
  },
}));

vi.mock('../persona-builder', () => ({
  buildEffectivePersona: vi.fn().mockReturnValue('base persona'),
}));

vi.mock('../../ipc/handlers/workspace-handler', () => ({
  permissionService: {
    getPermissionsForParticipant: vi.fn().mockReturnValue(null),
  },
  workspaceService: {
    getProjectFolder: vi.fn().mockReturnValue('/test/project'),
    getArenaFolder: vi.fn().mockReturnValue(null),
  },
  consensusFolderService: {
    getFolderPath: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../database/conversation-repository', () => ({
  ConversationRepository: class MockConversationRepository {
    insertMessage = vi.fn();
    touchTimestamp = vi.fn();
  },
}));

describe('TurnExecutor SSM integration', () => {
  describe('getFormatInstruction', () => {
    let executor: TurnExecutor;

    beforeEach(() => {
      const mockSession = {
        id: 'test-conv',
        sessionMachine: null,
        state: 'running',
        getMessagesForProvider: vi.fn().mockReturnValue([]),
        createMessage: vi.fn().mockReturnValue({ id: 'msg-1' }),
        deepDebateActive: false,
        participants: [
          { id: 'user', displayName: 'User', isActive: true },
          { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'ai-1' },
          { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'ai-2' },
        ],
      };
      const mockWebContents = {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };
      const mockMemoryCoordinator = {
        buildMemoryContext: vi.fn().mockResolvedValue(null),
        extractMemories: vi.fn(),
      };

      executor = new TurnExecutor(
        mockSession as any,
        mockWebContents as any,
        mockMemoryCoordinator as any,
        new Set(),
      );
    });

    it('returns conversation format instruction for CONVERSATION state', () => {
      const result = executor.getFormatInstruction('CONVERSATION', 'Claude', ['Gemini']);
      expect(result).toContain('mode_judgment');
      expect(result).toContain('Claude');
    });

    it('returns work discussion format instruction for WORK_DISCUSSING state', () => {
      const result = executor.getFormatInstruction('WORK_DISCUSSING', 'Claude', ['Gemini']);
      expect(result).toContain('opinion');
      expect(result).toContain('reasoning');
      expect(result).toContain('agreements');
    });

    it('returns review format instruction for REVIEWING state', () => {
      const result = executor.getFormatInstruction('REVIEWING', 'Claude', ['Gemini']);
      expect(result).toContain('review_result');
      expect(result).toContain('issues');
    });

    it('returns execution format instruction for EXECUTING state', () => {
      const result = executor.getFormatInstruction('EXECUTING', 'Claude', []);
      expect(result).not.toBeNull();
      expect(result).toContain('Claude');
    });

    it('returns null for non-format states (VOTING, SYNTHESIZING, DONE)', () => {
      expect(executor.getFormatInstruction('VOTING', 'Claude', [])).toBeNull();
      expect(executor.getFormatInstruction('SYNTHESIZING', 'Claude', [])).toBeNull();
      expect(executor.getFormatInstruction('DONE', 'Claude', [])).toBeNull();
    });
  });

  describe('convertToolsToDefinitions', () => {
    let executor: TurnExecutor;

    beforeEach(() => {
      const mockSession = {
        id: 'test-conv',
        sessionMachine: null,
        state: 'running',
      };
      const mockWebContents = {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };
      const mockMemoryCoordinator = {
        buildMemoryContext: vi.fn().mockResolvedValue(null),
        extractMemories: vi.fn(),
      };

      executor = new TurnExecutor(
        mockSession as any,
        mockWebContents as any,
        mockMemoryCoordinator as any,
        new Set(),
      );
    });

    it('converts AppTool[] to ToolDefinition[]', () => {
      const appTools = [
        { name: 'file_read', description: 'Read file contents' },
        { name: 'web_search', description: 'Search the web' },
      ];
      const result = executor.convertToolsToDefinitions(appTools);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'file_read',
        description: 'Read file contents',
        parameters: {},
      });
      expect(result[1]).toEqual({
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      });
    });

    it('returns empty array for empty input', () => {
      expect(executor.convertToolsToDefinitions([])).toEqual([]);
    });
  });

  describe('special turn aliases', () => {
    it('executeSynthesisTurn exists as a method', () => {
      const mockSession = { id: 'test', sessionMachine: null, state: 'running' };
      const mockWebContents = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) };
      const mockMem = { buildMemoryContext: vi.fn(), extractMemories: vi.fn() };
      const executor = new TurnExecutor(
        mockSession as any,
        mockWebContents as any,
        mockMem as any,
        new Set(),
      );
      expect(typeof executor.executeSynthesisTurn).toBe('function');
      expect(typeof executor.executeWorkerTurn).toBe('function');
      expect(typeof executor.executeReviewTurn).toBe('function');
    });
  });

  // -- Task 11: SSM permission prompt injection --

  describe('permission prompt injection', () => {
    let capturedPersona: string | undefined;

    function makeWebContents() {
      return {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };
    }

    function makeSession(ssmOverrides?: Record<string, unknown>) {
      const ssm = ssmOverrides
        ? {
            workerId: ssmOverrides.workerId ?? null,
            state: ssmOverrides.state ?? 'CONVERSATION',
            recordModeJudgment: vi.fn(),
            ...ssmOverrides,
          }
        : null;

      return {
        id: 'conv-1',
        state: 'running',
        messages: [],
        getMessagesForProvider: vi.fn().mockReturnValue([]),
        createMessage: vi.fn().mockReturnValue({ branchId: 'main', parentMessageId: null }),
        deepDebateActive: false,
        deepDebateTurnsUsed: 0,
        deepDebateTurnBudget: 30,
        deepDebateTurnsRemaining: 0,
        recordDeepDebateTurn: vi.fn(),
        isDeepDebateBudgetExhausted: vi.fn().mockReturnValue(false),
        stopDeepDebate: vi.fn(),
        setRoundSetting: vi.fn(),
        turnManager: { currentRound: 1 },
        sessionMachine: ssm,
        participants: [
          { id: 'user', displayName: 'User', isActive: true },
          { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'ai-1' },
          { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'ai-2' },
        ],
      };
    }

    function makeMemoryCoordinator() {
      return {
        buildMemoryContext: vi.fn().mockResolvedValue(null),
        extractMemories: vi.fn(),
      };
    }

    function makeSpeaker(id = 'ai-1', displayName = 'Claude') {
      return { id, displayName, isActive: true, providerId: id };
    }

    function makeCliProvider(permissionAdapter?: Record<string, unknown> | null) {
      capturedPersona = undefined;
      return {
        type: 'cli',
        config: { type: 'cli', command: 'claude' },
        streamCompletion: vi.fn().mockImplementation(async function* (_msgs: unknown, persona: string) {
          capturedPersona = persona;
          yield 'response';
        }),
        consumeLastTokenUsage: vi.fn().mockReturnValue(null),
        getPermissionAdapter: vi.fn().mockReturnValue(permissionAdapter ?? null),
      };
    }

    function makeApiProvider() {
      capturedPersona = undefined;
      return {
        type: 'api',
        config: { type: 'api' },
        streamCompletion: vi.fn().mockImplementation(async function* (_msgs: unknown, persona: string) {
          capturedPersona = persona;
          yield 'response';
        }),
        consumeLastTokenUsage: vi.fn().mockReturnValue(null),
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();
      capturedPersona = undefined;
    });

    it('prepends worker prompt via adapter for CLI provider when speaker is worker in EXECUTING state', async () => {
      const adapter = {
        getWorkerSystemPrompt: vi.fn().mockReturnValue('작업자로 선택되었습니다.'),
        getReadOnlySystemPrompt: vi.fn().mockReturnValue('읽기 전용'),
        getObserverSystemPrompt: vi.fn().mockReturnValue('작업 금지'),
      };
      const provider = makeCliProvider(adapter);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'EXECUTING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-1', 'Claude'));

      expect(adapter.getWorkerSystemPrompt).toHaveBeenCalledWith(
        '/test/project',
        expect.any(String),     // consensusFolder
        expect.any(String),     // summaryFileName
      );
      expect(capturedPersona).toContain('작업자로 선택되었습니다.');
      expect(capturedPersona).toContain('base persona');
    });

    it('prepends observer prompt via adapter for CLI provider when speaker is NOT worker in EXECUTING state', async () => {
      const adapter = {
        getWorkerSystemPrompt: vi.fn().mockReturnValue('worker prompt'),
        getReadOnlySystemPrompt: vi.fn().mockReturnValue('read-only prompt'),
        getObserverSystemPrompt: vi.fn().mockReturnValue('observer: Claude is working'),
      };
      const provider = makeCliProvider(adapter);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'EXECUTING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      // ai-2 is NOT the worker
      await executor.executeTurn(makeSpeaker('ai-2', 'Gemini'));

      expect(adapter.getObserverSystemPrompt).toHaveBeenCalledWith('Claude');
      expect(capturedPersona).toContain('observer: Claude is working');
      expect(capturedPersona).toContain('base persona');
    });

    it('prepends read-only prompt via adapter for CLI provider in REVIEWING state', async () => {
      const adapter = {
        getWorkerSystemPrompt: vi.fn().mockReturnValue('worker prompt'),
        getReadOnlySystemPrompt: vi.fn().mockReturnValue('read-only prompt'),
        getObserverSystemPrompt: vi.fn().mockReturnValue('observer prompt'),
      };
      const provider = makeCliProvider(adapter);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'REVIEWING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-2', 'Gemini'));

      expect(adapter.getReadOnlySystemPrompt).toHaveBeenCalled();
      expect(capturedPersona).toContain('read-only prompt');
    });

    it('uses hardcoded WORKER prompt when CLI provider has no permission adapter', async () => {
      const provider = makeCliProvider(null);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'EXECUTING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-1', 'Claude'));

      expect(capturedPersona).toContain('[WORKER MODE]');
      expect(capturedPersona).toContain('base persona');
    });

    it('uses hardcoded OBSERVER prompt when no adapter and speaker is not worker', async () => {
      const provider = makeCliProvider(null);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'EXECUTING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-2', 'Gemini'));

      expect(capturedPersona).toContain('[OBSERVER MODE]');
      expect(capturedPersona).toContain('base persona');
    });

    it('uses hardcoded REVIEWER prompt when no adapter and REVIEWING state', async () => {
      const provider = makeCliProvider(null);
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'REVIEWING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-2', 'Gemini'));

      expect(capturedPersona).toContain('[REVIEWER MODE]');
      expect(capturedPersona).toContain('base persona');
    });

    it('does NOT inject permission prompt for non-CLI providers', async () => {
      const provider = makeApiProvider();
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession({ workerId: 'ai-1', state: 'EXECUTING' });
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-1', 'Claude'));

      expect(capturedPersona).toBe('base persona');
    });

    it('does NOT inject permission prompt when no SSM', async () => {
      const provider = makeCliProvider();
      mockProviderGet.mockReturnValue(provider);

      const session = makeSession();
      session.sessionMachine = null;
      const wc = makeWebContents();
      const executor = new TurnExecutor(
        session as any,
        wc as any,
        makeMemoryCoordinator() as any,
        new Set(),
      );

      await executor.executeTurn(makeSpeaker('ai-1', 'Claude'));

      expect(capturedPersona).toBe('base persona');
    });
  });
});
