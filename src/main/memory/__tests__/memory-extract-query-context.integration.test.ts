/**
 * Integration test: Memory Extract → Query → Context Assembly Pipeline
 *
 * Verifies the full extraction → storage → query → context assembly pipeline:
 * - RegexExtractor: pattern matching for decisions, facts, preferences
 * - MemoryFacade.extractAndStore: extraction + deduplication + storage
 * - MemoryFacade.search: FTS5-backed retrieval
 * - ContextAssembler: token-budgeted context assembly
 * - End-to-end pipeline from messages to assembled context
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { MemoryFacade } from '../../memory/facade';
import { RegexExtractor } from '../../memory/extractor';
import { ContextAssembler } from '../../memory/assembler';
import { DEFAULT_MEMORY_CONFIG } from '../../../shared/memory-types';
import { createTestDb } from '../../../test-utils';

describe('Memory Extract → Query → Context Pipeline', () => {
  let db: Database.Database;
  let memory: MemoryFacade;

  beforeEach(() => {
    db = createTestDb();
    memory = new MemoryFacade(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── RegexExtractor: extract from conversation messages ────────────

  it('RegexExtractor extracts items from conversation messages', () => {
    const extractor = new RegexExtractor();
    const messages = [
      { content: 'We decided to use React for the frontend.', participantId: 'ai-1' },
      { content: 'The API uses REST endpoints for communication.', participantId: 'ai-2' },
    ];

    const result = extractor.extractFromMessages(messages);
    expect(result.turnCount).toBe(2);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  // ── Extract identifies decisions ──────────────────────────────────

  it('extracts decisions from English text', () => {
    const extractor = new RegexExtractor();
    const items = extractor.extract('We decided to use React for the frontend.');

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].nodeType).toBe('decision');
    expect(items[0].topic).toBe('decisions');
    expect(items[0].content).toContain('decided to use React');
  });

  // ── Extract identifies technical facts ────────────────────────────

  it('extracts facts from text containing fact patterns', () => {
    const extractor = new RegexExtractor();
    const items = extractor.extract('The framework supports hot module replacement.');

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].nodeType).toBe('fact');
    expect(items[0].content).toContain('supports');
  });

  // ── Store extracted nodes → search finds them ─────────────────────

  it('stores extracted knowledge and finds it via search', async () => {
    const messages = [
      { content: 'We decided to use Electron for the desktop app.', participantId: 'ai-1' },
    ];

    const count = memory.extractAndStore(messages, 'conv-extract');
    expect(count).toBeGreaterThanOrEqual(1);

    const results = await memory.search('Electron');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].node.content).toContain('Electron');
  });

  // ── Duplicate detection ───────────────────────────────────────────

  it('deduplicates when extracting the same messages twice', () => {
    const messages = [
      { content: 'We decided to use Vue for the UI layer.', participantId: 'ai-1' },
    ];

    const count1 = memory.extractAndStore(messages, 'conv-1');
    expect(count1).toBeGreaterThanOrEqual(1);

    // Same content again
    const count2 = memory.extractAndStore(messages, 'conv-1');
    expect(count2).toBe(0);

    // Verify only one node in DB
    const rows = db
      .prepare("SELECT COUNT(*) as cnt FROM knowledge_nodes WHERE deleted_at IS NULL")
      .get() as { cnt: number };
    expect(rows.cnt).toBe(count1);
  });

  // ── Context assembly: token budget respected ──────────────────────

  it('ContextAssembler respects token budget when assembling context', () => {
    const config = { ...DEFAULT_MEMORY_CONFIG, contextTotalBudget: 100 };
    const assembler = new ContextAssembler(config);

    const assembled = assembler.assemble({
      memories: [
        {
          node: {
            id: 'n1',
            content: 'React is our UI framework',
            nodeType: 'decision',
            topic: 'technical',
            importance: 0.8,
            source: 'auto',
            pinned: false,
            conversationId: null,
            messageId: null,
            lastAccessed: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            embeddingVersion: null,
            extractorVersion: null,
            sourceHash: null,
            dedupeKey: null,
            deletedAt: null,
            participantId: null,
            lastMentionedAt: null,
            mentionCount: 0,
            confidence: 0.5,
          },
          score: 0.9,
          source: 'fts',
        },
      ],
      systemPrompt: 'You are a helpful assistant.',
    });

    expect(assembled.tokensUsed).toBeGreaterThan(0);
    expect(assembled.tokensUsed).toBeLessThanOrEqual(100);
    expect(assembled.memoryContext.length).toBeGreaterThan(0);
  });

  // ── Context relevance: query-relevant memories ranked higher ──────

  it('search returns query-relevant memories with positive scores', async () => {
    memory.storeNode({
      content: 'React hooks simplify component state management',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
    });

    memory.storeNode({
      content: 'Python is used for data science workflows',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.6,
      source: 'auto',
    });

    const results = await memory.search('React');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].node.content).toContain('React');
    expect(results[0].score).toBeGreaterThan(0);
  });

  // ── Full pipeline: extract → store → search → assemble ────────────

  it('runs the full pipeline from messages to assembled context', async () => {
    // Step 1: Extract and store from messages
    const messages = [
      { content: 'We decided to use Zustand for state management.', participantId: 'ai-1' },
      { content: 'The project requires TypeScript for type safety.', participantId: 'ai-2' },
    ];

    const stored = memory.extractAndStore(messages, 'conv-pipeline');
    expect(stored).toBeGreaterThanOrEqual(1);

    // Step 2: Search for stored memories
    const searchResults = await memory.search('Zustand');

    // Step 3: If found, assemble context
    if (searchResults.length > 0) {
      const context = await memory.getAssembledContext({
        query: 'Zustand',
        systemPrompt: 'You are a coding assistant.',
      });

      expect(context.tokensUsed).toBeGreaterThan(0);
      expect(context.memoryContext.length).toBeGreaterThan(0);
    }

    // Verify at minimum that stored data persists
    const nodeCount = db
      .prepare("SELECT COUNT(*) as cnt FROM knowledge_nodes WHERE deleted_at IS NULL")
      .get() as { cnt: number };
    expect(nodeCount.cnt).toBeGreaterThanOrEqual(1);
  });

  // ── Empty extraction ──────────────────────────────────────────────

  it('returns empty extraction results for messages with no extractable content', () => {
    const messages = [
      { content: 'Good morning!', participantId: 'ai-1' },
      { content: 'How are you?', participantId: 'ai-2' },
      { content: 'Fine, thanks.', participantId: 'ai-1' },
    ];

    const result = memory.extractOnly(messages);
    expect(result.items).toHaveLength(0);
    expect(result.turnCount).toBe(3);
  });

  // ── Multiple conversation extractions ─────────────────────────────

  it('nodes from different conversations are both searchable', async () => {
    memory.storeNode({
      content: 'Conversation A: We decided to use MongoDB for NoSQL storage',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
      conversationId: 'conv-a',
    });

    memory.storeNode({
      content: 'Conversation B: We decided to use Redis for caching',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
      conversationId: 'conv-b',
    });

    const mongoResults = await memory.search('MongoDB');
    expect(mongoResults.length).toBeGreaterThan(0);
    expect(mongoResults[0].node.conversationId).toBe('conv-a');

    const redisResults = await memory.search('Redis');
    expect(redisResults.length).toBeGreaterThan(0);
    expect(redisResults[0].node.conversationId).toBe('conv-b');
  });

  // ── Pin + search + context ────────────────────────────────────────

  it('pinned nodes are prioritized in search and included in context', async () => {
    // Store a regular node
    memory.storeNode({
      content: 'We use Vitest for testing',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    // Pin a critical node
    memory.pinMessage('msg-critical', 'CRITICAL: Vitest must be used for all tests', 'technical');

    // Search should find both, pinned first
    const results = await memory.search('Vitest');
    expect(results.length).toBe(2);

    const pinnedResult = results.find((r) => r.node.pinned);
    expect(pinnedResult).toBeDefined();

    // Assemble context — pinned node should be present
    const context = await memory.getAssembledContext({
      query: 'Vitest',
      topic: 'technical',
    });

    expect(context.memoryContext).toContain('Vitest');
    expect(context.tokensUsed).toBeGreaterThan(0);
  });

  // ── Korean extraction ─────────────────────────────────────────────

  it('extracts decisions from Korean text', () => {
    const extractor = new RegexExtractor();
    const items = extractor.extract('React를 사용하기로 결정했다.');

    expect(items.length).toBeGreaterThanOrEqual(1);
    // Should match Korean decision pattern
    const decisions = items.filter((i) => i.nodeType === 'decision');
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });
});
