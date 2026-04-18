/**
 * IPC handlers for audit log queries.
 *
 * Delegates to the ExecutionService's AuditLog instance.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { AuditFilter } from '../../execution/audit-log';

// ── Lazy import to avoid circular deps ────────────────────────────

let getAuditLogFn: (() => import('../../execution/audit-log').AuditLog) | null = null;

/**
 * Wire the audit handler to the execution service's audit log.
 * Called once during app startup after the execution service is ready.
 */
export function setAuditLogAccessor(fn: () => import('../../execution/audit-log').AuditLog): void {
  getAuditLogFn = fn;
}

function getAuditLog(): import('../../execution/audit-log').AuditLog {
  if (!getAuditLogFn) {
    throw new Error('AuditLog accessor not initialized');
  }
  return getAuditLogFn();
}

/** List audit entries with optional filters. */
export function handleAuditList(
  data: IpcRequest<'audit:list'>,
): IpcResponse<'audit:list'> {
  if (!getAuditLogFn) {
    return { entries: [] };
  }

  const filter: AuditFilter = {};
  if (data?.aiId) filter.aiId = data.aiId;
  if (data?.action) filter.action = data.action as AuditFilter['action'];
  if (data?.result) filter.result = data.result as AuditFilter['result'];
  if (data?.since) filter.since = data.since;
  if (data?.until) filter.until = data.until;

  let entries = getAuditLog().getEntries(Object.keys(filter).length > 0 ? filter : undefined);

  if (data?.limit && data.limit > 0) {
    entries = entries.slice(-data.limit);
  }

  return { entries };
}

/** Clear all audit entries. */
export function handleAuditClear(): IpcResponse<'audit:clear'> {
  if (!getAuditLogFn) {
    return { cleared: 0 };
  }
  const log = getAuditLog();
  const cleared = log.size;
  log.clear();
  return { cleared };
}
