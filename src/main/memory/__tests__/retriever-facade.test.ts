import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryRetriever } from '../retriever';
import { MemoryFacade } from '../facade';
import type { MemoryConfig } from '../../../shared/memory-types';
import { DEFAULT_MEMORY_CONFIG } from '../../../shared/memory-types';

/** Create an in-memory SQLite database with the required schema. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB,
      node_type TEXT NOT NULL,
      topic TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      source TEXT,
      pinned INTEGER DEFAULT 0,
      conversation_id TEXT,
      message_id TEXT,
      last_accessed DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      embedding_version TEXT,
      extractor_version TEXT,
      source_hash TEXT,
      dedupe_key TEXT,
      deleted_at DATETIME,
      participant_id TEXT,
      last_mentioned_at DATETIME,
      mention_count INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0.5
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      content,
      content=knowledge_nodes,
      content_rowid=rowid,
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert
    AFTER INSERT ON knowledge_nodes
    BEGIN
      INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
    AFTER UPDATE OF content ON knowledge_nodes
    BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete
    AFTER UPDATE OF deleted_at ON knowledge_nodes
    WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
    BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_node_id TEXT REFERENCES knowledge_nodes(id),
      target_node_id TEXT REFERENCES knowledge_nodes(id),
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      participant_id TEXT,
      content TEXT NOT NULL,
      role TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      pin_topic TEXT,
      response_time_ms INTEGER,
      token_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      parent_message_id TEXT,
      branch_id TEXT,
      branch_root_message_id TEXT
    );
  `);

  return db;
}

/** Insert a node directly into the DB for testing. */
function insertTestNode(
  db: Database.Database,
  opts: {
    id: string;
    content: string;
    nodeType?: string;
    topic?: string;
    importance?: number;
    source?: string;
    pinned?: number;
    lastAccessed?: string;
    dedupeKey?: string;
    deletedAt?: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_nodes
     (id, content, node_type, topic, importance, source, pinned,
      last_accessed, created_at, updated_at, dedupe_key, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.content,
    opts.nodeType ?? 'fact',
    opts.topic ?? 'technical',
    opts.importance ?? 0.5,
    opts.source ?? 'auto',
    opts.pinned ?? 0,
    opts.lastAccessed ?? now,
    now,
    now,
    opts.dedupeKey ?? null,
    opts.deletedAt ?? null,
  );
  // FTS sync handled by knowledge_fts_insert trigger
}

// ── MemoryRetriever Tests ───────────────────────────────────────────

describe('MemoryRetriever', () => {
  let db: Database.Database;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    db = createTestDb();
    retriever = new MemoryRetriever(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty results for empty query', async () => {
    expect(await retriever.search('')).toEqual([]);
    expect(await retriever.search('  ')).toEqual([]);
  });

  it('returns empty results when no nodes exist', async () => {
    const results = await retriever.search('test query');
    expect(results).toEqual([]);
  });

  it('finds matching nodes by FTS5 search', async () => {
    insertTestNode(db, { id: 'n1', content: 'React is a JavaScript framework' });
    insertTestNode(db, { id: 'n2', content: 'Python is a programming language' });

    const results = await retriever.search('React');
    expect(results.length).toBe(1);
    expect(results[0].node.id).toBe('n1');
    expect(results[0].source).toBe('fts');
  });

  it('returns multiple matching results', async () => {
    insertTestNode(db, { id: 'n1', content: 'TypeScript supports type checking' });
    insertTestNode(db, { id: 'n2', content: 'TypeScript is a superset of JavaScript' });
    insertTestNode(db, { id: 'n3', content: 'Python has no type checking by default' });

    const results = await retriever.search('TypeScript');
    expect(results.length).toBe(2);
  });

  it('filters by topic when specified', async () => {
    insertTestNode(db, { id: 'n1', content: 'React framework decision', topic: 'decisions' });
    insertTestNode(db, { id: 'n2', content: 'React is popular', topic: 'technical' });

    const results = await retriever.search('React', { topic: 'decisions' });
    expect(results.length).toBe(1);
    expect(results[0].node.topic).toBe('decisions');
  });

  it('excludes soft-deleted nodes', async () => {
    insertTestNode(db, { id: 'n1', content: 'Active node about databases' });
    insertTestNode(db, { id: 'n2', content: 'Deleted node about databases', deletedAt: new Date().toISOString() });

    const results = await retriever.search('databases');
    expect(results.length).toBe(1);
    expect(results[0].node.id).toBe('n1');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      insertTestNode(db, { id: `n${i}`, content: `Memory about testing topic ${i}` });
    }

    const results = await retriever.search('testing', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('boosts pinned nodes', async () => {
    // Use identical content structure so FTS ranks are similar,
    // ensuring the pin boost is the differentiating factor.
    insertTestNode(db, { id: 'n1', content: 'architecture design patterns overview', pinned: 1, importance: 0.5 });
    insertTestNode(db, { id: 'n2', content: 'architecture design patterns overview', pinned: 0, importance: 0.5 });
    insertTestNode(db, { id: 'n3', content: 'architecture design patterns summary', pinned: 0, importance: 0.5 });

    const results = await retriever.search('architecture design patterns');
    expect(results.length).toBe(3);

    const pinnedResult = results.find((r) => r.node.id === 'n1');
    const regularResult = results.find((r) => r.node.id === 'n2');
    expect(pinnedResult).toBeDefined();
    expect(regularResult).toBeDefined();
    if (pinnedResult && regularResult) {
      // Pinned node gets a 1.2x boost, so its score should be higher
      expect(pinnedResult.score).toBeGreaterThan(regularResult.score);
    }
  });

  it('updates last_accessed on retrieval', async () => {
    const oldDate = '2020-01-01T00:00:00.000Z';
    insertTestNode(db, { id: 'n1', content: 'Something about deployment', lastAccessed: oldDate });

    await retriever.search('deployment');

    const row = db.prepare('SELECT last_accessed FROM knowledge_nodes WHERE id = ?').get('n1') as { last_accessed: string };
    expect(row.last_accessed).not.toBe(oldDate);
  });

  it('getNode returns a node by ID', () => {
    insertTestNode(db, { id: 'n1', content: 'Test node' });
    const node = retriever.getNode('n1');
    expect(node).not.toBeNull();
    expect(node?.content).toBe('Test node');
  });

  it('getNode returns null for non-existent ID', () => {
    expect(retriever.getNode('nonexistent')).toBeNull();
  });

  it('getNode returns null for soft-deleted node', () => {
    insertTestNode(db, { id: 'n1', content: 'Deleted', deletedAt: new Date().toISOString() });
    expect(retriever.getNode('n1')).toBeNull();
  });

  it('getPinnedNodes returns only pinned nodes', () => {
    insertTestNode(db, { id: 'n1', content: 'Pinned', pinned: 1 });
    insertTestNode(db, { id: 'n2', content: 'Not pinned', pinned: 0 });

    const pinned = retriever.getPinnedNodes();
    expect(pinned.length).toBe(1);
    expect(pinned[0].id).toBe('n1');
  });

  it('getPinnedNodes filters by topic', () => {
    insertTestNode(db, { id: 'n1', content: 'Tech pin', pinned: 1, topic: 'technical' });
    insertTestNode(db, { id: 'n2', content: 'Decision pin', pinned: 1, topic: 'decisions' });

    const results = retriever.getPinnedNodes('technical');
    expect(results.length).toBe(1);
    expect(results[0].topic).toBe('technical');
  });

  it('handles FTS5 special characters gracefully', async () => {
    insertTestNode(db, { id: 'n1', content: 'Test with special chars' });

    // These should not throw
    await expect(retriever.search('test AND OR NOT')).resolves.toBeDefined();
    await expect(retriever.search('"quoted"')).resolves.toBeDefined();
    await expect(retriever.search('test*')).resolves.toBeDefined();
  });
});

// ── MemoryFacade Tests ──────────────────────────────────────────────

describe('MemoryFacade', () => {
  let db: Database.Database;
  let facade: MemoryFacade;

  beforeEach(() => {
    db = createTestDb();
    facade = new MemoryFacade(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── storeNode ─────────────────────────────────────────────────────

  it('stores a new knowledge node', () => {
    const id = facade.storeNode({
      content: 'React 18을 사용하기로 결정',
      nodeType: 'decision',
      topic: 'decisions',
      importance: 0.8,
      source: 'auto',
    });

    expect(id).toBeTruthy();
    const node = facade.getNode(id);
    expect(node).not.toBeNull();
    expect(node?.content).toBe('React 18을 사용하기로 결정');
    expect(node?.nodeType).toBe('decision');
  });

  it('deduplicates nodes with same content', () => {
    const id1 = facade.storeNode({
      content: 'TypeScript is required',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    const id2 = facade.storeNode({
      content: 'TypeScript is required',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    expect(id1).toBe(id2);
  });

  it('stored node is searchable via FTS', async () => {
    facade.storeNode({
      content: 'SQLite supports full-text search via FTS5',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.6,
      source: 'auto',
    });

    const results = await facade.search('SQLite FTS5');
    expect(results.length).toBe(1);
    expect(results[0].node.content).toContain('SQLite');
  });

  // ── pinMessage ────────────────────────────────────────────────────

  it('pins a message as a new node', () => {
    const id = facade.pinMessage('msg-1', 'Important decision about API', 'decisions');
    expect(id).toBeTruthy();

    const node = facade.getNode(id);
    expect(node).not.toBeNull();
    expect(node?.pinned).toBe(true);
    expect(node?.topic).toBe('decisions');
  });

  it('boosts importance of existing node when pinning same message', () => {
    facade.storeNode({
      content: 'Auto-extracted fact',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
      messageId: 'msg-2',
    });

    // Pin the same message
    facade.pinMessage('msg-2', 'Auto-extracted fact', 'technical');

    // Find the node by message_id
    const row = db.prepare(
      'SELECT importance, pinned FROM knowledge_nodes WHERE message_id = ?',
    ).get('msg-2') as { importance: number; pinned: number };

    expect(row.pinned).toBe(1);
    expect(row.importance).toBeGreaterThan(0.5);
  });

  // ── search ────────────────────────────────────────────────────────

  it('searchForIpc returns serializable results', async () => {
    facade.storeNode({
      content: 'Architecture uses microservices',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
    });

    const results = await facade.searchForIpc('microservices');
    expect(results.length).toBe(1);
    expect(results[0].content).toContain('microservices');
    expect(results[0].nodeType).toBe('decision');
    expect(typeof results[0].score).toBe('number');
    expect(typeof results[0].createdAt).toBe('string');
  });

  // ── extractAndStore ───────────────────────────────────────────────

  it('extracts and stores memories from messages', () => {
    const count = facade.extractAndStore([
      { content: 'React를 사용하기로 결정했다.', participantId: 'ai-1' },
      { content: 'TypeScript를 쓰기로 했다.', participantId: 'ai-2' },
    ], 'conv-1');

    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('does not store items below importance threshold', () => {
    const config: Partial<MemoryConfig> = {
      ...DEFAULT_MEMORY_CONFIG,
      extractionMinImportance: 0.99,
    };
    const strictFacade = new MemoryFacade(db, config);

    const count = strictFacade.extractAndStore([
      { content: 'React를 추천합니다.', participantId: 'ai-1' },
    ]);

    expect(count).toBe(0);
  });

  it('extractOnly does not persist nodes', () => {
    const result = facade.extractOnly([
      { content: 'Python으로 결정했습니다.', participantId: 'ai-1' },
    ]);

    expect(result.items.length).toBeGreaterThanOrEqual(1);

    const rows = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_nodes').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  // ── getAssembledContext ───────────────────────────────────────────

  it('assembles context with memories', async () => {
    facade.storeNode({
      content: 'Project uses React 18',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.8,
      source: 'auto',
    });

    const ctx = await facade.getAssembledContext({
      query: 'React',
      systemPrompt: 'You are a helpful assistant.',
      recentHistory: 'User: What framework?',
    });

    expect(ctx.memoryContext).toContain('React');
    expect(ctx.tokensUsed).toBeGreaterThan(0);
  });

  it('assembles context without memories', async () => {
    const ctx = await facade.getAssembledContext({
      query: 'nonexistent topic',
      systemPrompt: 'System prompt.',
    });

    expect(ctx.memoryContext).toContain('System prompt');
    expect(ctx.tokensUsed).toBeGreaterThan(0);
  });

  // ── deleteNode ────────────────────────────────────────────────────

  it('soft-deletes a node', () => {
    const id = facade.storeNode({
      content: 'To be deleted',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.3,
      source: 'auto',
    });

    expect(facade.deleteNode(id)).toBe(true);
    expect(facade.getNode(id)).toBeNull();
  });

  it('returns false when deleting non-existent node', () => {
    expect(facade.deleteNode('nonexistent')).toBe(false);
  });

  it('deleted nodes are excluded from search', async () => {
    const id = facade.storeNode({
      content: 'Searchable then deleted content',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    expect((await facade.search('deleted content')).length).toBe(1);
    facade.deleteNode(id);
    expect((await facade.search('deleted content')).length).toBe(0);
  });

  // ── getPinnedNodes ────────────────────────────────────────────────

  it('returns pinned nodes', () => {
    facade.pinMessage('msg-1', 'Pinned memory', 'decisions');
    const pinned = facade.getPinnedNodes();
    expect(pinned.length).toBe(1);
    expect(pinned[0].pinned).toBe(true);
  });

  // ── evolve / reflect (Phase 3-b) ─────────────────────────────────

  it('evolve returns zero counts without evolver', () => {
    const result = facade.evolve();
    expect(result).toEqual({ merged: 0, pruned: 0 });
  });

  it('reflect returns zero counts without reflector', async () => {
    const result = await facade.reflect();
    expect(result).toEqual({ insightsCreated: 0, nodesProcessed: 0 });
  });

  it('shouldReflect returns false without reflector', () => {
    expect(facade.shouldReflect()).toBe(false);
  });

  // ── extractAndStorePipeline ─────────────────────────────────────────

  it('extractAndStorePipeline stores extracted memories', async () => {
    const result = await facade.extractAndStorePipeline([
      { content: 'React를 사용하기로 결정했다.', participantId: 'ai-1' },
      { content: 'TypeScript를 쓰기로 했다.', participantId: 'ai-2' },
    ], 'conv-pipeline');

    expect(result.stored).toBeGreaterThanOrEqual(1);

    const rows = db.prepare(
      'SELECT COUNT(*) as cnt FROM knowledge_nodes',
    ).get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThanOrEqual(1);
  });

  it('extractAndStorePipeline returns zero for empty extraction', async () => {
    const result = await facade.extractAndStorePipeline([
      { content: '안녕하세요', participantId: 'ai-1' },
    ]);

    expect(result.stored).toBe(0);
  });

  it('extractAndStorePipeline handles deduplication', async () => {
    const messages = [
      { content: 'Python으로 결정했습니다.', participantId: 'ai-1' },
    ];

    const r1 = await facade.extractAndStorePipeline(messages, 'conv-1');
    const r2 = await facade.extractAndStorePipeline(messages, 'conv-2');

    expect(r1.stored).toBeGreaterThanOrEqual(1);
    expect(r2.stored).toBe(0); // All items are duplicates
  });

  // ── Constructor with MemoryServices ──────────────────────────────────

  it('accepts MemoryServices at construction', () => {
    const facadeWithServices = new MemoryFacade(db, undefined, {});
    expect(facadeWithServices).toBeDefined();

    // Should still work for basic operations
    const id = facadeWithServices.storeNode({
      content: 'Service-injected facade test',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });
    expect(id).toBeTruthy();
  });

  it('uses LlmStrategy when llmExtractFn is provided with extractionLlmProviderId', async () => {
    const llmExtractFn = async (_system: string, _user: string): Promise<string> => {
      return JSON.stringify([{
        content: 'LLM-extracted: React is the chosen framework',
        nodeType: 'decision',
        topic: 'technical',
        importance: 0.9,
        participantId: 'ai-1',
        confidence: 0.95,
      }]);
    };

    const llmFacade = new MemoryFacade(
      db,
      { extractionLlmProviderId: 'test-provider' },
      { llmExtractFn },
    );

    const result = await llmFacade.extractAndStorePipeline([
      { content: 'We should use React', participantId: 'ai-1' },
    ]);

    expect(result.stored).toBeGreaterThanOrEqual(1);
  });
});
