import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPinMessage = vi.fn(() => 'node-123');
const mockSearchForIpc = vi.fn(async () => [
  { id: 'n-1', content: 'test result', score: 0.9 },
]);
const mockReindexEmbeddings = vi.fn(async () => 5);
const mockGetNode = vi.fn(() => ({ id: 'n-1', content: 'test', type: 'fact' }));
const mockDeleteNode = vi.fn(() => true);
const mockGetPinnedNodes = vi.fn(() => [{ id: 'n-pin', content: 'pinned' }]);
const mockExtractOnly = vi.fn(() => ({ nodes: [], mentions: [] }));
const mockGetAssembledContext = vi.fn(async () => ({
  text: 'context text',
  tokens: 100,
  sources: [],
}));
const mockExtractAndStorePipeline = vi.fn(async () => ({
  stored: 2,
  skipped: 1,
  mentions: 0,
  conflicts: 0,
}));

vi.mock('../../../memory/instance', () => ({
  getMemoryFacade: vi.fn(() => ({
    pinMessage: mockPinMessage,
    searchForIpc: mockSearchForIpc,
    reindexEmbeddings: mockReindexEmbeddings,
    getNode: mockGetNode,
    deleteNode: mockDeleteNode,
    getPinnedNodes: mockGetPinnedNodes,
    extractOnly: mockExtractOnly,
    getAssembledContext: mockGetAssembledContext,
    extractAndStorePipeline: mockExtractAndStorePipeline,
  })),
}));

// R11-Task2 retired the v2 chat-handler `getActiveSession` lookup that
// memory:pin used to resolve `messageId → content`. Until the v3 wiring
// (likely `MessageService.get`) lands, the handler errors out and the
// pin tests below assert that explicit "v3 wiring pending" surface.

import {
  handleMemoryPin,
  handleMemorySearch,
  handleMemoryReindex,
  handleMemoryGetNode,
  handleMemoryDeleteNode,
  handleMemoryGetPinned,
  handleMemoryExtractPreview,
  handleMemoryGetContext,
  handleMemoryExtractAndStore,
} from '../memory-handler';

describe('memory-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleMemoryPin', () => {
    // R11-Task2: v2 active session lookup retired. Both pin paths now
    // surface the explicit v3-wiring-pending error so a regression
    // (e.g. silent success after the v2 facade is reintroduced) gets
    // caught immediately.
    it('always throws until v3 message lookup lands', async () => {
      await expect(
        handleMemoryPin({ messageId: 'msg-1', topic: 'technical' }),
      ).rejects.toThrow('v2 session lookup retired in R11-Task2');
      expect(mockPinMessage).not.toHaveBeenCalled();
    });

    it('still throws for an unknown messageId', async () => {
      await expect(
        handleMemoryPin({ messageId: 'nonexistent', topic: 'technical' }),
      ).rejects.toThrow('v2 session lookup retired in R11-Task2');
    });
  });

  describe('handleMemorySearch', () => {
    it('happy path — returns search results', async () => {
      const result = await handleMemorySearch({ query: 'test' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].score).toBe(0.9);
      expect(mockSearchForIpc).toHaveBeenCalledWith('test', {
        topic: undefined,
        limit: undefined,
      });
    });

    it('with optional params — passes topic and limit', async () => {
      await handleMemorySearch({ query: 'test', topic: 'technical', limit: 5 });

      expect(mockSearchForIpc).toHaveBeenCalledWith('test', {
        topic: 'technical',
        limit: 5,
      });
    });

    it('service throws — propagates error', async () => {
      mockSearchForIpc.mockRejectedValueOnce(new Error('FTS5 index corrupted'));

      await expect(handleMemorySearch({ query: 'test' })).rejects.toThrow(
        'FTS5 index corrupted',
      );
    });
  });

  describe('handleMemoryReindex', () => {
    it('happy path — returns reindexed count', async () => {
      const result = await handleMemoryReindex();

      expect(result.reindexed).toBe(5);
      expect(mockReindexEmbeddings).toHaveBeenCalledOnce();
    });
  });

  describe('handleMemoryGetNode', () => {
    it('happy path — returns node by ID', () => {
      const result = handleMemoryGetNode({ id: 'n-1' });

      expect(result.node).not.toBeNull();
      expect(result.node!.id).toBe('n-1');
    });

    it('nonexistent node — returns null', () => {
      mockGetNode.mockReturnValueOnce(null);

      const result = handleMemoryGetNode({ id: 'nonexistent' });

      expect(result.node).toBeNull();
    });
  });

  describe('handleMemoryDeleteNode', () => {
    it('happy path — soft-deletes and returns true', () => {
      const result = handleMemoryDeleteNode({ id: 'n-1' });

      expect(result.deleted).toBe(true);
      expect(mockDeleteNode).toHaveBeenCalledWith('n-1');
    });

    it('nonexistent node — returns false', () => {
      mockDeleteNode.mockReturnValueOnce(false);

      const result = handleMemoryDeleteNode({ id: 'nonexistent' });

      expect(result.deleted).toBe(false);
    });
  });

  describe('handleMemoryGetPinned', () => {
    it('happy path — returns pinned nodes', () => {
      const result = handleMemoryGetPinned({});

      expect(result.nodes).toHaveLength(1);
      expect(mockGetPinnedNodes).toHaveBeenCalled();
    });
  });

  describe('handleMemoryExtractPreview', () => {
    it('happy path — returns extraction preview', () => {
      const result = handleMemoryExtractPreview({
        messages: [{ content: 'AI said something', participantId: 'ai-1' }],
      });

      expect(mockExtractOnly).toHaveBeenCalledWith([
        { content: 'AI said something', participantId: 'ai-1' },
      ]);
      expect(result).toEqual({ nodes: [], mentions: [] });
    });
  });

  describe('handleMemoryGetContext', () => {
    it('happy path — returns assembled context', async () => {
      const result = await handleMemoryGetContext({ query: 'what is this?' });

      expect(result.text).toBe('context text');
      expect(result.tokens).toBe(100);
    });
  });

  describe('handleMemoryExtractAndStore', () => {
    it('happy path — extracts and stores, returns counts', async () => {
      const result = await handleMemoryExtractAndStore({
        messages: [{ content: 'store this', participantId: 'ai-1' }],
        conversationId: 'conv-1',
      });

      expect(result.stored).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.mentions).toBe(0);
      expect(result.conflicts).toBe(0);
    });
  });
});
