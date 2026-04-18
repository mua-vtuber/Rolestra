/**
 * Migration 006: Add summary_text column to consensus_records.
 *
 * Stores the facilitator-generated consensus summary document
 * after a successful consensus (DONE phase).
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify; create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '006-consensus-summary',
  sql: `
    ALTER TABLE consensus_records ADD COLUMN summary_text TEXT;
  `,
};

export default migration;
