/**
 * Migration 001: Initial schema.
 *
 * Creates the foundational tables for AI Chat Arena:
 * - conversations: chat session metadata
 * - messages: individual messages with branching support
 * - knowledge_nodes: memory system core entities (with operational columns)
 * - knowledge_fts: FTS5 full-text search index for knowledge_nodes
 * - knowledge_edges: graph edges between knowledge nodes
 * - providers: AI provider configuration
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify — create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '001-initial-schema',
  sql: `
    -- conversations table
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      mode TEXT NOT NULL,
      participants TEXT NOT NULL,
      folder_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- messages table (with branching support)
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES conversations(id),
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

    -- knowledge_nodes table (with operational columns)
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
      deleted_at DATETIME
    );

    -- knowledge_fts (FTS5 full-text search index)
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      content,
      content=knowledge_nodes,
      content_rowid=rowid,
      tokenize='unicode61'
    );

    -- knowledge_edges table
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_node_id TEXT REFERENCES knowledge_nodes(id),
      target_node_id TEXT REFERENCES knowledge_nodes(id),
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- providers table
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      persona TEXT,
      config TEXT NOT NULL,
      permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
      ON messages(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id
      ON messages(parent_message_id);

    CREATE INDEX IF NOT EXISTS idx_messages_branch_id
      ON messages(branch_id);

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_topic
      ON knowledge_nodes(topic);

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_conversation_id
      ON knowledge_nodes(conversation_id);

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_dedupe_key
      ON knowledge_nodes(dedupe_key);

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_deleted_at
      ON knowledge_nodes(deleted_at);

    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source_node_id
      ON knowledge_edges(source_node_id);

    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target_node_id
      ON knowledge_edges(target_node_id);
  `,
};

export default migration;
