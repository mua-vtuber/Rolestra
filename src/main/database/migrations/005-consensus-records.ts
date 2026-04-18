/**
 * Migration 005: Structured consensus output records.
 *
 * Adds durable storage for consensus outcomes and evidence mapping.
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify; create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '005-consensus-records',
  sql: `
    CREATE TABLE IF NOT EXISTS consensus_records (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      proposal_hash TEXT NOT NULL,
      phase TEXT NOT NULL,
      decision TEXT NOT NULL,
      block_reason_type TEXT,
      reason TEXT NOT NULL,
      human_vote_json TEXT,
      ai_vote_json TEXT NOT NULL,
      evidence_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_consensus_records_conversation
      ON consensus_records(conversation_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_consensus_records_proposal_hash
      ON consensus_records(proposal_hash);
  `,
};

export default migration;

