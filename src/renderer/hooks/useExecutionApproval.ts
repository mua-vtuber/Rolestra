/**
 * useExecutionApproval -- manages pending diffs, permission requests,
 * and failure report approval/rejection flows.
 */

import { useState, useCallback } from 'react';
import type { DiffEntry } from '../../shared/execution-types';
import type { PermissionRequest } from '../../shared/file-types';
import type { FailureReportData } from '../components/chat/FailureReportDialog';
import { showError } from './useErrorDialog';

export interface UseExecutionApprovalReturn {
  pendingDiffs: { operationId: string; diffs: DiffEntry[] } | null;
  setPendingDiffs: (v: { operationId: string; diffs: DiffEntry[] } | null) => void;
  pendingPermission: PermissionRequest | null;
  setPendingPermission: (v: PermissionRequest | null) => void;
  failureReport: FailureReportData | null;
  setFailureReport: (v: FailureReportData | null) => void;
  handleDiffApprove: () => Promise<void>;
  handleDiffReject: () => Promise<void>;
  handlePermissionApprove: () => Promise<void>;
  handlePermissionReject: () => Promise<void>;
  handleFailureResolve: (resolution: 'retry' | 'stop' | 'reassign', facilitatorId?: string) => void;
}

export function useExecutionApproval(): UseExecutionApprovalReturn {
  const [pendingDiffs, setPendingDiffs] = useState<{ operationId: string; diffs: DiffEntry[] } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [failureReport, setFailureReport] = useState<FailureReportData | null>(null);

  const handleDiffApprove = useCallback(async (): Promise<void> => {
    if (!pendingDiffs) return;
    try {
      const result = await window.arena.invoke('execution:approve', { operationId: pendingDiffs.operationId });
      if (!result.success) {
        throw new Error(result.error ?? 'Execution approval failed');
      }
      setPendingDiffs(null);
    } catch (err) { showError('execution:approve', err); }
  }, [pendingDiffs]);

  const handleDiffReject = useCallback(async (): Promise<void> => {
    if (!pendingDiffs) return;
    try {
      const result = await window.arena.invoke('execution:reject', { operationId: pendingDiffs.operationId });
      if (!result.success) {
        throw new Error(result.error ?? 'Execution reject failed');
      }
      setPendingDiffs(null);
    } catch (err) { showError('execution:reject', err); }
  }, [pendingDiffs]);

  const handlePermissionApprove = useCallback(async (): Promise<void> => {
    if (!pendingPermission) return;
    try {
      const result = await window.arena.invoke('permission:approve', { requestId: pendingPermission.requestId });
      if (!result.success) {
        throw new Error(result.error ?? 'Permission approve failed');
      }
      setPendingPermission(null);
    } catch (err) { showError('permission:approve', err); }
  }, [pendingPermission]);

  const handlePermissionReject = useCallback(async (): Promise<void> => {
    if (!pendingPermission) return;
    try {
      const result = await window.arena.invoke('permission:reject', { requestId: pendingPermission.requestId });
      if (!result.success) {
        throw new Error(result.error ?? 'Permission reject failed');
      }
      setPendingPermission(null);
    } catch (err) { showError('permission:reject', err); }
  }, [pendingPermission]);

  const handleFailureResolve = useCallback((resolution: 'retry' | 'stop' | 'reassign', facilitatorId?: string): void => {
    setFailureReport(null);
    if (resolution === 'reassign' && facilitatorId) {
      void window.arena.invoke('consensus:respond', {
        decision: 'DISAGREE',
        failureResolution: 'reassign',
        reassignFacilitatorId: facilitatorId,
      }).catch((err) => showError('consensus:respond', err));
    } else {
      void window.arena.invoke('consensus:respond', {
        decision: 'DISAGREE',
        failureResolution: resolution as 'retry' | 'stop',
      }).catch((err) => showError('consensus:respond', err));
    }
  }, []);

  return {
    pendingDiffs,
    setPendingDiffs,
    pendingPermission,
    setPendingPermission,
    failureReport,
    setFailureReport,
    handleDiffApprove,
    handleDiffReject,
    handlePermissionApprove,
    handlePermissionReject,
    handleFailureResolve,
  };
}
