/**
 * Audit log recording for remote access events.
 *
 * Stores every remote access action (successful or denied) to the
 * `remote_audit_log` table for compliance and debugging purposes.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RemoteAuditEntry } from '../../shared/remote-types';

/** Raw row shape returned from the remote_audit_log table. */
interface AuditRow {
  audit_id: string;
  timestamp: number;
  session_id: string | null;
  remote_ip: string | null;
  action: string;
  resource: string | null;
  result: string;
  denial_reason: string | null;
}

/** Optional filters for querying the audit log. */
export interface AuditLogFilters {
  startTime?: number;
  endTime?: number;
  action?: string;
  sessionId?: string;
}

export class RemoteAuditLogger {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Records an audit log entry.
   *
   * The `auditId` and `timestamp` are auto-generated.
   */
  log(entry: Omit<RemoteAuditEntry, 'auditId' | 'timestamp'>): void {
    const auditId = randomUUID();
    const timestamp = Date.now();

    this.db
      .prepare(
        `INSERT INTO remote_audit_log
           (audit_id, timestamp, session_id, remote_ip, action, resource, result, denial_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        auditId,
        timestamp,
        entry.sessionId,
        entry.remoteIp,
        entry.action,
        entry.resource ?? null,
        entry.result,
        entry.denialReason ?? null,
      );
  }

  /**
   * Queries the audit log with optional filters.
   */
  getLog(filters?: AuditLogFilters): RemoteAuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filters.startTime);
    }
    if (filters?.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filters.endTime);
    }
    if (filters?.action !== undefined) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters?.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db
      .prepare(`SELECT * FROM remote_audit_log ${whereClause} ORDER BY timestamp ASC`)
      .all(...params) as AuditRow[];

    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Returns the number of audit log entries matching the optional filters.
   */
  getLogCount(filters?: { startTime?: number; endTime?: number }): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filters.startTime);
    }
    if (filters?.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filters.endTime);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM remote_audit_log ${whereClause}`)
      .get(...params) as { count: number };

    return result.count;
  }

  /** Converts a raw DB row to a typed RemoteAuditEntry. */
  private rowToEntry(row: AuditRow): RemoteAuditEntry {
    return {
      auditId: row.audit_id,
      timestamp: row.timestamp,
      sessionId: row.session_id ?? '',
      remoteIp: row.remote_ip ?? '',
      action: row.action,
      resource: row.resource ?? undefined,
      result: row.result as RemoteAuditEntry['result'],
      denialReason: row.denial_reason ?? undefined,
    };
  }
}
