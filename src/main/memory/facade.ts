/**
 * MemoryFacade: top-level coordinator for the memory system.
 *
 * Integrates retriever, extractor, scorer, assembler, evolver, and
 * reflector behind a single interface. Uses pipeline orchestration
 * for both storage and retrieval paths.
 *
 * Services are injected at construction time (no setter pattern).
 */

import { randomUUID, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  KnowledgeNode,
  KnowledgeNodeCreate,
  MemoryConfig,
  MemoryTopic,
  RetrievalResult,
  AssembledContext,
  MemorySearchResult,
  ExtractionResult,
  EvolutionResult,
  ReflectionResult,
} from '../../shared/memory-types';
import { DEFAULT_MEMORY_CONFIG } from '../../shared/memory-types';
import { MemoryRetriever } from './retriever';
import { RegexExtractor } from './extractor';
import { ContextAssembler } from './assembler';
import { EmbeddingService } from './embedding-service';
import type { MemoryEvolver } from './evolver';
import { getMemoryEventBus } from './event-bus';
import type { ReflectionEngine } from './reflector';
import { isVecTableAvailable, upsertVecEmbedding } from './hybrid-search';
import { Pipeline } from './pipeline';
import type { AnnotatedMessage } from './pipeline';
import { ExtractionStage, RegexStrategy } from './extraction-strategy';
import type { ExtractionStrategy, ExtractionStageInput } from './extraction-strategy';
import { LlmStrategy } from './llm-strategy';
import {
  ParticipantTagger,
  ReMentionDetector,
  ConflictChecker,
  StorageStage,
} from './storage-stages';
import type { StorageResult } from './storage-stages';
import { HybridSearch } from './hybrid-search';
import type { RetrievalPipelineData } from './hybrid-search';
import { Reranker } from './reranker';

// ── Service injection interface ─────────────────────────────────────

/** Optional services for the memory facade. */
export interface MemoryServices {
  /** Embedding service for vector operations. */
  embeddingService?: EmbeddingService;
  /** Memory evolver for merge/prune. */
  evolver?: MemoryEvolver;
  /** Reflection engine for insight generation. */
  reflector?: ReflectionEngine;
  /** LLM function for LLM-based extraction (enables LlmStrategy). */
  llmExtractFn?: (system: string, user: string) => Promise<string>;
}

// ── Facade ──────────────────────────────────────────────────────────

/**
 * Unified interface for the memory system.
 *
 * Coordinates retrieval, extraction, context assembly,
 * evolution, and reflection. Acts as the single entry point
 * for all memory operations.
 *
 * All services are injected at construction time.
 */
export class MemoryFacade {
  private readonly db: Database.Database;
  private readonly config: MemoryConfig;
  private readonly retriever: MemoryRetriever;
  private readonly extractor: RegexExtractor;
  private readonly assembler: ContextAssembler;
  private readonly embeddingService: EmbeddingService | null;
  private readonly evolver: MemoryEvolver | null;
  private readonly reflector: ReflectionEngine | null;
  private readonly extractionStrategy: ExtractionStrategy;

  constructor(
    db: Database.Database,
    config?: Partial<MemoryConfig>,
    services?: MemoryServices,
  ) {
    this.db = db;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.embeddingService = services?.embeddingService ?? null;
    this.evolver = services?.evolver ?? null;
    this.reflector = services?.reflector ?? null;

    this.retriever = new MemoryRetriever(db, this.config, this.embeddingService ?? undefined);
    this.extractor = new RegexExtractor(this.config);
    this.assembler = new ContextAssembler(this.config);

    // Choose extraction strategy based on config
    if (this.config.extractionLlmProviderId && services?.llmExtractFn) {
      this.extractionStrategy = new LlmStrategy(services.llmExtractFn);
    } else {
      this.extractionStrategy = new RegexStrategy(this.config);
    }
  }

  // ── Store Operations ──────────────────────────────────────────────

  /**
   * Store a new knowledge node.
   *
   * @returns The created node's ID.
   */
  storeNode(data: KnowledgeNodeCreate): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    const sourceHash = data.sourceHash ?? this.computeHash(data.content);
    const dedupeKey = data.dedupeKey ?? this.computeDedupeKey(data.content);

    // Check for duplicates
    if (this.isDuplicate(dedupeKey)) {
      const existing = this.findByDedupeKey(dedupeKey);
      if (existing) return existing.id;
    }

    this.db
      .prepare(
        `INSERT INTO knowledge_nodes
         (id, content, node_type, topic, importance, source, pinned,
          conversation_id, message_id, last_accessed, created_at, updated_at,
          source_hash, dedupe_key, participant_id, confidence)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.content,
        data.nodeType,
        data.topic,
        data.importance,
        data.source,
        data.conversationId ?? null,
        data.messageId ?? null,
        now,
        now,
        now,
        sourceHash,
        dedupeKey,
        data.participantId ?? null,
        data.confidence ?? 0.5,
      );

    // FTS5 sync is handled automatically by the knowledge_fts_insert trigger.

    // Queue async embedding generation (fire-and-forget)
    if (this.embeddingService?.available) {
      void this.embedAndUpdate(id, data.content);
    }

    return id;
  }

  /**
   * Pin a message to memory.
   *
   * If the message content is already in memory (auto-extracted),
   * boosts its importance. Otherwise creates a new pinned node.
   *
   * @returns The knowledge node ID.
   */
  pinMessage(
    messageId: string,
    content: string,
    topic: MemoryTopic,
  ): string {
    // Check if this message is already in memory
    const existing = this.db
      .prepare(
        `SELECT id, importance FROM knowledge_nodes
         WHERE message_id = ? AND deleted_at IS NULL`,
      )
      .get(messageId) as { id: string; importance: number } | undefined;

    if (existing) {
      // Boost importance and mark as pinned
      const boosted = Math.min(1.0, existing.importance + this.config.pinImportanceBoost);
      this.db
        .prepare(
          `UPDATE knowledge_nodes
           SET pinned = 1, importance = ?, topic = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(boosted, topic, new Date().toISOString(), existing.id);
      return existing.id;
    }

    // Create new pinned node, then mark as pinned
    const id = this.storeNode({
      content,
      nodeType: 'fact',
      topic,
      importance: this.config.pinDefaultImportance,
      source: 'pin',
      messageId,
    });

    this.db
      .prepare(`UPDATE knowledge_nodes SET pinned = 1, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);

    return id;
  }

  // ── Search Operations ─────────────────────────────────────────────

  /**
   * Search memory using hybrid retrieval (FTS5 + vector + graph).
   *
   * This is a direct search — no retrieval gate is applied.
   * Use getAssembledContext() for gated, pipeline-based retrieval.
   */
  async search(
    query: string,
    options?: { topic?: MemoryTopic; limit?: number },
  ): Promise<RetrievalResult[]> {
    return this.retriever.search(query, options);
  }

  /**
   * Search memory and return serializable results for IPC transport.
   */
  async searchForIpc(
    query: string,
    options?: { topic?: MemoryTopic; limit?: number },
  ): Promise<MemorySearchResult[]> {
    const results = await this.retriever.search(query, options);
    return results.map((r) => ({
      id: r.node.id,
      content: r.node.content,
      nodeType: r.node.nodeType,
      topic: r.node.topic,
      importance: r.node.importance,
      score: r.score,
      pinned: r.node.pinned,
      createdAt: r.node.createdAt,
    }));
  }

  /**
   * Get a knowledge node by ID.
   */
  getNode(id: string): KnowledgeNode | null {
    return this.retriever.getNode(id);
  }

  /**
   * Get all pinned knowledge nodes.
   */
  getPinnedNodes(topic?: MemoryTopic): KnowledgeNode[] {
    return this.retriever.getPinnedNodes(topic);
  }

  // ── Extraction (Pipeline) ─────────────────────────────────────────

  /**
   * Extract and store memories from conversation messages.
   *
   * Runs the full storage pipeline:
   *   ExtractionStage → ParticipantTagger → ReMentionDetector
   *   → ConflictChecker → StorageStage
   *
   * @returns Number of new nodes created.
   */
  async extractAndStorePipeline(
    messages: AnnotatedMessage[],
    conversationId?: string,
  ): Promise<StorageResult> {
    const pipeline = Pipeline.create<ExtractionStageInput>('storage')
      .addStage(new ExtractionStage(this.extractionStrategy, this.config))
      .addStage(new ParticipantTagger())
      .addStage(new ReMentionDetector(this.db, this.config))
      .addStage(new ConflictChecker(this.db))
      .addStage(new StorageStage(this.db, this.config));

    const result = await pipeline.execute({ messages, conversationId });

    if (result.output) {
      // Queue embedding for newly stored items
      if (this.embeddingService?.available) {
        void this.embedNewNodes();
      }
      return result.output;
    }

    return { stored: 0, skipped: 0, mentions: 0, conflicts: 0 };
  }

  /**
   * Extract and store memories (synchronous compatibility path).
   *
   * Uses regex-based extraction for backward compatibility with
   * existing callers. For the full pipeline, use extractAndStorePipeline().
   *
   * @returns Number of new nodes created.
   */
  extractAndStore(
    messages: Array<{ content: string; participantId: string }>,
    conversationId?: string,
  ): number {
    const result = this.extractor.extractFromMessages(messages);

    if (result.items.length === 0) {
      return 0;
    }

    let created = 0;
    for (const item of result.items) {
      if (item.importance < this.config.extractionMinImportance) {
        continue;
      }

      const dedupeKey = this.computeDedupeKey(item.content);
      if (this.isDuplicate(dedupeKey)) {
        continue;
      }

      this.storeNode({
        content: item.content,
        nodeType: item.nodeType,
        topic: item.topic,
        importance: item.importance,
        source: 'auto',
        conversationId,
        participantId: item.participantId,
        confidence: item.confidence,
      });
      created++;
    }

    return created;
  }

  /**
   * Extract items from text without storing (for preview/testing).
   */
  extractOnly(
    messages: Array<{ content: string; participantId: string }>,
  ): ExtractionResult {
    return this.extractor.extractFromMessages(messages);
  }

  // ── Context Assembly (Pipeline) ───────────────────────────────────

  /**
   * Retrieve relevant memories and assemble them into prompt context.
   *
   * Runs the retrieval pipeline:
   *   HybridSearch → Reranker → ContextAssembler
   *
   * No RetrievalGate here — this is an explicit API call where the
   * caller has already decided they want memory context. The gate
   * is available separately for automated "should we search?" decisions.
   */
  async getAssembledContext(params: {
    query: string;
    systemPrompt?: string;
    recentHistory?: string;
    userMessage?: string;
    topic?: MemoryTopic;
  }): Promise<AssembledContext> {
    // Run retrieval pipeline (search → rerank)
    const retrievalPipeline = Pipeline.create<RetrievalPipelineData>('retrieval')
      .addStage(new HybridSearch(this.retriever))
      .addStage(new Reranker(this.config));

    const pipelineResult = await retrievalPipeline.execute({
      query: params.query,
      topic: params.topic,
      results: [],
    });

    const memories = pipelineResult.output?.results ?? [];

    return this.assembler.assemble({
      memories,
      systemPrompt: params.systemPrompt,
      recentHistory: params.recentHistory,
      userMessage: params.userMessage,
    });
  }

  // ── Evolution (Phase 3-b) ─────────────────────────────────────────

  /**
   * Run memory evolution: merge similar nodes and prune stale ones.
   */
  evolve(): EvolutionResult {
    if (!this.evolver) {
      return { merged: 0, pruned: 0 };
    }
    return this.evolver.evolve();
  }

  // ── Reflection (Phase 3-b) ────────────────────────────────────────

  /**
   * Check if enough nodes have accumulated for reflection.
   */
  shouldReflect(): boolean {
    if (!this.reflector) return false;
    return this.reflector.shouldReflect();
  }

  /**
   * Run the reflection engine to generate insights.
   */
  async reflect(): Promise<ReflectionResult> {
    if (!this.reflector) {
      return { insightsCreated: 0, nodesProcessed: 0 };
    }
    return this.reflector.reflect();
  }

  // ── Embedding Operations (Phase 3-b) ─────────────────────────────

  /**
   * Generate and store an embedding for a single node.
   */
  private async embedAndUpdate(nodeId: string, content: string): Promise<void> {
    if (!this.embeddingService) return;

    try {
      const vec = await this.embeddingService.embedText(content);
      if (!vec) return;

      // Write float64 BLOB to knowledge_nodes (used by evolver comparisons)
      const blob = EmbeddingService.vectorToBlob(vec);
      this.db
        .prepare(
          `UPDATE knowledge_nodes
           SET embedding = ?, embedding_version = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(blob, this.embeddingService.modelId, new Date().toISOString(), nodeId);

      // Dual-write float32 to knowledge_vec for ANN search (when sqlite-vec is available)
      if (isVecTableAvailable(this.db)) {
        const float32Blob = EmbeddingService.vectorToFloat32Blob(vec);
        upsertVecEmbedding(this.db, nodeId, float32Blob);
      }
    } catch (err: unknown) {
      getMemoryEventBus().emitError('embedding_failed', 'Embedding generation failed', {
        nodeId,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  /**
   * Embed all nodes that don't yet have an embedding.
   */
  async embedUnembeddedNodes(limit = 50): Promise<number> {
    if (!this.embeddingService?.available) return 0;

    const rows = this.db
      .prepare(
        `SELECT id, content FROM knowledge_nodes
         WHERE embedding IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; content: string }>;

    let count = 0;
    for (const row of rows) {
      await this.embedAndUpdate(row.id, row.content);
      count++;
    }

    return count;
  }

  /**
   * Embed recently stored nodes (called after pipeline storage).
   */
  private async embedNewNodes(): Promise<void> {
    await this.embedUnembeddedNodes(20);
  }

  /**
   * Reindex all node embeddings using the current embedding service.
   */
  async reindexEmbeddings(batchSize = 50): Promise<number> {
    if (!this.embeddingService?.available) return 0;

    this.db
      .prepare(
        `UPDATE knowledge_nodes
         SET embedding = NULL, embedding_version = NULL
         WHERE deleted_at IS NULL`,
      )
      .run();

    let total = 0;
    let processed: number;
    do {
      processed = await this.embedUnembeddedNodes(batchSize);
      total += processed;
    } while (processed === batchSize);

    return total;
  }

  // ── Soft Delete ───────────────────────────────────────────────────

  /**
   * Soft-delete a knowledge node.
   */
  deleteNode(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE knowledge_nodes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);

    return result.changes > 0;
  }

  // ── Private Helpers ───────────────────────────────────────────────

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private computeDedupeKey(content: string): string {
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  private isDuplicate(dedupeKey: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM knowledge_nodes WHERE dedupe_key = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(dedupeKey);

    return row !== undefined;
  }

  private findByDedupeKey(dedupeKey: string): { id: string } | null {
    const row = this.db
      .prepare(
        `SELECT id FROM knowledge_nodes WHERE dedupe_key = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(dedupeKey) as { id: string } | undefined;

    return row ?? null;
  }
}
