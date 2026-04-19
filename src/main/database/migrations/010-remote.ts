/**
 * Migration 010-remote: remote access grants + remote audit log (v2 port).
 *
 * Direct port of `_legacy/migrations-v2/003-remote-tables.ts`. The DDL is
 * copied verbatim (without IF NOT EXISTS guards, since v3 migrations are
 * single-shot per fresh DB and the migrator records applied IDs).
 *
 * Per spec §5.2 010 + §12 Security:
 * - Neither `remote_access_grants` nor `remote_audit_log` carry FK references
 *   to other v3 tables. `remote_audit_log.session_id` is a free-form TEXT
 *   correlation id (not a FK). This guarantees no cascade can ever destroy
 *   audit history when a parent grant or session is removed.
 *
 * Tables:
 * - remote_access_grants — token-hash-keyed grants with optional expiry,
 *   permission scope (JSON), description, and last-used timestamp.
 * - remote_audit_log     — append-only trail of remote API events.
 *
 * Indexes match v2 003 verbatim.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '010-remote',
  sql: `
-- Remote access grants (token-based authentication)
CREATE TABLE remote_access_grants (
  grant_id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  permissions TEXT NOT NULL,
  description TEXT,
  last_used_at INTEGER
);

-- Remote access audit log (no FK — audit preservation per §5.2 010)
CREATE TABLE remote_audit_log (
  audit_id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  session_id TEXT,
  remote_ip TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  result TEXT NOT NULL,
  denial_reason TEXT
);

CREATE INDEX idx_remote_audit_log_session_id
  ON remote_audit_log(session_id);

CREATE INDEX idx_remote_audit_log_timestamp
  ON remote_audit_log(timestamp);

CREATE INDEX idx_remote_grants_token_hash
  ON remote_access_grants(token_hash);
`,
};
