/**
 * Integration tests: Full ConsensusStateMachine lifecycle.
 *
 * Tests the complete consensus flow through all seven phases,
 * including disagreement/retry, user actions, failure paths,
 * pause/resume, snapshot persistence, and terminal state guards.
 *
 * Uses the real ConsensusStateMachine with no mocks — pure state machine testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsensusStateMachine } from '../consensus-machine';
import { makeVote, PARTICIPANTS_2AI, PARTICIPANTS_3AI } from '../../../test-utils';
import type { Participant } from '../../../shared/engine-types';

// ── Helpers ──────────────────────────────────────────────────────────

/** Drive machine from DISCUSSING to VOTING. */
function driveToVoting(machine: ConsensusStateMachine): void {
  machine.transition('ROUND_DONE');       // DISCUSSING → SYNTHESIZING
  machine.selectAggregator();
  machine.setProposal('Test proposal');
  machine.transition('SYNTHESIS_COMPLETE'); // SYNTHESIZING → VOTING
}

/** Drive machine from DISCUSSING to AWAITING_USER (unanimous vote). */
function driveToAwaitingUser(machine: ConsensusStateMachine, participants: Participant[]): void {
  driveToVoting(machine);
  const aiParticipants = participants.filter(p => p.isActive && p.id !== 'user');
  for (const p of aiParticipants) {
    machine.recordVote(makeVote(p.id, 'agree'));
  }
  machine.transition('ALL_AGREE'); // VOTING → AWAITING_USER
}

/** Drive machine from DISCUSSING to REVIEWING. */
function driveToReviewing(machine: ConsensusStateMachine, participants: Participant[]): void {
  driveToAwaitingUser(machine, participants);
  machine.transition('USER_APPROVE');  // AWAITING_USER → APPLYING
  machine.transition('APPLY_SUCCESS'); // APPLYING → REVIEWING
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ConsensusStateMachine full lifecycle', () => {
  let machine: ConsensusStateMachine;

  beforeEach(() => {
    machine = new ConsensusStateMachine({
      conversationId: 'conv-integ-1',
      participants: [...PARTICIPANTS_3AI],
    });
  });

  afterEach(() => {
    machine.dispose();
  });

  // ── Happy path full cycle ─────────────────────────────────────────

  it('completes full happy path: DISCUSSING → SYNTHESIZING → VOTING → AWAITING_USER → APPLYING → REVIEWING → DONE', () => {
    // DISCUSSING → SYNTHESIZING
    expect(machine.transition('ROUND_DONE')).toBe('SYNTHESIZING');
    expect(machine.phase).toBe('SYNTHESIZING');

    // Set up aggregator and proposal
    machine.selectAggregator();
    machine.setProposal('Implement feature X with React');

    // SYNTHESIZING → VOTING
    expect(machine.transition('SYNTHESIS_COMPLETE')).toBe('VOTING');
    expect(machine.phase).toBe('VOTING');

    // Record unanimous votes from all AI participants
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.recordVote(makeVote('ai-3', 'agree'));
    expect(machine.allVotesReceived()).toBe(true);
    expect(machine.isUnanimous()).toBe(true);

    // VOTING → AWAITING_USER
    expect(machine.transition('ALL_AGREE')).toBe('AWAITING_USER');

    // AWAITING_USER → APPLYING
    expect(machine.transition('USER_APPROVE')).toBe('APPLYING');

    // APPLYING → REVIEWING
    expect(machine.transition('APPLY_SUCCESS')).toBe('REVIEWING');

    // REVIEWING → DONE
    expect(machine.transition('REVIEW_SUCCESS')).toBe('DONE');
    expect(machine.phase).toBe('DONE');
    expect(machine.isTerminal).toBe(true);
  });

  // ── Disagreement + retry ──────────────────────────────────────────

  it('disagrees and retries: VOTING → DISCUSSING with retryCount incremented, round incremented', () => {
    driveToVoting(machine);

    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'disagree'));
    machine.recordVote(makeVote('ai-3', 'disagree'));

    const prevRound = machine.round;
    expect(machine.transition('DISAGREE')).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);
    expect(machine.round).toBe(prevRound + 1);
    expect(machine.votes).toHaveLength(0); // votes cleared
    expect(machine.proposal).toBeNull();   // proposal cleared
  });

  it('after disagreement, new round can succeed through to DONE', () => {
    driveToVoting(machine);
    machine.recordVote(makeVote('ai-1', 'disagree'));
    machine.transition('DISAGREE'); // → DISCUSSING (retry)

    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);

    // Second attempt: drive to DONE
    driveToVoting(machine);
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.recordVote(makeVote('ai-3', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');

    expect(machine.phase).toBe('DONE');
    expect(machine.isTerminal).toBe(true);
    expect(machine.retryCount).toBe(1); // still 1 from the first retry
  });

  // ── Max retries exceeded ──────────────────────────────────────────

  it('fails when maxRetries exceeded on DISAGREE', () => {
    machine.dispose();
    machine = new ConsensusStateMachine({
      conversationId: 'conv-integ-2',
      participants: [...PARTICIPANTS_2AI],
      config: { maxRetries: 2 },
    });

    // First DISAGREE: retryCount 0→1, under limit (1 < 2)
    driveToVoting(machine);
    expect(machine.transition('DISAGREE')).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);

    // Second DISAGREE: retryCount 1→2, at limit (2 >= 2) → FAILED
    driveToVoting(machine);
    expect(machine.transition('DISAGREE')).toBe('FAILED');
    expect(machine.retryCount).toBe(2);
    expect(machine.isTerminal).toBe(true);
  });

  // ── User revise ───────────────────────────────────────────────────

  it('USER_REVISE returns to DISCUSSING with votes cleared', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);
    expect(machine.phase).toBe('AWAITING_USER');

    expect(machine.transition('USER_REVISE')).toBe('DISCUSSING');
    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.votes).toHaveLength(0);
    expect(machine.proposal).toBeNull();
    expect(machine.isTerminal).toBe(false);

    // Can proceed again to DONE
    driveToVoting(machine);
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.recordVote(makeVote('ai-3', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');
  });

  // ── User reject ───────────────────────────────────────────────────

  it('USER_REJECT returns to DISCUSSING (free-talk recovery)', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);

    expect(machine.transition('USER_REJECT')).toBe('DISCUSSING');
    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.isTerminal).toBe(false);
  });

  // ── User abort ────────────────────────────────────────────────────

  it('USER_ABORT from AWAITING_USER transitions to FAILED', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);

    expect(machine.transition('USER_ABORT')).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
  });

  // ── Apply failure ─────────────────────────────────────────────────

  it('APPLY_FAILED transitions to FAILED', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);
    machine.transition('USER_APPROVE'); // → APPLYING

    expect(machine.transition('APPLY_FAILED')).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
    expect(machine.getFailureStage()).toBe('EXECUTE');
  });

  // ── Review failure ────────────────────────────────────────────────

  it('REVIEW_FAILED transitions to FAILED', () => {
    driveToReviewing(machine, PARTICIPANTS_3AI);
    expect(machine.phase).toBe('REVIEWING');

    expect(machine.transition('REVIEW_FAILED')).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
    expect(machine.getFailureStage()).toBe('REVIEW');
  });

  // ── Pause/resume (via timeout management) ─────────────────────────

  it('state is preserved across phase timeout clear/restart', () => {
    driveToVoting(machine);
    machine.recordVote(makeVote('ai-1', 'agree'));

    // Simulate "pause": clear timeout, state preserved
    machine.clearPhaseTimeout();
    expect(machine.phase).toBe('VOTING');
    expect(machine.votes).toHaveLength(1);
    expect(machine.proposal).toBe('Test proposal');

    // Simulate "resume": continue from where we left off
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.recordVote(makeVote('ai-3', 'agree'));
    expect(machine.isUnanimous()).toBe(true);

    machine.transition('ALL_AGREE');
    expect(machine.phase).toBe('AWAITING_USER');
  });

  // ── Terminal state double transition blocked ──────────────────────

  it('further transitions throw from terminal DONE state', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);
    machine.transition('USER_APPROVE');
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');
    expect(machine.phase).toBe('DONE');

    expect(() => machine.transition('ROUND_DONE')).toThrow(/terminal state/);
    expect(() => machine.transition('ERROR')).toThrow(/terminal state/);
  });

  it('further transitions throw from terminal FAILED state', () => {
    machine.transition('ERROR'); // DISCUSSING → FAILED
    expect(machine.phase).toBe('FAILED');

    expect(() => machine.transition('ROUND_DONE')).toThrow(/terminal state/);
    expect(() => machine.transition('USER_APPROVE')).toThrow(/terminal state/);
  });

  // ── Snapshot persister ────────────────────────────────────────────

  it('snapshot persister is called on every transition', () => {
    const persister = vi.fn();
    machine.setSnapshotPersister(persister);

    machine.transition('ROUND_DONE'); // → SYNTHESIZING
    expect(persister).toHaveBeenCalledTimes(1);
    expect(persister).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'SYNTHESIZING' }),
    );

    machine.transition('SYNTHESIS_COMPLETE'); // → VOTING
    expect(persister).toHaveBeenCalledTimes(2);
    expect(persister).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'VOTING' }),
    );
  });

  // ── Snapshot chain: verify phases match transition order ───────────

  it('snapshot chain phases match the transition order', () => {
    driveToAwaitingUser(machine, PARTICIPANTS_3AI);
    machine.transition('USER_APPROVE');
    machine.transition('APPLY_SUCCESS');
    machine.transition('REVIEW_SUCCESS');

    const phases = machine.snapshots.map(s => s.phase);

    // Initial snapshot + 7 transitions
    expect(phases).toEqual([
      'DISCUSSING',     // initial
      'SYNTHESIZING',   // ROUND_DONE
      'VOTING',         // SYNTHESIS_COMPLETE
      'AWAITING_USER',  // ALL_AGREE
      'APPLYING',       // USER_APPROVE
      'REVIEWING',      // APPLY_SUCCESS
      'DONE',           // REVIEW_SUCCESS
    ]);

    // Verify events match
    const events = machine.snapshots.map(s => s.event);
    expect(events).toEqual([
      null,                 // initial
      'ROUND_DONE',
      'SYNTHESIS_COMPLETE',
      'ALL_AGREE',
      'USER_APPROVE',
      'APPLY_SUCCESS',
      'REVIEW_SUCCESS',
    ]);
  });
});
