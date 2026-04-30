import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStateMachine } from '../session-state-machine';
import type { Participant } from '../../../shared/engine-types';
import { createDefaultSsmContext } from '../../../shared/ssm-context-types';

const makeParticipants = (): Participant[] => [
  { id: 'ai-1', displayName: 'Alpha', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Beta', isActive: true, providerId: 'gemini' },
  { id: 'ai-3', displayName: 'Gamma', isActive: true, providerId: 'codex' },
  { id: 'user', displayName: 'User', isActive: true },
];

const TEST_CTX = createDefaultSsmContext({
  projectId: 'proj-test',
  projectPath: '/test/project',
});

/** Helper: record majority work votes to trigger mode transition via ROUND_COMPLETE guard. */
function voteWorkMajority(m: SessionStateMachine): void {
  m.recordModeJudgment({ participantId: 'ai-1', participantName: 'Alpha', judgment: 'work' });
  m.recordModeJudgment({ participantId: 'ai-2', participantName: 'Beta', judgment: 'work' });
}

describe('SessionStateMachine', () => {
  let machine: SessionStateMachine;

  beforeEach(() => {
    machine = new SessionStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
      ctx: TEST_CTX,
      projectPath: '/test/project',
    });
  });

  afterEach(() => {
    machine.dispose();
  });

  // ── Initial state ────────────────────────────────────────────

  it('starts in CONVERSATION state', () => {
    expect(machine.state).toBe('CONVERSATION');
    expect(machine.conversationRound).toBe(0);
    expect(machine.workRound).toBe(0);
    expect(machine.isTerminal).toBe(false);
  });

  it('saves initial snapshot on construction', () => {
    expect(machine.snapshots).toHaveLength(1);
    expect(machine.snapshots[0].state).toBe('CONVERSATION');
    expect(machine.snapshots[0].event).toBeNull();
  });

  it('allows setting projectPath after construction', () => {
    const m = new SessionStateMachine({
      conversationId: 'test',
      participants: makeParticipants(),
      ctx: createDefaultSsmContext(),
    });
    expect(m.projectPath).toBeNull();
    m.setProjectPath('/new/path');
    expect(m.projectPath).toBe('/new/path');
    m.dispose();
  });

  // ── Conversation → Mode Transition (guard-based) ────────────

  it('transitions CONVERSATION → MODE_TRANSITION_PENDING when majority votes work', () => {
    machine.recordModeJudgment({ participantId: 'ai-1', participantName: 'Alpha', judgment: 'work' });
    machine.recordModeJudgment({ participantId: 'ai-2', participantName: 'Beta', judgment: 'work' });
    machine.recordModeJudgment({ participantId: 'ai-3', participantName: 'Gamma', judgment: 'conversation' });
    const result = machine.transition('ROUND_COMPLETE');
    expect(result).toBe('MODE_TRANSITION_PENDING');
    expect(machine.state).toBe('MODE_TRANSITION_PENDING');
  });

  it('stays in CONVERSATION when no work majority on ROUND_COMPLETE (further_discussion)', () => {
    machine.recordModeJudgment({ participantId: 'ai-1', participantName: 'Alpha', judgment: 'conversation', reason: 'further_discussion' });
    machine.recordModeJudgment({ participantId: 'ai-2', participantName: 'Beta', judgment: 'conversation', reason: 'further_discussion' });
    const result = machine.transition('ROUND_COMPLETE');
    expect(result).toBe('CONVERSATION');
    expect(machine.state).toBe('CONVERSATION');
  });

  // dogfooding 2026-05-01 #2-1 — unanimous no_action concludes naturally.
  it('transitions CONVERSATION → DONE when all judgments are conversation + no_action', () => {
    machine.recordModeJudgment({ participantId: 'ai-1', participantName: 'Alpha', judgment: 'conversation', reason: 'no_action' });
    machine.recordModeJudgment({ participantId: 'ai-2', participantName: 'Beta', judgment: 'conversation', reason: 'no_action' });
    machine.recordModeJudgment({ participantId: 'ai-3', participantName: 'Gamma', judgment: 'conversation', reason: 'no_action' });
    const result = machine.transition('ROUND_COMPLETE');
    expect(result).toBe('DONE');
    expect(machine.isTerminal).toBe(true);
  });

  it('does NOT terminate when one participant still wants further_discussion', () => {
    machine.recordModeJudgment({ participantId: 'ai-1', participantName: 'Alpha', judgment: 'conversation', reason: 'no_action' });
    machine.recordModeJudgment({ participantId: 'ai-2', participantName: 'Beta', judgment: 'conversation', reason: 'further_discussion' });
    const result = machine.transition('ROUND_COMPLETE');
    expect(result).toBe('CONVERSATION');
    expect(machine.state).toBe('CONVERSATION');
  });

  it('transitions CONVERSATION → PAUSED on USER_PAUSE', () => {
    const result = machine.transition('USER_PAUSE');
    expect(result).toBe('PAUSED');
    expect(machine.state).toBe('PAUSED');
  });

  // ── Mode Transition ──────────────────────────────────────────

  it('transitions MODE_TRANSITION_PENDING → WORK_DISCUSSING on USER_APPROVE_MODE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    const result = machine.transition('USER_APPROVE_MODE');
    expect(result).toBe('WORK_DISCUSSING');
  });

  it('transitions MODE_TRANSITION_PENDING → CONVERSATION on USER_REJECT_MODE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    const result = machine.transition('USER_REJECT_MODE');
    expect(result).toBe('CONVERSATION');
  });

  // ── Work Discussion → Consensus ──────────────────────────────

  it('transitions WORK_DISCUSSING → SYNTHESIZING on ROUND_COMPLETE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    const result = machine.transition('ROUND_COMPLETE');
    expect(result).toBe('SYNTHESIZING');
  });

  it('transitions SYNTHESIZING → VOTING on SYNTHESIS_COMPLETE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    const result = machine.transition('SYNTHESIS_COMPLETE');
    expect(result).toBe('VOTING');
  });

  it('transitions VOTING → CONSENSUS_APPROVED on ALL_AGREE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    const result = machine.transition('ALL_AGREE');
    expect(result).toBe('CONSENSUS_APPROVED');
  });

  it('transitions VOTING → WORK_DISCUSSING on DISAGREE with retries', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    const result = machine.transition('DISAGREE');
    expect(result).toBe('WORK_DISCUSSING');
    expect(machine.retryCount).toBe(1);
  });

  it('transitions VOTING → FAILED on DISAGREE without retries', () => {
    machine = new SessionStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
      ctx: TEST_CTX,
      projectPath: '/test/project',
      config: { maxRetries: 0 },
    });
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    const result = machine.transition('DISAGREE');
    expect(result).toBe('FAILED');
  });

  // ── Worker Selection → Execution ─────────────────────────────

  it('transitions CONSENSUS_APPROVED → EXECUTING on USER_SELECT_WORKER', () => {
    // Fast-forward to CONSENSUS_APPROVED
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');

    machine.setWorkerId('ai-1');
    const result = machine.transition('USER_SELECT_WORKER');
    expect(result).toBe('EXECUTING');
    expect(machine.workerId).toBe('ai-1');
  });

  // ── Execution → Review ───────────────────────────────────────

  it('transitions EXECUTING → REVIEWING on WORKER_DONE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');

    const result = machine.transition('WORKER_DONE');
    expect(result).toBe('REVIEWING');
  });

  // ── Review → User Decision ───────────────────────────────────

  it('transitions REVIEWING → USER_DECISION on REVIEW_COMPLETE', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');

    const result = machine.transition('REVIEW_COMPLETE');
    expect(result).toBe('USER_DECISION');
  });

  // ── User Decision outcomes ───────────────────────────────────

  it('transitions USER_DECISION → DONE on USER_ACCEPT', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');
    machine.transition('REVIEW_COMPLETE');

    const result = machine.transition('USER_ACCEPT');
    expect(result).toBe('DONE');
    expect(machine.isTerminal).toBe(true);
  });

  it('transitions USER_DECISION → EXECUTING on USER_REWORK', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');
    machine.transition('REVIEW_COMPLETE');

    const result = machine.transition('USER_REWORK');
    expect(result).toBe('EXECUTING');
  });

  it('transitions USER_DECISION → CONSENSUS_APPROVED on USER_REASSIGN', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');
    machine.transition('REVIEW_COMPLETE');

    const result = machine.transition('USER_REASSIGN');
    expect(result).toBe('CONSENSUS_APPROVED');
    expect(machine.workerId).toBeNull(); // old worker cleared
  });

  it('transitions USER_DECISION → DONE on USER_STOP', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');
    machine.transition('REVIEW_COMPLETE');

    const result = machine.transition('USER_STOP');
    expect(result).toBe('DONE');
  });

  // ── Permission hooks ─────────────────────────────────────────

  it('emits grant_worker permission on CONSENSUS_APPROVED → EXECUTING', () => {
    const permissionActions: unknown[] = [];
    machine.onPermissionAction((action) => permissionActions.push(action));

    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');

    expect(permissionActions).toContainEqual({ type: 'grant_worker', workerId: 'ai-1' });
  });

  it('emits revoke_worker permission on EXECUTING → REVIEWING', () => {
    const permissionActions: unknown[] = [];
    machine.onPermissionAction((action) => permissionActions.push(action));

    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');

    expect(permissionActions).toContainEqual({ type: 'revoke_worker', workerId: 'ai-1' });
  });

  it('emits revoke_all permission on USER_DECISION → DONE', () => {
    const permissionActions: unknown[] = [];
    machine.onPermissionAction((action) => permissionActions.push(action));

    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    machine.transition('ROUND_COMPLETE');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.transition('ALL_AGREE');
    machine.setWorkerId('ai-1');
    machine.transition('USER_SELECT_WORKER');
    machine.transition('WORKER_DONE');
    machine.transition('REVIEW_COMPLETE');
    machine.transition('USER_ACCEPT');

    expect(permissionActions).toContainEqual({ type: 'revoke_all' });
  });

  // ── Snapshot persistence ─────────────────────────────────────

  it('saves a snapshot on every transition', () => {
    voteWorkMajority(machine);
    machine.transition('ROUND_COMPLETE');
    machine.transition('USER_APPROVE_MODE');
    // Initial(1) + ROUND_COMPLETE→MODE_TRANSITION_PENDING(2) + USER_APPROVE_MODE→WORK_DISCUSSING(3) = 3
    expect(machine.snapshots.length).toBe(3);
    expect(machine.snapshots[1].state).toBe('MODE_TRANSITION_PENDING');
    expect(machine.snapshots[2].state).toBe('WORK_DISCUSSING');
  });

  // ── Invalid transitions ──────────────────────────────────────

  it('returns null for invalid transitions', () => {
    // CONVERSATION + WORKER_DONE is invalid
    const result = machine.transition('WORKER_DONE');
    expect(result).toBeNull();
    expect(machine.state).toBe('CONVERSATION');
  });

  it('throws on transition from terminal state', () => {
    machine.transition('ERROR');
    expect(machine.isTerminal).toBe(true);
    expect(() => machine.transition('ROUND_COMPLETE')).toThrow();
  });

  // ── toInfo serialization ─────────────────────────────────────

  it('serializes to SessionInfo', () => {
    const info = machine.toInfo();
    expect(info.state).toBe('CONVERSATION');
    expect(info.conversationRound).toBe(0);
    expect(info.workerId).toBeNull();
  });
});
