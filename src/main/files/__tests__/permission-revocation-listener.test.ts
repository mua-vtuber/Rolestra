import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionStateMachine } from '../../engine/session-state-machine';
import { WorkspaceService } from '../workspace-service';
import { PermissionService } from '../permission-service';
import { attachPermissionRevocationListener } from '../permission-revocation-listener';
import { DEFAULT_FILE_PERMISSION } from '../../../shared/file-types';
import type { ModeJudgment } from '../../../shared/session-state-types';
import type { VoteRecord } from '../../../shared/consensus-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arena-revoke-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Helper to create a mode judgment with required fields. */
function workJudgment(participantId: string): ModeJudgment {
  return { participantId, participantName: participantId, judgment: 'work' };
}

/** Helper to create an agree vote with required fields. */
function agreeVote(participantId: string): VoteRecord {
  return { participantId, participantName: participantId, vote: 'agree', timestamp: Date.now() };
}

const WORKER_ID = 'ai-claude';
const OTHER_ID = 'ai-gemini';
const AI_IDS = [WORKER_ID, OTHER_ID];

const PARTICIPANTS = [
  { id: 'user', providerId: 'user', displayName: 'User', isActive: true },
  { id: WORKER_ID, providerId: WORKER_ID, displayName: 'Claude', isActive: true },
  { id: OTHER_ID, providerId: OTHER_ID, displayName: 'Gemini', isActive: true },
];

/** Drive SSM from CONVERSATION to CONSENSUS_APPROVED. */
function driveToConsensusApproved(ssm: SessionStateMachine): void {
  for (const id of AI_IDS) ssm.recordModeJudgment(workJudgment(id));
  ssm.transition('ROUND_COMPLETE');
  ssm.transition('USER_APPROVE_MODE');
  ssm.transition('ROUND_COMPLETE');
  ssm.setProposal('Test proposal');
  ssm.transition('SYNTHESIS_COMPLETE');
  for (const id of AI_IDS) ssm.recordVote(agreeVote(id));
  ssm.transition('ALL_AGREE');
}

function createSSM(tmpDir: string, opts?: { projectPath?: string | null }): SessionStateMachine {
  return new SessionStateMachine({
    conversationId: `test-conv-${Date.now()}`,
    participants: [...PARTICIPANTS],
    ctx: createDefaultSsmContext({ projectPath: tmpDir }),
    projectPath: opts?.projectPath !== undefined ? opts.projectPath : tmpDir,
    config: { maxRetries: 3, phaseTimeout: 0 },
  });
}

describe('attachPermissionRevocationListener', () => {
  let tmpDir: string;
  let workspace: WorkspaceService;
  let permission: PermissionService;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    workspace = new WorkspaceService();
    await workspace.initWorkspace(tmpDir);
    permission = new PermissionService(workspace);
    permission.setProjectFolder(tmpDir);

    permission.setPermissions([
      { participantId: WORKER_ID, folderPath: tmpDir, ...DEFAULT_FILE_PERMISSION },
      { participantId: OTHER_ID, folderPath: tmpDir, ...DEFAULT_FILE_PERMISSION },
    ]);
  });

  afterEach(() => {
    workspace.dispose();
    cleanupDir(tmpDir);
  });

  it('grants full permissions on grant_worker event', () => {
    const ssm = createSSM(tmpDir);
    attachPermissionRevocationListener(ssm, permission);

    driveToConsensusApproved(ssm);
    ssm.setWorkerId(WORKER_ID);
    ssm.transition('USER_SELECT_WORKER'); // → EXECUTING

    const workerPerm = permission.getPermissionsForParticipant(WORKER_ID);
    expect(workerPerm!.write).toBe(true);
    expect(workerPerm!.execute).toBe(true);
    expect(workerPerm!.read).toBe(true);

    // Other participant should still be read-only
    const otherPerm = permission.getPermissionsForParticipant(OTHER_ID);
    expect(otherPerm!.write).toBe(false);
    expect(otherPerm!.execute).toBe(false);

    ssm.dispose();
  });

  it('revokes worker on EXECUTING → REVIEWING', () => {
    const ssm = createSSM(tmpDir);
    attachPermissionRevocationListener(ssm, permission);

    driveToConsensusApproved(ssm);
    ssm.setWorkerId(WORKER_ID);
    ssm.transition('USER_SELECT_WORKER');
    expect(permission.getPermissionsForParticipant(WORKER_ID)!.write).toBe(true);

    ssm.transition('WORKER_DONE'); // → REVIEWING

    const workerPerm = permission.getPermissionsForParticipant(WORKER_ID);
    expect(workerPerm!.write).toBe(false);
    expect(workerPerm!.execute).toBe(false);
    expect(workerPerm!.read).toBe(true);

    ssm.dispose();
  });

  it('revokes all on terminal DONE from work mode', () => {
    const ssm = createSSM(tmpDir);
    attachPermissionRevocationListener(ssm, permission);

    driveToConsensusApproved(ssm);

    // Give both full access manually
    permission.setPermissions([
      { participantId: WORKER_ID, folderPath: tmpDir, read: true, write: true, execute: true },
      { participantId: OTHER_ID, folderPath: tmpDir, read: true, write: true, execute: true },
    ]);

    ssm.transition('USER_STOP'); // → DONE (triggers revoke_all)

    for (const id of AI_IDS) {
      const perm = permission.getPermissionsForParticipant(id);
      expect(perm!.read).toBe(true);
      expect(perm!.write).toBe(false);
      expect(perm!.execute).toBe(false);
    }

    ssm.dispose();
  });

  it('does nothing when projectPath is null', () => {
    const ssm = createSSM(tmpDir, { projectPath: null });
    const originalPerms = permission.getPermissions();
    attachPermissionRevocationListener(ssm, permission);

    expect(permission.getPermissions()).toEqual(originalPerms);

    ssm.dispose();
  });

  it('returns unsubscribe function that detaches listener', () => {
    const ssm = createSSM(tmpDir);
    const unsubscribe = attachPermissionRevocationListener(ssm, permission);
    unsubscribe();

    driveToConsensusApproved(ssm);
    ssm.setWorkerId(WORKER_ID);
    ssm.transition('USER_SELECT_WORKER');

    // Worker should still be read-only since listener was detached
    expect(permission.getPermissionsForParticipant(WORKER_ID)!.write).toBe(false);

    ssm.dispose();
  });

  it('re-grants worker on USER_REWORK', () => {
    const ssm = createSSM(tmpDir);
    attachPermissionRevocationListener(ssm, permission);

    driveToConsensusApproved(ssm);
    ssm.setWorkerId(WORKER_ID);
    ssm.transition('USER_SELECT_WORKER'); // → EXECUTING
    ssm.transition('WORKER_DONE'); // → REVIEWING

    expect(permission.getPermissionsForParticipant(WORKER_ID)!.write).toBe(false);

    ssm.transition('REVIEW_COMPLETE'); // → USER_DECISION
    ssm.transition('USER_REWORK'); // → EXECUTING (re-grant)

    expect(permission.getPermissionsForParticipant(WORKER_ID)!.write).toBe(true);
    expect(permission.getPermissionsForParticipant(WORKER_ID)!.execute).toBe(true);

    ssm.dispose();
  });
});
