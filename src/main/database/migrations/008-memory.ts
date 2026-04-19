/**
 * Migration 008-memory: knowledge graph + FTS5 + enhancement (v2 port).
 *
 * Ports v2 memory schema (FTS5 + embedding hooks + reflection columns + evolution
 * tracking) verbatim from `_legacy/migrations-v2/001-initial-schema.ts`
 * (memory tables only) plus `_legacy/migrations-v2/004-memory-enhancement.ts`.
 *
 * Per spec §5.2 008 the memory subsystem is **독립 (independent)**: it must not
 * reference v3-side messages or conversations. v2 already kept `conversation_id`
 * and `message_id` on `knowledge_nodes` as plain TEXT columns (no FK), so the
 * port is straightforward — those columns are preserved as opaque correlation
 * ids that the memory service interprets, with no foreign-key linkage to any
 * v3 table.
 *
 * Tables ported:
 * - knowledge_nodes (v2 001) — full column set including operational fields
 *   (embedding, importance, source_hash, dedupe_key, soft-delete) AND v2 004
 *   enhancement columns merged inline (participant_id, last_mentioned_at,
 *   mention_count, confidence) so the table is created in its final shape in
 *   one statement (v2 used ALTER TABLE; v3 starts fresh, so no ALTER needed).
 * - knowledge_fts (v2 001) — FTS5 contentless-mode index over knowledge_nodes.content
 * - knowledge_edges (v2 001) — graph edges with FK to knowledge_nodes(id). No FK
 *   ON DELETE clause specified (matches v2 default = NO ACTION).
 *
 * Indexes/triggers ported:
 * - All 7 indexes from v2 001 (topic, conversation_id, dedupe_key, deleted_at,
 *   edge source/target) plus the 2 partial indexes from v2 004 (participant,
 *   mention_count).
 * - 3 FTS5 auto-sync triggers from v2 004 (insert, update of content,
 *   soft-delete via deleted_at).
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '008-memory',
  sql: `
-- knowledge_nodes — memory graph node (v2 001 base + v2 004 enhancement merged).
-- conversation_id / message_id are plain TEXT (no FK) per spec §5.2 008 "독립".
CREATE TABLE knowledge_nodes (
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
  -- v2 004 enhancement columns merged inline
  participant_id TEXT,
  last_mentioned_at DATETIME,
  mention_count INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0.5
);

-- FTS5 contentless-mode index mirroring knowledge_nodes.content
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  content,
  content=knowledge_nodes,
  content_rowid=rowid,
  tokenize='unicode61'
);

-- knowledge_edges — graph relations between nodes (memory-internal FK only)
CREATE TABLE knowledge_edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT REFERENCES knowledge_nodes(id),
  target_node_id TEXT REFERENCES knowledge_nodes(id),
  relation_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes from v2 001 (memory portion)
CREATE INDEX idx_knowledge_nodes_topic
  ON knowledge_nodes(topic);
CREATE INDEX idx_knowledge_nodes_conversation_id
  ON knowledge_nodes(conversation_id);
CREATE INDEX idx_knowledge_nodes_dedupe_key
  ON knowledge_nodes(dedupe_key);
CREATE INDEX idx_knowledge_nodes_deleted_at
  ON knowledge_nodes(deleted_at);
CREATE INDEX idx_knowledge_edges_source_node_id
  ON knowledge_edges(source_node_id);
CREATE INDEX idx_knowledge_edges_target_node_id
  ON knowledge_edges(target_node_id);

-- Partial indexes from v2 004 enhancement
CREATE INDEX idx_knowledge_nodes_participant
  ON knowledge_nodes(participant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_knowledge_nodes_mention
  ON knowledge_nodes(mention_count DESC) WHERE deleted_at IS NULL;

-- FTS5 auto-sync triggers (v2 004): keep knowledge_fts mirroring content
CREATE TRIGGER knowledge_fts_insert
AFTER INSERT ON knowledge_nodes
BEGIN
  INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER knowledge_fts_update
AFTER UPDATE OF content ON knowledge_nodes
BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER knowledge_fts_delete
AFTER UPDATE OF deleted_at ON knowledge_nodes
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
`,
};
