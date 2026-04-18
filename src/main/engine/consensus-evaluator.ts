/**
 * ConsensusEvaluator — extracts vote evaluation logic from the orchestrator
 * for better separation of concerns.
 *
 * Responsibilities:
 * - Check for hard blocks (config-driven)
 * - Check for soft blocks (config-driven)
 * - Evaluate pass condition (unanimity vs majority rules)
 * - Determine the consensus outcome event
 */

import type { VoteRecord } from '../../shared/consensus-types';
import type { ConversationTaskSettings } from '../../shared/config-types';
import type { ConsensusStateMachine } from './consensus-machine';

export type EvaluationResult =
  | { outcome: 'hard_block' }
  | { outcome: 'insufficient_votes' }
  | { outcome: 'passed'; hasSoftBlock: boolean }
  | { outcome: 'failed' };

export class ConsensusEvaluator {
  private settings: ConversationTaskSettings;

  constructor(settings: ConversationTaskSettings) {
    this.settings = settings;
  }

  /**
   * Evaluate the current votes and determine the consensus outcome.
   */
  evaluate(csm: ConsensusStateMachine, activeParticipantCount: number): EvaluationResult {
    const minValidVotes = csm.getMinValidVotes();
    const validVoteCount = csm.getValidVoteCount();
    const voteRecords = csm.votes as VoteRecord[];

    // Hard block check
    if (this.checkHardBlock(voteRecords)) {
      return { outcome: 'hard_block' };
    }

    // Insufficient votes check
    if (validVoteCount < minValidVotes) {
      return { outcome: 'insufficient_votes' };
    }

    // Soft block check
    const hasSoftBlock = this.checkSoftBlock(voteRecords);

    // Pass condition check
    const passed = this.checkPassCondition(voteRecords, csm, activeParticipantCount);

    if (hasSoftBlock || passed) {
      return { outcome: 'passed', hasSoftBlock };
    }

    return { outcome: 'failed' };
  }

  /** Check if any vote is a hard block (based on configured hard block reason types). */
  checkHardBlock(votes: VoteRecord[]): boolean {
    return votes.some(v =>
      v.vote === 'block' && v.blockReasonType != null
        && (this.settings.hardBlockReasonTypes as string[]).includes(v.blockReasonType),
    );
  }

  /** Check if any vote is a soft block (based on configured soft block reason types). */
  checkSoftBlock(votes: VoteRecord[]): boolean {
    return votes.some(v =>
      v.vote === 'block' && v.blockReasonType != null
        && (this.settings.softBlockReasonTypes as string[]).includes(v.blockReasonType),
    );
  }

  /** Determine if the vote passes based on unanimity/majority rules. */
  checkPassCondition(
    votes: VoteRecord[],
    csm: ConsensusStateMachine,
    activeParticipantCount: number,
  ): boolean {
    const agreeCount = votes.filter(v => v.vote === 'agree').length;
    const opposeCount = votes.filter(v => v.vote === 'disagree' || v.vote === 'block').length;

    const requiresUnanimity = this.settings.twoParticipantUnanimousRequired
      && activeParticipantCount <= 2;
    const useMajority = activeParticipantCount >= this.settings.majorityAllowedFromParticipants;

    if (requiresUnanimity) {
      return csm.isUnanimous();
    }
    if (useMajority) {
      return agreeCount > opposeCount;
    }
    return csm.isUnanimous();
  }
}
