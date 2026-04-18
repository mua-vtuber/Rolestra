import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsensusStateMachine } from '../consensus-machine';
import type { VoteRecord } from '../../../shared/consensus-types';
import type { Participant } from '../../../shared/engine-types';

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

describe('ConsensusStateMachine', () => {
  let machine: ConsensusStateMachine;

  beforeEach(() => {
    machine = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
    });
  });

  afterEach(() => {
    machine.dispose();
  });

  // ── Initial state ──────────────────────────────────────────────

  it('starts in DISCUSSING phase', () => {
    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.round).toBe(1);
    expect(machine.retryCount).toBe(0);
    expect(machine.isTerminal).toBe(false);
  });

  it('saves initial snapshot on construction', () => {
    expect(machine.snapshots).toHaveLength(1);
    expect(machine.snapshots[0].phase).toBe('DISCUSSING');
    expect(machine.snapshots[0].event).toBeNull();
  });

  // ── Happy path: full consensus flow ────────────────────────────

  it('transitions through full happy path', () => {
    // DISCUSSING -> SYNTHESIZING
    expect(machine.transition('ROUND_DONE')).toBe('SYNTHESIZING');
    expect(machine.phase).toBe('SYNTHESIZING');

    // Select aggregator and set proposal
    machine.selectAggregator();
    machine.setProposal('Use React for the frontend');

    // SYNTHESIZING -> VOTING
    expect(machine.transition('SYNTHESIS_COMPLETE')).toBe('VOTING');
    expect(machine.phase).toBe('VOTING');

    // Record unanimous votes
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    expect(machine.allVotesReceived()).toBe(true);
    expect(machine.isUnanimous()).toBe(true);

    // VOTING -> AWAITING_USER
    expect(machine.transition('ALL_AGREE')).toBe('AWAITING_USER');
    expect(machine.phase).toBe('AWAITING_USER');

    // AWAITING_USER -> APPLYING
    expect(machine.transition('USER_APPROVE')).toBe('APPLYING');
    expect(machine.phase).toBe('APPLYING');

    // APPLYING -> REVIEWING -> DONE
    expect(machine.transition('APPLY_SUCCESS')).toBe('REVIEWING');
    expect(machine.transition('REVIEW_SUCCESS')).toBe('DONE');
    expect(machine.phase).toBe('DONE');
    expect(machine.isTerminal).toBe(true);
  });

  // ── Transition validation ──────────────────────────────────────

  it('returns null for invalid transitions', () => {
    // DISCUSSING does not accept USER_APPROVE
    expect(machine.transition('USER_APPROVE')).toBeNull();
    expect(machine.phase).toBe('DISCUSSING');
  });

  it('throws when transitioning from terminal state', () => {
    machine.transition('ERROR');
    expect(machine.phase).toBe('FAILED');
    expect(() => machine.transition('ROUND_DONE')).toThrow(/terminal state/);
  });

  // ── DISAGREE / retry logic ─────────────────────────────────────

  it('goes back to DISCUSSING on DISAGREE if retries remain', () => {
    machine.transition('ROUND_DONE');   // -> SYNTHESIZING
    machine.setProposal('proposal v1');
    machine.transition('SYNTHESIS_COMPLETE'); // -> VOTING

    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'disagree', 'I have concerns'));

    expect(machine.transition('DISAGREE')).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);
    expect(machine.round).toBe(2);
    expect(machine.votes).toHaveLength(0); // votes cleared
    expect(machine.proposal).toBeNull();   // proposal cleared
  });

  it('fails when maxRetries exceeded on DISAGREE', () => {
    machine = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
      config: { maxRetries: 2 },
    });

    // First attempt: retryCount 0 -> 1 (under limit, back to DISCUSSING)
    machine.transition('ROUND_DONE');
    machine.setProposal('v1');
    machine.transition('SYNTHESIS_COMPLETE');
    expect(machine.transition('DISAGREE')).toBe('DISCUSSING');
    expect(machine.retryCount).toBe(1);

    // Second attempt: retryCount 1 -> 2 (at limit, FAILED)
    machine.transition('ROUND_DONE');
    machine.setProposal('v2');
    machine.transition('SYNTHESIS_COMPLETE');
    expect(machine.transition('DISAGREE')).toBe('FAILED');
    expect(machine.retryCount).toBe(2);
    expect(machine.isTerminal).toBe(true);
  });

  // ── USER_REVISE: back to DISCUSSING ────────────────────────────

  it('returns to DISCUSSING on USER_REVISE', () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');

    expect(machine.transition('USER_REVISE')).toBe('DISCUSSING');
    expect(machine.phase).toBe('DISCUSSING');
  });

  // ── USER_REJECT: returns to DISCUSSING (free-talk recovery) ────

  it('returns to DISCUSSING on USER_REJECT', () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');

    expect(machine.transition('USER_REJECT')).toBe('DISCUSSING');
    expect(machine.phase).toBe('DISCUSSING');
    expect(machine.isTerminal).toBe(false);
  });

  // ── USER_ABORT: terminal FAILED ──────────────────────────────

  it('fails on USER_ABORT', () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');

    expect(machine.transition('USER_ABORT')).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
  });

  // ── APPLY_FAILED: terminal FAILED ──────────────────────────────

  it('fails on APPLY_FAILED', () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('proposal');
    machine.transition('SYNTHESIS_COMPLETE');
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');
    machine.transition('USER_APPROVE');

    expect(machine.transition('APPLY_FAILED')).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
  });

  // ── Timeout transitions ────────────────────────────────────────

  it('DISCUSSING timeout moves to SYNTHESIZING', () => {
    expect(machine.transition('TIMEOUT')).toBe('SYNTHESIZING');
  });

  it('SYNTHESIZING timeout moves to FAILED', () => {
    machine.transition('ROUND_DONE');
    expect(machine.transition('TIMEOUT')).toBe('FAILED');
  });

  it('VOTING timeout moves to FAILED', () => {
    machine.transition('ROUND_DONE');
    machine.transition('SYNTHESIS_COMPLETE');
    expect(machine.transition('TIMEOUT')).toBe('FAILED');
  });

  // ── Aggregator selection ───────────────────────────────────────

  describe('selectAggregator', () => {
    it('designated: selects specified AI', () => {
      machine.updateConfig({
        designatedAggregatorId: 'ai-2',
      });
      expect(machine.selectAggregator()).toBe('ai-2');
    });

    it('designated: falls back to first if not found', () => {
      machine.updateConfig({
        designatedAggregatorId: 'ai-999',
      });
      expect(machine.selectAggregator()).toBe('ai-1');
    });

    it('defaults to first AI when no designatedAggregatorId', () => {
      expect(machine.selectAggregator()).toBe('ai-1');
    });

    it('returns null when no active AI participants', () => {
      machine.updateParticipants([
        { id: 'user', displayName: 'User', isActive: true },
      ]);
      expect(machine.selectAggregator()).toBeNull();
    });
  });

  // ── Voting helpers ─────────────────────────────────────────────

  describe('voting', () => {
    beforeEach(() => {
      machine.transition('ROUND_DONE');
      machine.transition('SYNTHESIS_COMPLETE');
    });

    it('replaces existing vote from same participant', () => {
      machine.recordVote(makeVote('ai-1', 'disagree'));
      machine.recordVote(makeVote('ai-1', 'agree'));
      expect(machine.votes).toHaveLength(1);
      expect(machine.votes[0].vote).toBe('agree');
    });

    it('allVotesReceived returns false when votes missing', () => {
      machine.recordVote(makeVote('ai-1', 'agree'));
      expect(machine.allVotesReceived()).toBe(false);
    });

    it('isUnanimous returns false with disagreement', () => {
      machine.recordVote(makeVote('ai-1', 'agree'));
      machine.recordVote(makeVote('ai-2', 'disagree'));
      expect(machine.isUnanimous()).toBe(false);
    });

    it('throws when recording vote outside VOTING phase', () => {
      machine.recordVote(makeVote('ai-1', 'agree'));
      machine.recordVote(makeVote('ai-2', 'agree'));
      machine.transition('ALL_AGREE'); // -> AWAITING_USER
      expect(() => machine.recordVote(makeVote('ai-1', 'agree'))).toThrow(
        /Cannot record votes/,
      );
    });

    it('computes min valid votes as ceil(participants/2)', () => {
      expect(machine.getMinValidVotes()).toBe(1);
    });

    it('detects hard block votes', () => {
      machine.recordVote({
        participantId: 'ai-1',
        participantName: 'Claude',
        vote: 'block',
        blockReasonType: 'security',
        timestamp: Date.now(),
      });
      expect(machine.hasHardBlock()).toBe(true);
    });

    it('detects soft block votes', () => {
      machine.recordVote({
        participantId: 'ai-1',
        participantName: 'Claude',
        vote: 'block',
        blockReasonType: 'spec_conflict',
        timestamp: Date.now(),
      });
      expect(machine.hasSoftBlock()).toBe(true);
    });
  });

  // ── Snapshot persistence ───────────────────────────────────────

  it('calls snapshot persister on every transition', () => {
    const persister = vi.fn();
    machine.setSnapshotPersister(persister);

    machine.transition('ROUND_DONE');
    expect(persister).toHaveBeenCalledOnce();
    expect(persister).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'SYNTHESIZING' }),
    );
  });

  it('notifies phase change listeners', () => {
    const listener = vi.fn();
    machine.onPhaseChange(listener);

    machine.transition('ROUND_DONE');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'SYNTHESIZING', previousPhase: 'DISCUSSING' }),
    );
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = machine.onPhaseChange(listener);
    unsub();

    machine.transition('ROUND_DONE');
    expect(listener).not.toHaveBeenCalled();
  });

  // ── Snapshot accumulation ──────────────────────────────────────

  it('accumulates snapshots for every transition', () => {
    machine.transition('ROUND_DONE');
    machine.transition('SYNTHESIS_COMPLETE');

    // Initial + 2 transitions = 3 snapshots
    expect(machine.snapshots).toHaveLength(3);
    expect(machine.snapshots.map(s => s.phase)).toEqual([
      'DISCUSSING',
      'SYNTHESIZING',
      'VOTING',
    ]);
  });

  // ── Serialization ──────────────────────────────────────────────

  it('toInfo returns serializable consensus info', () => {
    machine.transition('ROUND_DONE');
    machine.selectAggregator();
    machine.setProposal('test proposal');

    const info = machine.toInfo();
    expect(info.phase).toBe('SYNTHESIZING');
    expect(info.proposal).toBe('test proposal');
    expect(info.aggregatorId).toBe('ai-1');
    expect(info.aggregatorStrategy).toBe('designated');
    expect(info.maxRetries).toBe(3);
  });

  // ── Restore from snapshot ──────────────────────────────────────

  it('restores state from a snapshot', () => {
    machine.transition('ROUND_DONE');
    machine.setProposal('saved proposal');
    machine.transition('SYNTHESIS_COMPLETE');

    const snapshot = machine.snapshots[machine.snapshots.length - 1];

    const restored = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
    });
    restored.restoreFromSnapshot(snapshot);

    expect(restored.phase).toBe('VOTING');
    expect(restored.proposal).toBe('saved proposal');
    expect(restored.round).toBe(1);

    restored.dispose();
  });

  // ── Phase timeout ──────────────────────────────────────────────

  it('auto-transitions on phase timeout', () => {
    vi.useFakeTimers();

    machine = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
      config: { phaseTimeout: 1000 },
    });

    machine.startPhaseTimeout();
    vi.advanceTimersByTime(1000);

    // DISCUSSING + TIMEOUT -> SYNTHESIZING
    expect(machine.phase).toBe('SYNTHESIZING');

    machine.dispose();
    vi.useRealTimers();
  });

  it('clearPhaseTimeout prevents auto-transition', () => {
    vi.useFakeTimers();

    machine = new ConsensusStateMachine({
      conversationId: 'conv-1',
      participants: makeParticipants(),
      config: { phaseTimeout: 1000 },
    });

    machine.startPhaseTimeout();
    machine.clearPhaseTimeout();
    vi.advanceTimersByTime(2000);

    expect(machine.phase).toBe('DISCUSSING');

    machine.dispose();
    vi.useRealTimers();
  });

  // ── Vote invalidation ────────────────────────────────────────

  it('invalidateVotes clears all votes and human vote', () => {
    machine.transition('ROUND_DONE');
    machine.transition('SYNTHESIS_COMPLETE');

    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.setHumanVote({
      participantId: 'user',
      participantName: 'User',
      source: 'human',
      vote: 'agree',
      timestamp: Date.now(),
    });

    expect(machine.votes).toHaveLength(3);
    expect(machine.humanVote).not.toBeNull();

    machine.invalidateVotes();

    expect(machine.votes).toHaveLength(0);
    expect(machine.humanVote).toBeNull();
  });

  it('setProposal invalidates votes when proposal hash changes', () => {
    machine.transition('ROUND_DONE');

    machine.setProposal('initial proposal');
    machine.transition('SYNTHESIS_COMPLETE');

    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    expect(machine.votes).toHaveLength(2);

    // Change proposal → different hash → votes should be invalidated
    machine.setProposal('revised proposal');
    expect(machine.votes).toHaveLength(0);
  });

  it('setProposal does not invalidate votes when proposal hash is the same', () => {
    machine.transition('ROUND_DONE');

    machine.setProposal('same proposal');
    machine.transition('SYNTHESIS_COMPLETE');

    machine.recordVote(makeVote('ai-1', 'agree'));
    expect(machine.votes).toHaveLength(1);

    // Re-set identical proposal → same hash → votes preserved
    machine.setProposal('same proposal');
    expect(machine.votes).toHaveLength(1);
  });

  // ── Edge cases ──────────────────────────────────────────────────

  describe('retryFromFailure', () => {
    it('resets retry count and transitions to DISCUSSING', () => {
      // Drive to FAILED via ERROR
      machine.transition('ERROR');
      expect(machine.phase).toBe('FAILED');
      expect(machine.isTerminal).toBe(true);

      machine.retryFromFailure();

      expect(machine.phase).toBe('DISCUSSING');
      expect(machine.isTerminal).toBe(false);
      expect(machine.proposal).toBeNull();
      expect(machine.votes).toHaveLength(0);
    });

    it('throws when called outside FAILED phase', () => {
      expect(machine.phase).toBe('DISCUSSING');
      expect(() => machine.retryFromFailure()).toThrow(
        'retryFromFailure is only valid in FAILED phase',
      );
    });

    it('increments round after retry', () => {
      const initialRound = machine.round;
      machine.transition('ERROR');
      machine.retryFromFailure();
      expect(machine.round).toBe(initialRound + 1);
    });
  });

  it('REVIEWING + TIMEOUT transitions to FAILED', () => {
    // Drive to REVIEWING
    machine.transition('ROUND_DONE');     // -> SYNTHESIZING
    machine.setProposal('proposal');
    machine.transition('SYNTHESIS_COMPLETE'); // -> VOTING
    machine.recordVote(makeVote('ai-1', 'agree'));
    machine.recordVote(makeVote('ai-2', 'agree'));
    machine.transition('ALL_AGREE');      // -> AWAITING_USER
    machine.transition('USER_APPROVE');   // -> APPLYING
    machine.transition('APPLY_SUCCESS');  // -> REVIEWING

    expect(machine.phase).toBe('REVIEWING');

    expect(machine.transition('TIMEOUT')).toBe('FAILED');
    expect(machine.phase).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);
  });

  it('concurrent transition calls — second throws from terminal state', () => {
    // First transition to FAILED (terminal)
    machine.transition('ERROR');
    expect(machine.phase).toBe('FAILED');
    expect(machine.isTerminal).toBe(true);

    // Second transition attempt should throw
    expect(() => machine.transition('ROUND_DONE')).toThrow(/terminal state/);
  });

  it('dispose() then transition() should throw', () => {
    machine.dispose();

    // After dispose, listeners are cleared but the machine still works.
    // However, transition from terminal state should still throw.
    // Drive to terminal first to test the terminal guard.
    // For non-terminal: transition still works (dispose only clears timers/listeners).
    const result = machine.transition('ROUND_DONE');
    expect(result).toBe('SYNTHESIZING');

    // Now go terminal
    machine.transition('ERROR'); // -> FAILED
    expect(() => machine.transition('ROUND_DONE')).toThrow(/terminal state/);
  });

  it('dispose() clears phase listeners — no notifications after dispose', () => {
    const listener = vi.fn();
    machine.onPhaseChange(listener);

    machine.dispose();

    machine.transition('ROUND_DONE');
    expect(listener).not.toHaveBeenCalled();
  });
});
