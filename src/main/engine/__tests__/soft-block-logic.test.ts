/**
 * Tests for voting rules: soft block, hard block, unanimity, majority.
 *
 * Validates the ConsensusStateMachine behavior with various vote
 * combinations and block types.
 */

import { describe, it, expect } from 'vitest';
import { ConsensusStateMachine } from '../consensus-machine';

const TWO_PARTICIPANTS = [
  { id: 'ai-1', providerId: 'ai-1', displayName: 'AI 1', isActive: true },
  { id: 'ai-2', providerId: 'ai-2', displayName: 'AI 2', isActive: true },
];

const THREE_PARTICIPANTS = [
  ...TWO_PARTICIPANTS,
  { id: 'ai-3', providerId: 'ai-3', displayName: 'AI 3', isActive: true },
];

function createCSM(participants = TWO_PARTICIPANTS, config = {}) {
  return new ConsensusStateMachine({
    conversationId: 'test-conv',
    participants,
    config: { maxRetries: 3, phaseTimeout: 0, ...config },
  });
}

function advanceToVoting(csm: ConsensusStateMachine) {
  csm.transition('ROUND_DONE');  // DISCUSSING → SYNTHESIZING
  csm.setProposal('Test proposal');
  csm.transition('SYNTHESIS_COMPLETE');  // SYNTHESIZING → VOTING
}

describe('Hard Block Logic', () => {
  it('hasHardBlock detects security block', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'security', timestamp: Date.now(),
    });

    expect(csm.hasHardBlock()).toBe(true);
  });

  it('hasHardBlock detects data_loss block', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'data_loss', timestamp: Date.now(),
    });

    expect(csm.hasHardBlock()).toBe(true);
  });

  it('hasHardBlock returns false for soft block types', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'spec_conflict', timestamp: Date.now(),
    });

    expect(csm.hasHardBlock()).toBe(false);
  });
});

describe('Soft Block Logic', () => {
  it('hasSoftBlock detects spec_conflict block', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'spec_conflict', timestamp: Date.now(),
    });

    expect(csm.hasSoftBlock()).toBe(true);
  });

  it('hasSoftBlock detects unknown block', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'unknown', timestamp: Date.now(),
    });

    expect(csm.hasSoftBlock()).toBe(true);
  });

  it('hasSoftBlock returns false for hard block types', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'block', blockReasonType: 'security', timestamp: Date.now(),
    });

    expect(csm.hasSoftBlock()).toBe(false);
  });
});

describe('Unanimity Rules', () => {
  it('isUnanimous returns true when all agree', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });
    csm.recordVote({
      participantId: 'ai-2', participantName: 'AI 2', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });

    expect(csm.isUnanimous()).toBe(true);
  });

  it('isUnanimous returns false when one disagrees', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });
    csm.recordVote({
      participantId: 'ai-2', participantName: 'AI 2', source: 'ai',
      vote: 'disagree', timestamp: Date.now(),
    });

    expect(csm.isUnanimous()).toBe(false);
  });

  it('isUnanimous returns false when not all voted', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });

    expect(csm.isUnanimous()).toBe(false);
  });
});

describe('Minimum Valid Votes', () => {
  it('min valid votes for 2 participants is 1', () => {
    const csm = createCSM(TWO_PARTICIPANTS);
    expect(csm.getMinValidVotes()).toBe(1);
  });

  it('min valid votes for 3 participants is 2', () => {
    const csm = createCSM(THREE_PARTICIPANTS);
    expect(csm.getMinValidVotes()).toBe(2);
  });

  it('abstain votes are excluded from valid vote count', () => {
    const csm = createCSM(THREE_PARTICIPANTS);
    advanceToVoting(csm);

    csm.recordVote({
      participantId: 'ai-1', participantName: 'AI 1', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });
    csm.recordVote({
      participantId: 'ai-2', participantName: 'AI 2', source: 'ai',
      vote: 'abstain', timestamp: Date.now(),
    });
    csm.recordVote({
      participantId: 'ai-3', participantName: 'AI 3', source: 'ai',
      vote: 'agree', timestamp: Date.now(),
    });

    expect(csm.getValidVoteCount()).toBe(2);
  });
});

describe('Vote Transitions', () => {
  it('ALL_AGREE transitions from VOTING to AWAITING_USER', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.transition('ALL_AGREE');
    expect(csm.phase).toBe('AWAITING_USER');
  });

  it('DISAGREE in VOTING retries (goes back to DISCUSSING)', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.transition('DISAGREE');
    expect(csm.phase).toBe('DISCUSSING');
    expect(csm.retryCount).toBe(1);
  });

  it('DISAGREE after max retries goes to FAILED', () => {
    const csm = createCSM(TWO_PARTICIPANTS, { maxRetries: 1 });
    advanceToVoting(csm);

    csm.transition('DISAGREE');
    expect(csm.phase).toBe('FAILED');
  });

  it('ERROR in VOTING goes to FAILED', () => {
    const csm = createCSM();
    advanceToVoting(csm);

    csm.transition('ERROR');
    expect(csm.phase).toBe('FAILED');
  });
});

describe('Post-vote phase transitions', () => {
  it('USER_APPROVE transitions AWAITING_USER to APPLYING', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');

    csm.transition('USER_APPROVE');
    expect(csm.phase).toBe('APPLYING');
  });

  it('USER_REVISE transitions AWAITING_USER back to DISCUSSING', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');

    csm.transition('USER_REVISE');
    expect(csm.phase).toBe('DISCUSSING');
  });

  it('USER_REJECT transitions AWAITING_USER to DISCUSSING (free-talk recovery)', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');

    csm.transition('USER_REJECT');
    expect(csm.phase).toBe('DISCUSSING');
  });

  it('USER_ABORT transitions AWAITING_USER to FAILED', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');

    csm.transition('USER_ABORT');
    expect(csm.phase).toBe('FAILED');
  });

  it('APPLY_SUCCESS transitions APPLYING to REVIEWING', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');
    csm.transition('USER_APPROVE');

    csm.transition('APPLY_SUCCESS');
    expect(csm.phase).toBe('REVIEWING');
  });

  it('REVIEW_SUCCESS transitions REVIEWING to DONE', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');
    csm.transition('USER_APPROVE');
    csm.transition('APPLY_SUCCESS');

    csm.transition('REVIEW_SUCCESS');
    expect(csm.phase).toBe('DONE');
    expect(csm.isTerminal).toBe(true);
  });

  it('APPLY_FAILED transitions APPLYING to FAILED', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');
    csm.transition('USER_APPROVE');

    csm.transition('APPLY_FAILED');
    expect(csm.phase).toBe('FAILED');
    expect(csm.getFailureStage()).toBe('EXECUTE');
  });

  it('REVIEW_FAILED transitions REVIEWING to FAILED', () => {
    const csm = createCSM();
    advanceToVoting(csm);
    csm.transition('ALL_AGREE');
    csm.transition('USER_APPROVE');
    csm.transition('APPLY_SUCCESS');

    csm.transition('REVIEW_FAILED');
    expect(csm.phase).toBe('FAILED');
    expect(csm.getFailureStage()).toBe('REVIEW');
  });
});
