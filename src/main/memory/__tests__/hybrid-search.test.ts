import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { HybridSearch, isVecTableAvailable, tryInitVecTable } from '../hybrid-search';
import type { RetrievalPipelineData } from '../hybrid-search';
import { EmbeddingService } from '../embedding-service';
import { MemoryRetriever } from '../retriever';

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
  `);

  return db;
}

function insertTestNode(
  db: Database.Database,
  opts: {
    id: string;
    content: string;
    nodeType?: string;
    topic?: string;
    importance?: number;
    lastAccessed?: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge_nodes
     (id, content, node_type, topic, importance, source, last_accessed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'auto', ?, ?, ?)`,
  ).run(
    opts.id,
    opts.content,
    opts.nodeType ?? 'fact',
    opts.topic ?? 'technical',
    opts.importance ?? 0.5,
    opts.lastAccessed ?? now,
    now,
    now,
  );
}

// ── Float32 Serialization ───────────────────────────────────────────

describe('EmbeddingService float32 methods', () => {
  it('vectorToFloat32Blob produces correct buffer size', () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
    const blob = EmbeddingService.vectorToFloat32Blob(vec);
    // 5 floats * 4 bytes each = 20
    expect(blob.length).toBe(20);
  });

  it('float32 roundtrip preserves values within float32 precision', () => {
    const original = [1.5, -2.7, 0, 3.14, 0.001];
    const blob = EmbeddingService.vectorToFloat32Blob(original);
    const restored = EmbeddingService.float32BlobToVector(blob);

    expect(restored).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      // Float32 has ~7 digits of precision
      expect(restored[i]).toBeCloseTo(original[i], 3);
    }
  });

  it('handles empty array for float32', () => {
    const blob = EmbeddingService.vectorToFloat32Blob([]);
    expect(blob.length).toBe(0);
    expect(EmbeddingService.float32BlobToVector(blob)).toEqual([]);
  });

  it('float32 blob is half the size of float64 blob', () => {
    const vec = [1, 2, 3, 4, 5];
    const f64 = EmbeddingService.vectorToBlob(vec);
    const f32 = EmbeddingService.vectorToFloat32Blob(vec);
    expect(f32.length).toBe(f64.length / 2);
  });
});

// ── sqlite-vec Utilities ────────────────────────────────────────────

describe('sqlite-vec utilities', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('isVecTableAvailable returns false when table does not exist', () => {
    expect(isVecTableAvailable(db)).toBe(false);
  });

  it('tryInitVecTable returns false when vec0 extension is not loaded', () => {
    // In-memory DB without sqlite-vec extension — vec0 module is unknown
    const result = tryInitVecTable(db);
    expect(result).toBe(false);
  });

  it('isVecTableAvailable returns false after failed tryInitVecTable', () => {
    tryInitVecTable(db);
    expect(isVecTableAvailable(db)).toBe(false);
  });
});

// ── HybridSearch Pipeline Stage ─────────────────────────────────────

describe('HybridSearch', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns results from FTS search', async () => {
    insertTestNode(db, { id: 'n1', content: 'React is a JavaScript library' });
    insertTestNode(db, { id: 'n2', content: 'Python is a programming language' });

    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const input: RetrievalPipelineData = {
      query: 'React',
      results: [],
    };

    const output = await stage.execute(input);
    expect(output).not.toBeNull();
    expect(output!.results.length).toBe(1);
    expect(output!.results[0].node.id).toBe('n1');
  });

  it('returns null for empty query', async () => {
    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const output = await stage.execute({ query: '', results: [] });
    expect(output).toBeNull();
  });

  it('returns null for whitespace-only query', async () => {
    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const output = await stage.execute({ query: '   ', results: [] });
    expect(output).toBeNull();
  });

  it('passes topic filter to retriever', async () => {
    insertTestNode(db, { id: 'n1', content: 'React decision', topic: 'decisions' });
    insertTestNode(db, { id: 'n2', content: 'React fact', topic: 'technical' });

    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const output = await stage.execute({
      query: 'React',
      topic: 'decisions',
      results: [],
    });

    expect(output).not.toBeNull();
    expect(output!.results.length).toBe(1);
    expect(output!.results[0].node.topic).toBe('decisions');
  });

  it('passes limit to retriever', async () => {
    for (let i = 0; i < 5; i++) {
      insertTestNode(db, { id: `n${i}`, content: `Memory about testing ${i}` });
    }

    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const output = await stage.execute({
      query: 'testing',
      limit: 2,
      results: [],
    });

    expect(output).not.toBeNull();
    expect(output!.results.length).toBe(2);
  });

  it('preserves input fields in output', async () => {
    insertTestNode(db, { id: 'n1', content: 'React library' });

    const retriever = new MemoryRetriever(db);
    const stage = new HybridSearch(retriever);

    const output = await stage.execute({
      query: 'React',
      topic: 'technical',
      limit: 5,
      results: [],
    });

    expect(output).not.toBeNull();
    expect(output!.query).toBe('React');
    expect(output!.topic).toBe('technical');
    expect(output!.limit).toBe(5);
  });
});

// ── Retriever vecAvailable ──────────────────────────────────────────

describe('MemoryRetriever vecAvailable', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns false when knowledge_vec table does not exist', () => {
    const retriever = new MemoryRetriever(db);
    expect(retriever.vecAvailable).toBe(false);
  });

  it('caches the vec availability check', () => {
    const retriever = new MemoryRetriever(db);

    // First access caches
    const first = retriever.vecAvailable;
    const second = retriever.vecAvailable;
    expect(first).toBe(second);
    expect(first).toBe(false);
  });

  it('resetVecCache clears the cached value', () => {
    const retriever = new MemoryRetriever(db);
    expect(retriever.vecAvailable).toBe(false);

    retriever.resetVecCache();
    // After reset, it re-checks (still false in test env)
    expect(retriever.vecAvailable).toBe(false);
  });
});
