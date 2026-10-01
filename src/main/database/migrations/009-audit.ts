/**
 * Migration 009-audit: persistent audit_log for ExecutionService.
 *
 * v2 carried audit data only in memory (`src/main/execution/audit-log.ts`
 * holds an `AuditEntry[]` per process), so there is no v2 SQL DDL to copy
 * verbatim. This migration creates the v3 persistent slot whose columns
 * mirror the canonical `AuditEntry` interface defined in
 * `src/shared/execution-types.ts`:
 *
 *   operation_id  : unique id of the attempted operation
 *   ai_id         : caller (provider id, "user", or "system")
 *   action        : 'read' | 'write' | 'execute' | 'apply-patch'
 *   target_path   : file path or command string
 *   timestamp     : INTEGER ms-since-epoch
 *   result        : 'success' | 'denied' | 'failed'
 *   rollbackable  : INTEGER (0/1)
 *   details       : optional JSON/text context
 *
 * Per spec §5.2 009 + §12 Security:
 * - audit_log is the source-of-truth for compliance, so it carries **no FK**
 *   to providers/projects/channels/etc. — parent-row deletes must never
 *   destroy audit history. (Equivalent to "ON DELETE 동작은 SET NULL 또는 없음";
 *   here we choose "없음 = no FK at all" which is the strongest guarantee.)
 * - Hard deletes are application-level forbidden; the schema neither prevents
 *   them nor enables them via cascade.
 *
 * Indexes: ai_id and timestamp are the two query axes used by the existing
 * in-memory `AuditFilter` shape.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '009-audit',
  sql: `
CREATE TABLE audit_log (
  operation_id TEXT PRIMARY KEY,
  ai_id        TEXT NOT NULL,
  action       TEXT NOT NULL CHECK(action IN ('read','write','execute','apply-patch')),
  target_path  TEXT NOT NULL,
  timestamp    INTEGER NOT NULL,
  result       TEXT NOT NULL CHECK(result IN ('success','denied','failed')),
  rollbackable INTEGER NOT NULL DEFAULT 0,
  details      TEXT
);

CREATE INDEX idx_audit_log_ai_id     ON audit_log(ai_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_action    ON audit_log(action);
CREATE INDEX idx_audit_log_result    ON audit_log(result);
`,
};
