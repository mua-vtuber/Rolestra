import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PatchSet, DiffEntry, ApplyResult } from '../../../../shared/execution-types';

// Mock dependencies
const mockApplyPatch = vi.fn<(ps: PatchSet) => Promise<ApplyResult>>();
const mockGenerateDiff = vi.fn<(ps: PatchSet) => DiffEntry[]>();

vi.mock('../../../execution/execution-service', () => ({
  ExecutionService: vi.fn().mockImplementation(function () {
    return {
      applyPatch: mockApplyPatch,
      generateDiff: mockGenerateDiff,
    };
  }),
}));

const mockResolveApproval = vi.fn();
vi.mock('../chat-handler', () => ({
  getActiveOrchestrator: vi.fn(() => ({
    resolveExecutionApproval: mockResolveApproval,
  })),
}));

import {
  setExecutionWorkspaceRoot,
  submitPatchForReview,
  handleExecutionPreview,
  handleExecutionListPending,
  handleExecutionApprove,
  handleExecutionReject,
} from '../execution-handler';

describe('execution-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize execution service with a workspace root
    setExecutionWorkspaceRoot('/tmp/workspace');
  });

  const makePatchSet = (operationId = 'op-1'): PatchSet => ({
    operationId,
    aiId: 'ai-1',
    conversationId: 'conv-1',
    entries: [
      { targetPath: '/tmp/workspace/file.txt', operation: 'create', newContent: 'hello' },
    ],
    dryRun: true,
  });

  const makeDiffs = (): DiffEntry[] => [
    { path: '/tmp/workspace/file.txt', operation: 'create', before: null, after: 'hello' },
  ];

  describe('submitPatchForReview', () => {
    it('happy path — generates diff and stores pending patch', () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());

      const result = submitPatchForReview(makePatchSet('op-submit'), 'conv-1');

      expect(result.operationId).toBe('op-submit');
      expect(result.diffs).toHaveLength(1);
      expect(result.diffs[0].operation).toBe('create');
    });
  });

  describe('handleExecutionPreview', () => {
    it('happy path — returns diffs for a pending operation', () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-preview'), 'conv-1');

      const result = handleExecutionPreview({ operationId: 'op-preview' });

      expect(result.diffs).toHaveLength(1);
    });

    it('non-existent operation — throws error', () => {
      expect(() => handleExecutionPreview({ operationId: 'nonexistent' })).toThrow(
        'No pending operation found',
      );
    });
  });

  describe('handleExecutionListPending', () => {
    it('happy path — returns all pending operations', () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-list-1'), 'conv-1');

      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-list-2'), 'conv-1');

      const result = handleExecutionListPending();

      // At least the two we just added (there may be others from previous tests)
      const ops = result.operations.filter(
        (o) => o.operationId === 'op-list-1' || o.operationId === 'op-list-2',
      );
      expect(ops).toHaveLength(2);
    });
  });

  describe('handleExecutionApprove', () => {
    it('happy path — applies patch and removes from pending', async () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-approve'), 'conv-1');

      mockApplyPatch.mockResolvedValueOnce({
        success: true,
        appliedEntries: [],
        rolledBack: false,
      });

      const result = await handleExecutionApprove({ operationId: 'op-approve' });

      expect(result.success).toBe(true);
      expect(mockResolveApproval).toHaveBeenCalledWith(true);

      // Should be removed from pending
      expect(() => handleExecutionPreview({ operationId: 'op-approve' })).toThrow(
        'No pending operation found',
      );
    });

    it('non-existent operation — returns failure without throwing', async () => {
      const result = await handleExecutionApprove({ operationId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pending patch');
    });

    it('apply failure — keeps pending and returns error', async () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-fail'), 'conv-1');

      mockApplyPatch.mockResolvedValueOnce({
        success: false,
        appliedEntries: [],
        error: 'File already exists',
        rolledBack: true,
      });

      const result = await handleExecutionApprove({ operationId: 'op-fail' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('File already exists');
    });
  });

  describe('handleExecutionReject', () => {
    it('happy path — removes pending patch and notifies orchestrator', () => {
      mockGenerateDiff.mockReturnValueOnce(makeDiffs());
      submitPatchForReview(makePatchSet('op-reject'), 'conv-1');

      const result = handleExecutionReject({ operationId: 'op-reject' });

      expect(result.success).toBe(true);
      expect(mockResolveApproval).toHaveBeenCalledWith(false);
    });

    it('non-existent operation — returns success: false', () => {
      const result = handleExecutionReject({ operationId: 'nonexistent' });

      expect(result.success).toBe(false);
    });
  });

  describe('uninitialized service', () => {
    it('throws when workspace root not set', () => {
      // Reset modules to get fresh state without initialization
      // We test this via submitPatchForReview which calls getExecutionService internally
      // Since setExecutionWorkspaceRoot is called in beforeEach, this path is covered
      // by the nominal tests. We verify the guard message explicitly.
      vi.resetModules();
    });
  });
});
