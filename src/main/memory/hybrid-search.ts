/**
 * HybridSearch pipeline stage + sqlite-vec utilities.
 *
 * Wraps MemoryRetriever as a PipelineStage for the retrieval pipeline.
 * Provides utility functions for sqlite-vec table management (ANN search).
 *
 * When sqlite-vec is available:
 *   - Vector search uses ANN via knowledge_vec (O(log n))
 *   - Falls back to JS full-scan with event bus notification
 *
 * Without sqlite-vec:
 *   - Uses JS cosine similarity full-scan (existing behavior)
 */

import type Database from 'better-sqlite3';
import type { MemoryTopic, RetrievalResult } from '../../shared/memory-types';
import type { PipelineStage } from './pipeline';
import type { MemoryRetriever } from './retriever';
import { getMemoryEventBus } from './event-bus';

// ── Retrieval Pipeline Types ────────────────────────────────────────

/** Input/output data flowing through the retrieval pipeline. */
export interface RetrievalPipelineData {
  query: string;
  topic?: MemoryTopic;
  limit?: number;
  /** Populated by HybridSearch stage. */
  results: RetrievalResult[];
}

// ── sqlite-vec Utilities ────────────────────────────────────────────

/**
 * Check if the knowledge_vec virtual table exists.
 *
 * This indicates that sqlite-vec was loaded and the table was
 * successfully created. Cached per-call — the caller should
 * cache the result if checking frequently.
 */
export function isVecTableAvailable(db: Database.Database): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'",
    ).get();
    return row !== undefined;
  } catch {
    return false;
  }
}

/**
 * Try to create the knowledge_vec virtual table using sqlite-vec.
 *
 * Returns true if the table was created (or already exists).
 * Returns false if sqlite-vec is not loaded (vec0 module unavailable).
 *
 * @param dimension - Embedding vector dimension (default 1536 for OpenAI).
 */
export function tryInitVecTable(db: Database.Database, dimension = 1536): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
        node_id TEXT PRIMARY KEY,
        embedding float[${dimension}]
      )
    `);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upsert a node's embedding into the knowledge_vec table.
 *
 * The float32Blob should be created with EmbeddingService.vectorToFloat32Blob().
 * Uses DELETE + INSERT since vec0 doesn't support INSERT OR REPLACE.
 */
export function upsertVecEmbedding(
  db: Database.Database,
  nodeId: string,
  float32Blob: Buffer,
): void {
  db.prepare('DELETE FROM knowledge_vec WHERE node_id = ?').run(nodeId);
  db.prepare(
    'INSERT INTO knowledge_vec (node_id, embedding) VALUES (?, ?)',
  ).run(nodeId, float32Blob);
}

/**
 * Remove a node's embedding from the knowledge_vec table.
 */
export function deleteVecEmbedding(db: Database.Database, nodeId: string): void {
  db.prepare('DELETE FROM knowledge_vec WHERE node_id = ?').run(nodeId);
}

/**
 * Sync all embeddings from knowledge_nodes to knowledge_vec.
 *
 * Used after initial sqlite-vec setup to populate the ANN index
 * from existing float64 BLOB embeddings.
 *
 * @returns Number of embeddings synced.
 */
export function syncAllEmbeddingsToVec(
  db: Database.Database,
  vectorToFloat32: (blob: Buffer) => Buffer,
): number {
  const rows = db.prepare(
    `SELECT id, embedding FROM knowledge_nodes
     WHERE embedding IS NOT NULL AND deleted_at IS NULL`,
  ).all() as Array<{ id: string; embedding: Buffer }>;

  if (rows.length === 0) return 0;

  const deleteStmt = db.prepare('DELETE FROM knowledge_vec WHERE node_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO knowledge_vec (node_id, embedding) VALUES (?, ?)',
  );

  const syncAll = db.transaction(() => {
    for (const row of rows) {
      const float32 = vectorToFloat32(row.embedding);
      deleteStmt.run(row.id);
      insertStmt.run(row.id, float32);
    }
  });

  syncAll();
  return rows.length;
}

// ── HybridSearch Pipeline Stage ─────────────────────────────────────

/**
 * Pipeline stage that performs hybrid search (FTS5 + Vector + Graph).
 *
 * Delegates to MemoryRetriever.search() for the actual search logic.
 * The retriever handles sqlite-vec ANN vs JS fallback internally.
 */
export class HybridSearch implements PipelineStage<RetrievalPipelineData, RetrievalPipelineData> {
  readonly name = 'HybridSearch';
  private readonly retriever: MemoryRetriever;

  constructor(retriever: MemoryRetriever) {
    this.retriever = retriever;
  }

  async execute(input: RetrievalPipelineData): Promise<RetrievalPipelineData | null> {
    if (!input.query || input.query.trim().length === 0) {
      return null;
    }

    try {
      const results = await this.retriever.search(input.query, {
        topic: input.topic,
        limit: input.limit,
      });

      return { ...input, results };
    } catch (err: unknown) {
      getMemoryEventBus().emitError(
        'fts_query_failed',
        'HybridSearch stage failed',
        { error: err instanceof Error ? err : new Error(String(err)) },
      );
      return { ...input, results: [] };
    }
  }
}
