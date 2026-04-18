import { describe, it, expect, vi } from 'vitest';
import { MemoryCoordinator } from '../memory-coordinator';
import type { ConversationSession } from '../conversation';
import type { MemoryFacade } from '../../memory/facade';

// ── Helpers ──────────────────────────────────────────────────

function makeSession(messages: Array<{ role: string; content: string }>): ConversationSession {
  return {
    id: 'conv-1',
    messages: messages.map((m, i) => ({
      id: `msg-${i}`,
      role: m.role,
      content: m.content,
      participantId: m.role === 'user' ? 'user' : 'ai-1',
      participantName: m.role === 'user' ? 'User' : 'AI',
    })),
  } as unknown as ConversationSession;
}

function makeMemoryFacade(overrides?: Partial<MemoryFacade>): MemoryFacade {
  return {
    search: vi.fn().mockResolvedValue([]),
    extractAndStore: vi.fn().mockReturnValue(0),
    embedUnembeddedNodes: vi.fn().mockResolvedValue(0),
    evolve: vi.fn().mockReturnValue({ merged: 0, pruned: 0 }),
    shouldReflect: vi.fn().mockReturnValue(false),
    reflect: vi.fn().mockResolvedValue({ insightsCreated: 0, nodesProcessed: 0 }),
    ...overrides,
  } as unknown as MemoryFacade;
}

// ── Tests ────────────────────────────────────────────────────

describe('MemoryCoordinator', () => {
  describe('buildMemoryContext', () => {
    it('returns null when memoryFacade is null', async () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const mc = new MemoryCoordinator(session, null);

      expect(await mc.buildMemoryContext()).toBeNull();
    });

    it('returns null when no user messages exist', async () => {
      const session = makeSession([{ role: 'assistant', content: 'reply' }]);
      const facade = makeMemoryFacade();
      const mc = new MemoryCoordinator(session, facade);

      expect(await mc.buildMemoryContext()).toBeNull();
      expect(facade.search).not.toHaveBeenCalled();
    });

    it('returns null when search returns empty results', async () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const facade = makeMemoryFacade({ search: vi.fn().mockResolvedValue([]) });
      const mc = new MemoryCoordinator(session, facade);

      expect(await mc.buildMemoryContext()).toBeNull();
      expect(facade.search).toHaveBeenCalledWith('hello', { limit: 5 });
    });

    it('returns formatted context string from search results', async () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const facade = makeMemoryFacade({
        search: vi.fn().mockResolvedValue([
          { node: { content: 'Memory A', importance: 0.5 } },
          { node: { content: 'Memory B', importance: 0.9 } },
        ]),
      });
      const mc = new MemoryCoordinator(session, facade);

      const result = await mc.buildMemoryContext();
      expect(result).toContain('[관련 기억]');
      expect(result).toContain('- Memory A');
      expect(result).toContain('- Memory B [중요]');
    });

    it('returns null on search error', async () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const facade = makeMemoryFacade({
        search: vi.fn().mockRejectedValue(new Error('search failed')),
      });
      const mc = new MemoryCoordinator(session, facade);

      expect(await mc.buildMemoryContext()).toBeNull();
    });

    it('uses the last user message as query', async () => {
      const session = makeSession([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ]);
      const facade = makeMemoryFacade({ search: vi.fn().mockResolvedValue([]) });
      const mc = new MemoryCoordinator(session, facade);

      await mc.buildMemoryContext();
      expect(facade.search).toHaveBeenCalledWith('second', { limit: 5 });
    });
  });

  describe('extractMemories', () => {
    it('does nothing when memoryFacade is null', () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const mc = new MemoryCoordinator(session, null);

      // Should not throw
      mc.extractMemories('AI response', 'ai-1');
    });

    it('calls extractAndStore with AI content and last user message', () => {
      const session = makeSession([{ role: 'user', content: 'user question' }]);
      const facade = makeMemoryFacade({ extractAndStore: vi.fn().mockReturnValue(2) });
      const mc = new MemoryCoordinator(session, facade);

      mc.extractMemories('AI answer', 'ai-1');
      expect(facade.extractAndStore).toHaveBeenCalledWith(
        [
          { content: 'user question', participantId: 'user' },
          { content: 'AI answer', participantId: 'ai-1' },
        ],
        'conv-1',
      );
    });

    it('extracts only AI content when no user message exists', () => {
      const session = makeSession([{ role: 'assistant', content: 'init' }]);
      const facade = makeMemoryFacade({ extractAndStore: vi.fn().mockReturnValue(1) });
      const mc = new MemoryCoordinator(session, facade);

      mc.extractMemories('AI answer', 'ai-1');
      expect(facade.extractAndStore).toHaveBeenCalledWith(
        [{ content: 'AI answer', participantId: 'ai-1' }],
        'conv-1',
      );
    });

    it('handles extractAndStore errors gracefully', () => {
      const session = makeSession([{ role: 'user', content: 'hello' }]);
      const facade = makeMemoryFacade({
        extractAndStore: vi.fn().mockImplementation(() => {
          throw new Error('extract failed');
        }),
      });
      const mc = new MemoryCoordinator(session, facade);

      // Should not throw
      mc.extractMemories('AI answer', 'ai-1');
    });
  });

  describe('getLastUserMessageContent', () => {
    it('returns null when no messages exist', () => {
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, null);

      expect(mc.getLastUserMessageContent()).toBeNull();
    });

    it('returns last user message content', () => {
      const session = makeSession([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'reply2' },
      ]);
      const mc = new MemoryCoordinator(session, null);

      expect(mc.getLastUserMessageContent()).toBe('second');
    });

    it('returns null when no user messages exist', () => {
      const session = makeSession([
        { role: 'assistant', content: 'reply' },
        { role: 'system', content: 'system msg' },
      ]);
      const mc = new MemoryCoordinator(session, null);

      expect(mc.getLastUserMessageContent()).toBeNull();
    });
  });

  describe('runPostConversationMaintenance', () => {
    it('does nothing when memoryFacade is null', async () => {
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, null);

      // Should resolve without error
      await mc.runPostConversationMaintenance();
    });

    it('runs embed, evolve, and skips reflection when threshold not met', async () => {
      const facade = makeMemoryFacade({
        embedUnembeddedNodes: vi.fn().mockResolvedValue(3),
        evolve: vi.fn().mockReturnValue({ merged: 1, pruned: 0 }),
        shouldReflect: vi.fn().mockReturnValue(false),
      });
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, facade);

      await mc.runPostConversationMaintenance();

      expect(facade.embedUnembeddedNodes).toHaveBeenCalledOnce();
      expect(facade.evolve).toHaveBeenCalledOnce();
      expect(facade.shouldReflect).toHaveBeenCalledOnce();
      expect(facade.reflect).not.toHaveBeenCalled();
    });

    it('runs reflection and re-embeds when shouldReflect is true', async () => {
      const facade = makeMemoryFacade({
        embedUnembeddedNodes: vi.fn().mockResolvedValue(0),
        evolve: vi.fn().mockReturnValue({ merged: 0, pruned: 0 }),
        shouldReflect: vi.fn().mockReturnValue(true),
        reflect: vi.fn().mockResolvedValue({ insightsCreated: 2, nodesProcessed: 5 }),
      });
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, facade);

      await mc.runPostConversationMaintenance();

      expect(facade.reflect).toHaveBeenCalledOnce();
      // embedUnembeddedNodes called initially + after reflection
      expect(facade.embedUnembeddedNodes).toHaveBeenCalledTimes(2);
    });

    it('skips re-embed when reflection produces no insights', async () => {
      const facade = makeMemoryFacade({
        embedUnembeddedNodes: vi.fn().mockResolvedValue(0),
        evolve: vi.fn().mockReturnValue({ merged: 0, pruned: 0 }),
        shouldReflect: vi.fn().mockReturnValue(true),
        reflect: vi.fn().mockResolvedValue({ insightsCreated: 0, nodesProcessed: 3 }),
      });
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, facade);

      await mc.runPostConversationMaintenance();

      expect(facade.reflect).toHaveBeenCalledOnce();
      // Only the initial embedUnembeddedNodes call, no re-embed
      expect(facade.embedUnembeddedNodes).toHaveBeenCalledOnce();
    });

    it('handles errors gracefully', async () => {
      const facade = makeMemoryFacade({
        embedUnembeddedNodes: vi.fn().mockRejectedValue(new Error('embed failed')),
      });
      const session = makeSession([]);
      const mc = new MemoryCoordinator(session, facade);

      // Should not throw
      await mc.runPostConversationMaintenance();
    });
  });
});
