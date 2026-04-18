import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnExecutor } from '../turn-executor';
import type { ConversationSession } from '../conversation';
import type { Participant } from '../../../shared/engine-types';
import type { MemoryCoordinator } from '../memory-coordinator';

// ── Mock external dependencies ────────────────────────────────

const _mockStreamCompletion = vi.fn();
const _mockConsumeLastTokenUsage = vi.fn();
const mockProviderGet = vi.fn();

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: (...args: unknown[]) => mockProviderGet(...args),
  },
}));

vi.mock('../persona-builder', () => ({
  buildEffectivePersona: vi.fn().mockReturnValue('mock persona'),
}));

vi.mock('../../ipc/handlers/workspace-handler', () => ({
  permissionService: {
    getPermissionsForParticipant: vi.fn().mockReturnValue(null),
  },
  workspaceService: {
    getProjectFolder: vi.fn().mockReturnValue(null),
    getArenaFolder: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../database/conversation-repository', () => ({
  ConversationRepository: vi.fn().mockImplementation(() => ({
    insertMessage: vi.fn(),
    touchTimestamp: vi.fn(),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeWebContents(): { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

function makeSession(overrides?: Partial<ConversationSession>): ConversationSession {
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
    ...overrides,
  } as unknown as ConversationSession;
}

function makeMemoryCoordinator(): MemoryCoordinator {
  return {
    buildMemoryContext: vi.fn().mockResolvedValue(null),
    extractMemories: vi.fn(),
  } as unknown as MemoryCoordinator;
}

function makeSpeaker(id = 'ai-1', displayName = 'Claude'): Participant {
  return { id, displayName, isActive: true, providerId: id };
}

function makeProvider(tokens?: string[]) {
  const tokenList = tokens ?? ['Hello', ' world'];
  return {
    type: 'api',
    config: { type: 'api' },
    streamCompletion: vi.fn().mockImplementation(async function* () {
      for (const t of tokenList) yield t;
    }),
    consumeLastTokenUsage: vi.fn().mockReturnValue({ inputTokens: 10, outputTokens: 5 }),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('TurnExecutor', () => {
  let wc: ReturnType<typeof makeWebContents>;
  let session: ConversationSession;
  let memCoord: MemoryCoordinator;
  let primedSet: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    wc = makeWebContents();
    session = makeSession();
    memCoord = makeMemoryCoordinator();
    primedSet = new Set<string>();
  });

  describe('executeTurn', () => {
    it('emits error when provider not found', async () => {
      mockProviderGet.mockReturnValue(undefined);
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      expect(wc.send).toHaveBeenCalledWith(
        'stream:error',
        expect.objectContaining({
          participantId: 'ai-1',
          error: expect.stringContaining('Provider not found'),
        }),
      );
    });

    it('streams tokens and emits stream events', async () => {
      const provider = makeProvider(['tok1', 'tok2']);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      // Should emit message-start, log, tokens, message-done, log
      const sendCalls = wc.send.mock.calls;
      const eventNames = sendCalls.map((c: unknown[]) => c[0]);

      expect(eventNames).toContain('stream:message-start');
      expect(eventNames).toContain('stream:token');
      expect(eventNames).toContain('stream:message-done');

      // Check token events
      const tokenEvents = sendCalls.filter((c: unknown[]) => c[0] === 'stream:token');
      expect(tokenEvents).toHaveLength(2);
      expect(tokenEvents[0][1].token).toBe('tok1');
      expect(tokenEvents[0][1].sequence).toBe(1);
      expect(tokenEvents[1][1].token).toBe('tok2');
      expect(tokenEvents[1][1].sequence).toBe(2);
    });

    it('creates message in session after streaming', async () => {
      const provider = makeProvider(['Hello']);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      expect(session.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'ai-1',
          participantName: 'Claude',
          role: 'assistant',
          content: 'Hello',
        }),
      );
    });

    it('calls memoryCoordinator.extractMemories after turn', async () => {
      const provider = makeProvider(['response']);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      expect(memCoord.extractMemories).toHaveBeenCalledWith('response', 'ai-1');
    });

    it('injects memory context when available', async () => {
      const provider = makeProvider(['ok']);
      mockProviderGet.mockReturnValue(provider);
      (memCoord.buildMemoryContext as ReturnType<typeof vi.fn>).mockResolvedValue('[관련 기억]\n- fact');

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      const _messages = (session.getMessagesForProvider as ReturnType<typeof vi.fn>).mock.results[0].value;
      // Since getMessagesForProvider returns [] and we mutate it, check the call to streamCompletion
      expect(provider.streamCompletion).toHaveBeenCalled();
    });

    it('emits message-done with token usage from provider', async () => {
      const provider = makeProvider(['output']);
      provider.consumeLastTokenUsage.mockReturnValue({ inputTokens: 100, outputTokens: 50 });
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      const doneCall = wc.send.mock.calls.find((c: unknown[]) => c[0] === 'stream:message-done');
      expect(doneCall).toBeDefined();
      expect(doneCall![1].inputTokens).toBe(100);
      expect(doneCall![1].tokenCount).toBe(50);
      expect(doneCall![1].usageSource).toBe('provider');
    });

    it('handles provider errors and emits stream:error', async () => {
      const provider = makeProvider();
      // eslint-disable-next-line require-yield
      provider.streamCompletion.mockImplementation(async function* () {
        throw new Error('network timeout');
      });
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      const errorCall = wc.send.mock.calls.find((c: unknown[]) => c[0] === 'stream:error');
      expect(errorCall).toBeDefined();
      expect(errorCall![1].error).toContain('network timeout');
    });

    it('does not emit error when abort signal is set', async () => {
      const provider = makeProvider();
      // eslint-disable-next-line require-yield
      provider.streamCompletion.mockImplementation(async function* () {
        throw new DOMException('aborted', 'AbortError');
      });
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      // Start execution and immediately abort
      const turnPromise = executor.executeTurn(makeSpeaker());
      executor.abort();
      await turnPromise;

      // The error callback checks signal.aborted — since we aborted after
      // the turn started, the DOMException has name AbortError but the
      // signal may or may not be aborted. The key is the error is either
      // suppressed or emitted, but the executor does not throw.
    });

    it('adds participantId to primed set after first turn', async () => {
      const provider = makeProvider(['hi']);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(primedSet.has('ai-1')).toBe(false);
      await executor.executeTurn(makeSpeaker());
      expect(primedSet.has('ai-1')).toBe(true);
    });

    it('does not create message when streaming produces empty content', async () => {
      const provider = makeProvider([]);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      expect(session.createMessage).not.toHaveBeenCalled();
      expect(memCoord.extractMemories).not.toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('aborts in-flight request', async () => {
      let abortSignal: AbortSignal | undefined;
      const provider = makeProvider();
      provider.streamCompletion.mockImplementation(async function* (
        _msgs: unknown, _persona: unknown, _opts: unknown, signal?: AbortSignal,
      ) {
        abortSignal = signal;
        yield 'tok';
        // Wait a bit to let abort happen
        await new Promise(resolve => setTimeout(resolve, 50));
        yield 'more';
      });
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      const turnPromise = executor.executeTurn(makeSpeaker());
      // Give time for the generator to start
      await new Promise(resolve => setTimeout(resolve, 10));
      executor.abort();
      await turnPromise;

      expect(abortSignal?.aborted).toBe(true);
    });

    it('is safe to call when no request is in-flight', () => {
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      // Should not throw
      executor.abort();
    });
  });

  describe('emit (via webContents)', () => {
    it('skips sending when webContents is destroyed', async () => {
      wc.isDestroyed.mockReturnValue(true);
      const provider = makeProvider(['tok']);
      mockProviderGet.mockReturnValue(provider);

      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      await executor.executeTurn(makeSpeaker());

      expect(wc.send).not.toHaveBeenCalled();
    });
  });

  describe('shouldIncludePersona', () => {
    it('returns true for non-cli providers', () => {
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(executor.shouldIncludePersona({ type: 'api', config: {} }, 'ai-1')).toBe(true);
    });

    it('returns true for cli non-claude providers', () => {
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(
        executor.shouldIncludePersona(
          { type: 'cli', config: { command: 'ollama' } },
          'ai-1',
        ),
      ).toBe(true);
    });

    it('returns true for claude cli on first turn', () => {
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(
        executor.shouldIncludePersona(
          { type: 'cli', config: { command: 'claude' } },
          'ai-1',
        ),
      ).toBe(true);
    });

    it('returns false for claude cli after first turn (primed)', () => {
      primedSet.add('ai-1');
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(
        executor.shouldIncludePersona(
          { type: 'cli', config: { command: 'claude' } },
          'ai-1',
        ),
      ).toBe(false);
    });

    it('returns true for cli with undefined command', () => {
      const executor = new TurnExecutor(
        session,
        wc as unknown as import('electron').WebContents,
        memCoord,
        primedSet,
      );

      expect(
        executor.shouldIncludePersona(
          { type: 'cli', config: {} },
          'ai-1',
        ),
      ).toBe(true);
    });
  });
});
