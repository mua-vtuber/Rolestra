/**
 * In-memory audit log for all execution attempts.
 *
 * Every file read/write, command execution, and patch application
 * is recorded as an AuditEntry for traceability and debugging.
 * A future phase will persist entries to SQLite.
 */

import type { AuditEntry } from '../../shared/execution-types';

/** Filter criteria for querying audit entries. */
export interface AuditFilter {
  /** Filter by AI identifier. */
  aiId?: string;
  /** Filter by action type. */
  action?: AuditEntry['action'];
  /** Filter by result outcome. */
  result?: AuditEntry['result'];
  /** Return entries after this timestamp (inclusive). */
  since?: number;
  /** Return entries before this timestamp (inclusive). */
  until?: number;
}

/**
 * In-memory audit log that records every execution attempt.
 *
 * Thread-safe within a single Node.js event loop (no concurrent writes).
 */
export class AuditLog {
  private entries: AuditEntry[] = [];

  /**
   * Record a new audit entry.
   *
   * @param entry - The audit entry to record.
   */
  record(entry: AuditEntry): void {
    this.entries.push({ ...entry });
  }

  /**
   * Retrieve audit entries, optionally filtered.
   *
   * @param filter - Optional filter criteria.
   * @returns Matching audit entries in chronological order.
   */
  getEntries(filter?: AuditFilter): AuditEntry[] {
    if (!filter) {
      return [...this.entries];
    }

    return this.entries.filter((entry) => {
      if (filter.aiId !== undefined && entry.aiId !== filter.aiId) {
        return false;
      }
      if (filter.action !== undefined && entry.action !== filter.action) {
        return false;
      }
      if (filter.result !== undefined && entry.result !== filter.result) {
        return false;
      }
      if (filter.since !== undefined && entry.timestamp < filter.since) {
        return false;
      }
      if (filter.until !== undefined && entry.timestamp > filter.until) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get the total number of recorded entries.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clear all recorded entries.
   */
  clear(): void {
    this.entries = [];
  }
}
