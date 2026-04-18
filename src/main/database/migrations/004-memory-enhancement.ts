/**
 * Migration 004: Memory system enhancement.
 *
 * Adds:
 * - participant_id column for speaker attribution
 * - last_mentioned_at / mention_count for re-mention tracking
 * - confidence column for LLM extraction confidence
 * - Partial indexes on participant_id and mention_count
 * - FTS5 auto-sync triggers (insert, update, soft-delete)
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify — create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '004-memory-enhancement',
  sql: `
    -- Speaker attribution
    ALTER TABLE knowledge_nodes ADD COLUMN participant_id TEXT;

    -- Re-mention tracking
    ALTER TABLE knowledge_nodes ADD COLUMN last_mentioned_at DATETIME;
    ALTER TABLE knowledge_nodes ADD COLUMN mention_count INTEGER DEFAULT 0;

    -- Extraction confidence (LLM-derived)
    ALTER TABLE knowledge_nodes ADD COLUMN confidence REAL DEFAULT 0.5;

    -- Partial index: filter by participant (non-deleted only)
    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_participant
      ON knowledge_nodes(participant_id) WHERE deleted_at IS NULL;

    -- Partial index: sort by mention_count descending (non-deleted only)
    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_mention
      ON knowledge_nodes(mention_count DESC) WHERE deleted_at IS NULL;

    -- FTS5 auto-sync trigger: INSERT
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert
    AFTER INSERT ON knowledge_nodes
    BEGIN
      INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;

    -- FTS5 auto-sync trigger: UPDATE content
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
    AFTER UPDATE OF content ON knowledge_nodes
    BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;

    -- FTS5 auto-sync trigger: soft-delete
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete
    AFTER UPDATE OF deleted_at ON knowledge_nodes
    WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
    BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;
  `,
};

export default migration;
