/**
 * Migration 003: Remote access tables.
 *
 * Creates tables for remote access management:
 * - remote_access_grants: token-based access grants
 * - remote_audit_log: audit trail for remote access events
 *
 * IMPORTANT: This file is IMMUTABLE once applied.
 * Do not modify — create a new migration instead.
 */

import type { Migration } from '../migrator';

const migration: Migration = {
  id: '003-remote-tables',
  sql: `
    -- Remote access grants (token-based authentication)
    CREATE TABLE IF NOT EXISTS remote_access_grants (
      grant_id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      permissions TEXT NOT NULL,
      description TEXT,
      last_used_at INTEGER
    );

    -- Remote access audit log
    CREATE TABLE IF NOT EXISTS remote_audit_log (
      audit_id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      remote_ip TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      result TEXT NOT NULL,
      denial_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_remote_audit_log_session_id
      ON remote_audit_log(session_id);

    CREATE INDEX IF NOT EXISTS idx_remote_audit_log_timestamp
      ON remote_audit_log(timestamp);

    CREATE INDEX IF NOT EXISTS idx_remote_grants_token_hash
      ON remote_access_grants(token_hash);
  `,
};

export default migration;
