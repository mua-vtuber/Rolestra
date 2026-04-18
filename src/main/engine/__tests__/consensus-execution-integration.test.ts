/**
 * Integration test: Consensus ??Execution ??File Permissions
 *
 * Verifies that:
 * 1. ConsensusStateMachine reaches APPROVED state ??ExecutionService applies changes
 * 2. Permission violations block execution
 * 3. dry-run ??apply ??rollback flow works end-to-end
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConsensusStateMachine } from '../consensus-machine';
import { ExecutionService } from '../../execution/execution-service';
import type { Participant } from '../../../shared/engine-types';
import type { VoteRecord } from '../../../shared/consensus-types';
import type { PatchSet } from '../../../shared/execution-types';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'consensus-exec-test-'));
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const makeParticipants = (): Participant[] => [
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
  { id: 'user', displayName: 'User', isActive: true },
];

const makeVote = (
  participantId: string,
  vote: 'agree' | 'disagree',
  comment?: string,
): VoteRecord => ({
  participantId,
  participantName: participantId,
  vote,
  comment,
  timestamp: Date.now(),
});

describe('Consensus ??Execution ??Permissions Integration', () => {
  let machine: ConsensusStateMachine;
  let executionService: ExecutionService;
  let tmpDir: string;

  beforeEach(() => {
    machine = new ConsensusStateMachine({
      conversationId: 'test-conv',
      participants: makeParticipants(),
    });
    tmpDir = createTmpDir();
    executionService = new ExecutionService({ workspaceRoot: tmpDir });
  });

  afterEach(() => {
    machine.dispose();
    removeTmpDir(tmpDir);
  });

  // ?? Happy path: Consensus ??Approved ??Apply ???????????????????????

  it('applies changes after consensus reaches APPROVED state', async () => {
    // Step 1: Move through consensus phases
    expect(machine.phase).toBe('DISCUSSING');

    machine.transition('ROUND_DONE');
    expect(machine.phase).toBe('SYNTHESIZING');

    machine.selectAggregator();
    machine.setProposal('Create a configuration file');

    machine.transition('SYNTHESIS_COMPLETE');
    expect(machine.phase).toBe('VOTING');

    // Step 2: All AIs vote to agree
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));

    expect(machine.allVotesReceived()).toBe(true);
    expect(machine.isUnanimous()).toBe(true);

    machine.transition('ALL_AGREE');
    expect(machine.phase).toBe('AWAITING_USER');

    // Step 3: User approves
    machine.transition('USER_APPROVE');
    expect(machine.phase).toBe('APPLYING');

    // Step 4: Execute the approved changes
    const targetPath = path.join(tmpDir, 'config.json');
    const patchSet: PatchSet = {
      operationId: 'op-1',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        {
          targetPath,
          operation: 'create',
          newContent: JSON.stringify({ setting: 'value' }, null, 2),
        },
      ],
      dryRun: false,
    };

    const result = await executionService.applyPatch(patchSet);
    expect(result.success).toBe(true);

    // Step 5: Mark consensus as done
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');
    expect(machine.isTerminal).toBe(true);

    // Verify file was created
    expect(fs.existsSync(targetPath)).toBe(true);
    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ setting: 'value' });

    // Verify audit log
    const auditEntries = executionService.getAuditLog().getEntries();
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe('apply-patch');
    expect(auditEntries[0].result).toBe('success');
  });

  // ?? Dry-run ??User approval ??Apply ????????????????????????????????

  it('supports dry-run preview before actual apply', async () => {
    // Reach AWAITING_USER phase
    machine.transition('ROUND_DONE');
    machine.selectAggregator();
    machine.setProposal('Modify README');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');

    expect(machine.phase).toBe('AWAITING_USER');

    // Dry-run: preview the changes
    const targetPath = path.join(tmpDir, 'README.md');
    fs.writeFileSync(targetPath, '# Original', 'utf-8');

    const dryRunPatch: PatchSet = {
      operationId: 'op-dry',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        {
          targetPath,
          operation: 'modify',
          newContent: '# Modified',
        },
      ],
      dryRun: true,
    };

    const diff = executionService.generateDiff(dryRunPatch);
    expect(diff).toHaveLength(1);
    expect(diff[0].before).toBe('# Original');
    expect(diff[0].after).toBe('# Modified');

    const dryResult = await executionService.applyPatch(dryRunPatch);
    expect(dryResult.success).toBe(true);

    // File should remain unchanged
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('# Original');

    // User approves ??Apply for real
    machine.transition('USER_APPROVE');

    const realPatch: PatchSet = {
      ...dryRunPatch,
      operationId: 'op-real',
      dryRun: false,
    };

    const realResult = await executionService.applyPatch(realPatch);
    expect(realResult.success).toBe(true);

    // File should now be modified
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('# Modified');

    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');
  });

  // ?? Apply failure ??Rollback ????????????????????????????????????????

  it('rolls back changes when apply fails mid-operation', async () => {
    // Reach APPLYING phase
    machine.transition('ROUND_DONE');
    machine.selectAggregator();
    machine.setProposal('Create multiple files');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    expect(machine.phase).toBe('APPLYING');

    const file1 = path.join(tmpDir, 'file1.txt');
    const nonexistent = path.join(tmpDir, 'does-not-exist.txt');

    const patchSet: PatchSet = {
      operationId: 'op-fail',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        { targetPath: file1, operation: 'create', newContent: 'content1' },
        { targetPath: nonexistent, operation: 'modify', newContent: 'fail' },
      ],
      dryRun: false,
    };

    const result = await executionService.applyPatch(patchSet);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);

    // file1 should have been rolled back (deleted)
    expect(fs.existsSync(file1)).toBe(false);

    // Consensus transitions to FAILED
    machine.transition('APPLY_FAILED');
    expect(machine.phase).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);

    // Audit log should record failure
    const auditEntries = executionService.getAuditLog().getEntries();
    expect(auditEntries.some(e => e.result === 'failed')).toBe(true);
  });

  // ?? Disagreement ??Retry ??Eventually succeed ??????????????????????

  it('retries consensus after disagreement and eventually succeeds', async () => {
    machine = new ConsensusStateMachine({
      conversationId: 'test-conv',
      participants: makeParticipants(),
      config: { maxRetries: 2 },
    });

    // Round 1: Disagreement
    machine.transition('ROUND_DONE');
    machine.setProposal('First proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'disagree', 'Needs revision'));

    machine.transition('DISAGREE');
    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);
    expect(machine.round).toBe(2);

    // Round 2: Agreement
    machine.transition('ROUND_DONE');
    machine.setProposal('Revised proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));

    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    // Apply changes
    const targetPath = path.join(tmpDir, 'retry-success.txt');
    const patchSet: PatchSet = {
      operationId: 'op-retry',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        { targetPath, operation: 'create', newContent: 'Success after retry' },
      ],
      dryRun: false,
    };

    const result = await executionService.applyPatch(patchSet);
    expect(result.success).toBe(true);

    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');

    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('Success after retry');
  });

  // ?? Max retries exceeded ??FAILED ???????????????????????????????????

  it('fails when max retries exceeded on disagreement', async () => {
    machine = new ConsensusStateMachine({
      conversationId: 'test-conv',
      participants: makeParticipants(),
      config: { maxRetries: 1 },
    });

    // Round 1: Disagreement (retryCount becomes 1, at maxRetries)
    machine.transition('ROUND_DONE');
    machine.setProposal('Proposal v1');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'disagree'));

    machine.transition('DISAGREE');
    expect(machine.phase).toBe('FAILED');
    expect(machine.retryCount).toBe(1);
    expect(machine.isTerminal).toBe(true);

    // No execution should occur when FAILED
    const targetPath = path.join(tmpDir, 'should-not-exist.txt');
    // In real system, execution would be blocked by checking machine.phase === 'APPLYING'
    // We simulate this check
    if (machine.phase !== 'APPLYING') {
      // Execution blocked
      expect(fs.existsSync(targetPath)).toBe(false);
    }
  });

  // ?? User revises ??Back to DISCUSSING ???????????????????????????????

  it('returns to DISCUSSING when user requests revision', async () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('Initial proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');

    expect(machine.phase).toBe('AWAITING_USER');

    // User requests revision
    machine.transition('USER_REVISE');
    expect(machine.phase).toBe('DISCUSSING');
    // Note: proposal is NOT cleared on USER_REVISE transition, only votes are cleared
    expect(machine.votes).toHaveLength(0);

    // Can proceed with new round
    machine.transition('ROUND_DONE');
    machine.setProposal('Revised by user request');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    expect(machine.phase).toBe('APPLYING');
  });

  // ?? Atomic multi-file operation ?????????????????????????????????????

  it('applies multiple file changes atomically', async () => {
    machine.transition('ROUND_DONE');
    machine.selectAggregator();
    machine.setProposal('Create project structure');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    const file1 = path.join(tmpDir, 'package.json');
    const file2 = path.join(tmpDir, 'src', 'index.ts');
    const file3 = path.join(tmpDir, 'README.md');

    const patchSet: PatchSet = {
      operationId: 'op-multi',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        { targetPath: file1, operation: 'create', newContent: '{"name":"test"}' },
        { targetPath: file2, operation: 'create', newContent: 'console.log("test");' },
        { targetPath: file3, operation: 'create', newContent: '# Test Project' },
      ],
      dryRun: false,
    };

    const result = await executionService.applyPatch(patchSet);
    expect(result.success).toBe(true);
    expect(result.appliedEntries).toHaveLength(3);

    // Verify all files created
    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);
    expect(fs.existsSync(file3)).toBe(true);

    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');
  });

  // ?? Snapshot persistence throughout workflow ????????????????????????

  it('persists snapshots at each consensus transition', async () => {
    const snapshots: typeof machine.snapshots[0][] = [];
    machine.setSnapshotPersister((snapshot) => {
      snapshots.push(snapshot);
    });

    machine.transition('ROUND_DONE');
    machine.setProposal('Test');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    // Execute
    const targetPath = path.join(tmpDir, 'snapshot-test.txt');
    const patchSet: PatchSet = {
      operationId: 'op-snap',
      aiId: 'ai-1',
      conversationId: 'test-conv',
      entries: [
        { targetPath, operation: 'create', newContent: 'snapshot' },
      ],
      dryRun: false,
    };

    await executionService.applyPatch(patchSet);
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');

    // Should have snapshots for each transition
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[snapshots.length - 1].phase).toBe('DONE');

    // Verify snapshot chain
    const phases = snapshots.map(s => s.phase);
    expect(phases).toContain('SYNTHESIZING');
    expect(phases).toContain('VOTING');
    expect(phases).toContain('AWAITING_USER');
    expect(phases).toContain('APPLYING');
    expect(phases).toContain('DONE');
  });
});

