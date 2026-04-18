/**
 * Hybrid memory retriever: FTS5 + vector + knowledge graph.
 *
 * Phase 3-a: FTS5 full-text search only.
 * Phase 3-b: Vector similarity + knowledge graph expansion + weighted fusion.
 *
 * Uses Stanford 3-factor scoring (recency x relevance x importance)
 * across all retrieval sources. When an EmbeddingService is available,
 * results from vector, FTS, and graph are fused with configurable weights.
 * Falls back to FTS-only when no embedding service is provided.
 */

import type Database from 'better-sqlite3';
import { getMemoryEventBus } from './event-bus';
import type {
  KnowledgeNode,
  MemoryConfig,
  MemoryTopic,
  RetrievalResult,
} from '../../shared/memory-types';
import { DEFAULT_MEMORY_CONFIG } from '../../shared/memory-types';
import { computeRecency, computeCombinedScore } from './scorer';
import { EmbeddingService } from './embedding-service';
import { isVecTableAvailable } from './hybrid-search';

/** Raw row from knowledge_nodes query. */
interface NodeRow {
  id: string;
  content: string;
  node_type: string;
  topic: string;
  importance: number;
  source: string;
  pinned: number;
  conversation_id: string | null;
  message_id: string | null;
  last_accessed: string | null;
  created_at: string;
  updated_at: string;
  embedding_version: string | null;
  extractor_version: string | null;
  source_hash: string | null;
  dedupe_key: string | null;
  deleted_at: string | null;
  participant_id: string | null;
  last_mentioned_at: string | null;
  mention_count: number;
  confidence: number;
  rank?: number;
  embedding?: Buffer | null;
}

/**
 * Convert a database row to a KnowledgeNode.
 */
function rowToNode(row: NodeRow): KnowledgeNode {
  return {
    id: row.id,
    content: row.content,
    nodeType: row.node_type as KnowledgeNode['nodeType'],
    topic: row.topic as KnowledgeNode['topic'],
    importance: row.importance,
    source: row.source as KnowledgeNode['source'],
    pinned: row.pinned === 1,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    lastAccessed: row.last_accessed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embeddingVersion: row.embedding_version,
    extractorVersion: row.extractor_version,
    sourceHash: row.source_hash,
    dedupeKey: row.dedupe_key,
    deletedAt: row.deleted_at,
    participantId: row.participant_id,
    lastMentionedAt: row.last_mentioned_at,
    mentionCount: row.mention_count ?? 0,
    confidence: row.confidence ?? 0.5,
  };
}

/** Internal scored entry keyed by node ID for fusion. */
interface ScoredEntry {
  node: KnowledgeNode;
  score: number;
  source: RetrievalResult['source'];
}

/**
 * Hybrid memory retriever with 3-factor scoring and multi-source fusion.
 *
 * Sources (when enabled):
 *   1. FTS5 full-text search (BM25 rank)
 *   2. Vector similarity (cosine) on embeddings
 *   3. Knowledge graph expansion (BFS from top results)
 *
 * Results are fused: if the same node appears in multiple sources,
 * scores are combined with configurable source weights.
 */
export class MemoryRetriever {
  private readonly db: Database.Database;
  private readonly config: MemoryConfig;
  private embeddingService: EmbeddingService | null;
  private _vecAvailable: boolean | null = null;

  constructor(
    db: Database.Database,
    config?: Partial<MemoryConfig>,
    embeddingService?: EmbeddingService,
  ) {
    this.db = db;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.embeddingService = embeddingService ?? null;
  }

  /** Whether the sqlite-vec knowledge_vec table is available for ANN search. */
  get vecAvailable(): boolean {
    if (this._vecAvailable === null) {
      this._vecAvailable = isVecTableAvailable(this.db);
    }
    return this._vecAvailable;
  }

  /** Reset the cached vec availability flag (e.g., after loading sqlite-vec). */
  resetVecCache(): void {
    this._vecAvailable = null;
  }

  /**
   * Set or replace the embedding service (allows lazy initialization).
   */
  setEmbeddingService(service: EmbeddingService): void {
    this.embeddingService = service;
  }

  /**
   * Search for relevant memories using hybrid retrieval.
   *
   * When vector search is enabled and an embedding service is available,
   * combines FTS5, vector, and graph results with weighted fusion.
   * Otherwise falls back to FTS5-only search.
   */
  async search(
    query: string,
    options?: { topic?: MemoryTopic; limit?: number },
  ): Promise<RetrievalResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const limit = options?.limit ?? this.config.retrievalLimit;
    const topic = options?.topic;
    const useVector = this.config.vectorEnabled && this.embeddingService?.available === true;
    const useGraph = this.config.graphEnabled;

    // FTS5 search (always runs when enabled)
    const ftsScores = this.config.ftsEnabled
      ? this.ftsSearchScored(query, topic, limit * 3)
      : new Map<string, ScoredEntry>();

    // Vector search (when available)
    let vectorScores = new Map<string, ScoredEntry>();
    if (useVector && this.embeddingService) {
      vectorScores = await this.vectorSearch(query, topic, limit * 3);
    }

    // Graph expansion from top seeds
    let graphScores = new Map<string, ScoredEntry>();
    if (useGraph && (ftsScores.size > 0 || vectorScores.size > 0)) {
      const seedIds = this.getSeedIds(ftsScores, vectorScores, 5);
      graphScores = this.graphExpand(seedIds);
    }

    // Fuse or use single source
    let results: RetrievalResult[];
    if (useVector || useGraph) {
      results = this.fuseResults(ftsScores, vectorScores, graphScores);
    } else {
      results = Array.from(ftsScores.values());
    }

    if (results.length === 0) {
      return [];
    }

    // Apply pin boost
    const pinBoost = this.config.pinSearchBoost;
    results = results.map((r) => ({
      ...r,
      score: r.node.pinned ? Math.min(1.0, r.score * pinBoost) : r.score,
    }));

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);

    // Touch accessed nodes to update recency
    this.touchNodes(results.map((r) => r.node.id));

    return results;
  }

  /**
   * Get a single knowledge node by ID.
   */
  getNode(id: string): KnowledgeNode | null {
    const row = this.db
      .prepare(
        `SELECT * FROM knowledge_nodes WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as NodeRow | undefined;

    return row ? rowToNode(row) : null;
  }

  /**
   * Get all pinned knowledge nodes.
   */
  getPinnedNodes(topic?: MemoryTopic): KnowledgeNode[] {
    let sql = `SELECT * FROM knowledge_nodes WHERE pinned = 1 AND deleted_at IS NULL`;
    const params: unknown[] = [];

    if (topic) {
      sql += ` AND topic = ?`;
      params.push(topic);
    }

    sql += ` ORDER BY importance DESC, created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map(rowToNode);
  }

  // ── FTS5 Search ────────────────────────────────────────────────────

  /**
   * Execute FTS5 search and return scored entries keyed by node ID.
   */
  private ftsSearchScored(
    query: string,
    topic: MemoryTopic | undefined,
    fetchLimit: number,
  ): Map<string, ScoredEntry> {
    const safeQuery = this.escapeFtsQuery(query);
    if (!safeQuery) {
      return new Map();
    }

    let sql: string;
    const params: unknown[] = [];

    if (topic) {
      sql = `
        SELECT kn.*, kf.rank
        FROM knowledge_fts kf
        JOIN knowledge_nodes kn ON kn.rowid = kf.rowid
        WHERE knowledge_fts MATCH ?
          AND kn.deleted_at IS NULL
          AND kn.topic = ?
        ORDER BY kf.rank
        LIMIT ?
      `;
      params.push(safeQuery, topic, fetchLimit);
    } else {
      sql = `
        SELECT kn.*, kf.rank
        FROM knowledge_fts kf
        JOIN knowledge_nodes kn ON kn.rowid = kf.rowid
        WHERE knowledge_fts MATCH ?
          AND kn.deleted_at IS NULL
        ORDER BY kf.rank
        LIMIT ?
      `;
      params.push(safeQuery, fetchLimit);
    }

    let rows: NodeRow[];
    try {
      rows = this.db.prepare(sql).all(...params) as NodeRow[];
    } catch (err: unknown) {
      getMemoryEventBus().emitError('fts_query_failed', `FTS5 query failed for: ${query}`, {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return new Map();
    }

    if (rows.length === 0) {
      return new Map();
    }

    // Normalize FTS5 ranks to [0, 1]
    const ranks = rows.map((r) => r.rank ?? 0);
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);
    const rankRange = maxRank - minRank;

    const scored = new Map<string, ScoredEntry>();
    for (const row of rows) {
      const node = rowToNode(row);
      const rawRelevance =
        rankRange !== 0 ? (maxRank - (row.rank ?? 0)) / rankRange : 1.0;
      const relevance = Math.max(this.config.ftsRelevanceFloor, rawRelevance);

      const recency = computeRecency(
        node.lastAccessed ?? node.createdAt,
        this.config.recencyHalfLifeDays,
      );

      const score = computeCombinedScore(
        recency,
        relevance,
        node.importance,
        this.config.scoringWeights,
      );

      scored.set(node.id, { node, score, source: 'fts' });
    }

    return scored;
  }

  // ── Vector Search ──────────────────────────────────────────────────

  /**
   * Embed query and rank against stored embeddings.
   *
   * When sqlite-vec is available (knowledge_vec table exists), uses
   * ANN search for O(log n) performance. Otherwise falls back to
   * JS-side cosine similarity full scan.
   */
  private async vectorSearch(
    query: string,
    topic: MemoryTopic | undefined,
    fetchLimit: number,
  ): Promise<Map<string, ScoredEntry>> {
    if (!this.embeddingService) {
      return new Map();
    }

    const queryVec = await this.embeddingService.embedText(query);
    if (!queryVec) {
      return new Map();
    }

    // Try ANN search via sqlite-vec
    if (this.vecAvailable) {
      try {
        return this.vectorSearchANN(queryVec, topic, fetchLimit);
      } catch (err: unknown) {
        getMemoryEventBus().emitError(
          'vector_search_fallback',
          'sqlite-vec ANN search failed, falling back to JS full-scan',
          { error: err instanceof Error ? err : new Error(String(err)) },
        );
        // Fall through to JS scan
      }
    }

    // JS full-scan fallback
    return this.vectorSearchFullScan(queryVec, topic, fetchLimit);
  }

  /**
   * ANN vector search via sqlite-vec knowledge_vec table.
   *
   * Uses vec0 MATCH query for approximate nearest neighbor search.
   * Joins with knowledge_nodes for metadata and scoring.
   */
  private vectorSearchANN(
    queryVec: number[],
    topic: MemoryTopic | undefined,
    fetchLimit: number,
  ): Map<string, ScoredEntry> {
    const scored = new Map<string, ScoredEntry>();

    const float32Blob = EmbeddingService.vectorToFloat32Blob(queryVec);

    // sqlite-vec returns results ordered by distance (L2)
    let sql: string;
    const params: unknown[] = [];

    if (topic) {
      sql = `
        SELECT kv.node_id, kv.distance, kn.*
        FROM knowledge_vec kv
        JOIN knowledge_nodes kn ON kn.id = kv.node_id
        WHERE kv.embedding MATCH ?
          AND kn.deleted_at IS NULL
          AND kn.topic = ?
        ORDER BY kv.distance
        LIMIT ?
      `;
      params.push(float32Blob, topic, fetchLimit);
    } else {
      sql = `
        SELECT kv.node_id, kv.distance, kn.*
        FROM knowledge_vec kv
        JOIN knowledge_nodes kn ON kn.id = kv.node_id
        WHERE kv.embedding MATCH ?
          AND kn.deleted_at IS NULL
        ORDER BY kv.distance
        LIMIT ?
      `;
      params.push(float32Blob, fetchLimit);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<NodeRow & { distance: number }>;

    if (rows.length === 0) return scored;

    // Convert L2 distance to similarity score [0, 1]
    const maxDist = Math.max(...rows.map((r) => r.distance));

    for (const row of rows) {
      const node = rowToNode(row);
      const similarity = maxDist > 0 ? 1 - row.distance / (maxDist + 1) : 1.0;

      const recency = computeRecency(
        node.lastAccessed ?? node.createdAt,
        this.config.recencyHalfLifeDays,
      );

      const score = computeCombinedScore(
        recency,
        similarity,
        node.importance,
        this.config.scoringWeights,
      );

      scored.set(node.id, { node, score, source: 'vector' });
    }

    return scored;
  }

  /**
   * JS-side cosine similarity full scan (fallback when sqlite-vec is unavailable).
   */
  private vectorSearchFullScan(
    queryVec: number[],
    topic: MemoryTopic | undefined,
    fetchLimit: number,
  ): Map<string, ScoredEntry> {
    const scored = new Map<string, ScoredEntry>();

    // Get candidates with embeddings
    let sql = `SELECT * FROM knowledge_nodes WHERE embedding IS NOT NULL AND deleted_at IS NULL`;
    const params: unknown[] = [];

    if (topic) {
      sql += ` AND topic = ?`;
      params.push(topic);
    }

    sql += ` LIMIT ?`;
    params.push(fetchLimit);

    const candidates = this.db.prepare(sql).all(...params) as NodeRow[];
    if (candidates.length === 0) {
      return scored;
    }

    // Build candidate list for ranking
    const embeddingCandidates: Array<{ id: string; embedding: Buffer }> = [];
    for (const row of candidates) {
      if (row.embedding) {
        embeddingCandidates.push({ id: row.id, embedding: row.embedding as Buffer });
      }
    }

    const ranked = new EmbeddingService().rankBySimilarity(queryVec, embeddingCandidates);

    // Build node map for scoring
    const nodeMap = new Map<string, KnowledgeNode>();
    for (const row of candidates) {
      nodeMap.set(row.id, rowToNode(row));
    }

    for (const { id, similarity } of ranked) {
      const node = nodeMap.get(id);
      if (!node || similarity <= 0) continue;

      const recency = computeRecency(
        node.lastAccessed ?? node.createdAt,
        this.config.recencyHalfLifeDays,
      );

      const score = computeCombinedScore(
        recency,
        similarity,
        node.importance,
        this.config.scoringWeights,
      );

      scored.set(id, { node, score, source: 'vector' });
    }

    return scored;
  }

  // ── Graph Expansion ────────────────────────────────────────────────

  /**
   * BFS expansion from seed nodes using knowledge edges.
   */
  private graphExpand(seedIds: string[]): Map<string, ScoredEntry> {
    const scored = new Map<string, ScoredEntry>();
    if (seedIds.length === 0) return scored;

    const maxHops = this.config.graphMaxHops;
    const visited = new Set(seedIds);
    let frontier = seedIds;

    for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
      const placeholders = frontier.map(() => '?').join(',');
      const edges = this.db
        .prepare(
          `SELECT target_node_id as target_id, weight FROM knowledge_edges
           WHERE source_node_id IN (${placeholders})
           UNION
           SELECT source_node_id as target_id, weight FROM knowledge_edges
           WHERE target_node_id IN (${placeholders})`,
        )
        .all(...frontier, ...frontier) as Array<{
        target_id: string;
        weight: number;
      }>;

      const nextFrontier: string[] = [];
      for (const edge of edges) {
        if (visited.has(edge.target_id)) continue;
        visited.add(edge.target_id);
        nextFrontier.push(edge.target_id);

        const row = this.db
          .prepare(
            `SELECT * FROM knowledge_nodes WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(edge.target_id) as NodeRow | undefined;

        if (!row) continue;

        const node = rowToNode(row);
        const recency = computeRecency(
          node.lastAccessed ?? node.createdAt,
          this.config.recencyHalfLifeDays,
        );

        // Use edge weight as relevance proxy, decay by hop distance
        const relevance = edge.weight * Math.pow(this.config.graphHopDecay, hop);

        const score = computeCombinedScore(
          recency,
          relevance,
          node.importance,
          this.config.scoringWeights,
        );

        scored.set(node.id, { node, score, source: 'graph' });
      }

      frontier = nextFrontier;
    }

    return scored;
  }

  // ── Fusion ─────────────────────────────────────────────────────────

  /**
   * Pick top node IDs from FTS + vector results as graph seeds.
   */
  private getSeedIds(
    ftsScores: Map<string, ScoredEntry>,
    vectorScores: Map<string, ScoredEntry>,
    topK: number,
  ): string[] {
    const merged = new Map<string, number>();

    for (const [id, entry] of ftsScores) {
      merged.set(id, (merged.get(id) ?? 0) + entry.score);
    }
    for (const [id, entry] of vectorScores) {
      merged.set(id, (merged.get(id) ?? 0) + entry.score);
    }

    return Array.from(merged.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);
  }

  /**
   * Weighted fusion of scores from multiple retrieval sources.
   *
   * If a node appears in multiple sources, combine with source weights.
   */
  private fuseResults(
    ftsScores: Map<string, ScoredEntry>,
    vectorScores: Map<string, ScoredEntry>,
    graphScores: Map<string, ScoredEntry>,
  ): RetrievalResult[] {
    const allIds = new Set([
      ...ftsScores.keys(),
      ...vectorScores.keys(),
      ...graphScores.keys(),
    ]);

    const { vector: wVector, fts: wFts, graph: wGraph } = this.config.fusionWeights;
    const results: RetrievalResult[] = [];

    for (const id of allIds) {
      const v = vectorScores.get(id);
      const f = ftsScores.get(id);
      const g = graphScores.get(id);

      let weightedSum = 0;
      let totalWeight = 0;

      if (v) {
        weightedSum += wVector * v.score;
        totalWeight += wVector;
      }
      if (f) {
        weightedSum += wFts * f.score;
        totalWeight += wFts;
      }
      if (g) {
        weightedSum += wGraph * g.score;
        totalWeight += wGraph;
      }

      if (totalWeight === 0) continue;

      const fusedScore = weightedSum / totalWeight;

      // Determine primary source and pick node from best source
      let primarySource: RetrievalResult['source'] = 'fts';
      let node: KnowledgeNode;
      if (v && (!f || v.score >= f.score) && (!g || v.score >= g.score)) {
        primarySource = 'vector';
        node = v.node;
      } else if (g && (!f || g.score >= f.score)) {
        primarySource = 'graph';
        node = g.node;
      } else if (f) {
        node = f.node;
      } else {
        continue;
      }

      results.push({ node, score: fusedScore, source: primarySource });
    }

    return results;
  }

  // ── Common Helpers ─────────────────────────────────────────────────

  /**
   * Update last_accessed timestamp for retrieved nodes.
   */
  private touchNodes(nodeIds: string[]): void {
    if (nodeIds.length === 0) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE knowledge_nodes SET last_accessed = ? WHERE id = ?`,
    );

    const updateMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        stmt.run(now, id);
      }
    });

    updateMany(nodeIds);
  }

  /**
   * Escape a user query for safe FTS5 MATCH usage.
   */
  private escapeFtsQuery(query: string): string {
    const words = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, '""')}"`);

    return words.join(' ');
  }
}
