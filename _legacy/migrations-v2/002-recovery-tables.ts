/**
 * Migration 002: Recovery tables.
 *
 * Creates tables for conversation state snapshots and recovery history:
 * - conversation_snapshots: persisted state for crash/restart recovery
 * - recovery_logs: audit trail of recovery attempts
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify — create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '002-recovery-tables',
  sql: `
    -- Conversation state snapshots (one per conversation, upsert)
    CREATE TABLE IF NOT EXISTS conversation_snapshots (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      consensus_state TEXT,
      saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_recoverable INTEGER DEFAULT 1,
      error_message TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_conversation_id
      ON conversation_snapshots(conversation_id);

    -- Recovery history log
    CREATE TABLE IF NOT EXISTS recovery_logs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      recovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      recovered_from_state TEXT,
      result TEXT NOT NULL,
      error_message TEXT
    );
  `,
};

export default migration;
