/**
 * Tests for ConsensusEvaluator — vote evaluation, block checks, pass conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsensusEvaluator } from '../consensus-evaluator';
import { ConsensusStateMachine } from '../consensus-machine';
import { DEFAULT_CONVERSATION_TASK_SETTINGS } from '../../../shared/config-types';
import type { VoteRecord } from '../../../shared/consensus-types';
import type { Participant } from '../../../shared/engine-types';

const makeParticipants = (): Participant[] => [
  { id: 'ai-1', displayName: 'Claude', isActive: true, providerId: 'claude' },
  { id: 'ai-2', displayName: 'Gemini', isActive: true, providerId: 'gemini' },
  { id: 'user', displayName: 'User', isActive: true },
];

describe('ConsensusEvaluator', () => {
  let machine: ConsensusStateMachine;
  let evaluator: ConsensusEvaluator;

  beforeEach(() => {
    machine = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
    });
    evaluator = new ConsensusEvaluator(DEFAULT_CONVERSATION_TASK_SETTINGS);

    // Move to VOTING phase
    machine.transition('ROUND_DONE');
    machine.transition('SYNTHESIS_COMPLETE');
  });

  afterEach(() => {
    machine.dispose();
  });

  it('detects hard block', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'block',
      blockReasonType: 'security',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'agree',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('hard_block');
  });

  it('detects hard block for data_loss', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'block',
      blockReasonType: 'data_loss',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('hard_block');
  });

  it('detects soft block (spec_conflict)', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'block',
      blockReasonType: 'spec_conflict',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'agree',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('passed');
    expect(result).toHaveProperty('hasSoftBlock', true);
  });

  it('returns passed when all agree', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'agree',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'agree',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('passed');
    if (result.outcome === 'passed') {
      expect(result.hasSoftBlock).toBe(false);
    }
  });

  it('returns failed when not unanimous with 2 participants', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'agree',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'disagree',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('failed');
  });

  it('returns insufficient_votes when valid vote count below minimum', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'abstain',
      comment: 'parse failure',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'abstain',
      comment: 'timeout',
      timestamp: Date.now(),
    });

    const result = evaluator.evaluate(machine, 2);
    expect(result.outcome).toBe('insufficient_votes');
  });

  it('checkHardBlock returns false for non-block votes', () => {
    const votes: VoteRecord[] = [
      { participantId: 'ai-1', participantName: 'Claude', vote: 'agree', timestamp: Date.now() },
    ];
    expect(evaluator.checkHardBlock(votes)).toBe(false);
  });

  it('checkSoftBlock returns false for hard block reason', () => {
    const votes: VoteRecord[] = [
      { participantId: 'ai-1', participantName: 'Claude', vote: 'block', blockReasonType: 'security', timestamp: Date.now() },
    ];
    // security is a hard block, not a soft block
    expect(evaluator.checkSoftBlock(votes)).toBe(false);
  });

  it('human vote with non-unknown blockReasonType is included in votes', () => {
    machine.recordVote({
      participantId: 'ai-1',
      participantName: 'Claude',
      vote: 'agree',
      timestamp: Date.now(),
    });
    machine.recordVote({
      participantId: 'ai-2',
      participantName: 'Gemini',
      vote: 'agree',
      timestamp: Date.now(),
    });

    // Simulate human block vote with security reason
    const humanVote: VoteRecord = {
      participantId: 'user',
      participantName: 'User',
      source: 'human',
      vote: 'block',
      blockReasonType: 'security',
      timestamp: Date.now(),
    };
    machine.setHumanVote(humanVote);

    // setHumanVote pushes into csm.votes, so checkHardBlock detects it
    const allVotes = [...(machine.votes as VoteRecord[])];
    expect(allVotes).toHaveLength(3);
    expect(evaluator.checkHardBlock(allVotes)).toBe(true);
    expect(humanVote.blockReasonType).toBe('security');
  });
});
