import { describe, it, expect } from 'vitest';
import { ModeJudgmentCollector } from '../mode-judgment-collector';
import type { ModeJudgment as _ModeJudgment } from '../../../shared/session-state-types';

describe('ModeJudgmentCollector', () => {
  it('returns false when no judgments', () => {
    const collector = new ModeJudgmentCollector();
    expect(collector.hasMajorityWork()).toBe(false);
  });

  it('returns false with minority work votes (1/3)', () => {
    const collector = new ModeJudgmentCollector();
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'work' });
    collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'conversation' });
    collector.record({ participantId: 'ai-3', participantName: 'C', judgment: 'conversation' });
    expect(collector.hasMajorityWork()).toBe(false);
  });

  it('returns true with majority work votes (2/3)', () => {
    const collector = new ModeJudgmentCollector();
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'work' });
    collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'work' });
    collector.record({ participantId: 'ai-3', participantName: 'C', judgment: 'conversation' });
    expect(collector.hasMajorityWork()).toBe(true);
  });

  it('returns true with all work votes', () => {
    const collector = new ModeJudgmentCollector();
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'work' });
    collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'work' });
    expect(collector.hasMajorityWork()).toBe(true);
  });

  it('resets for new round', () => {
    const collector = new ModeJudgmentCollector();
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'work' });
    collector.reset();
    expect(collector.hasMajorityWork()).toBe(false);
    expect(collector.judgments).toHaveLength(0);
  });

  it('replaces duplicate participant judgment', () => {
    const collector = new ModeJudgmentCollector();
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation' });
    collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'work' });
    expect(collector.judgments).toHaveLength(1);
    expect(collector.judgments[0].judgment).toBe('work');
  });

  // ── Unanimous no_action consensus (dogfooding 2026-05-01 #2-1) ──

  describe('hasUnanimousNoAction', () => {
    it('returns false when no judgments recorded', () => {
      const collector = new ModeJudgmentCollector();
      expect(collector.hasUnanimousNoAction()).toBe(false);
    });

    it('returns true when all judgments are conversation + no_action', () => {
      const collector = new ModeJudgmentCollector();
      collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-3', participantName: 'C', judgment: 'conversation', reason: 'no_action' });
      expect(collector.hasUnanimousNoAction()).toBe(true);
    });

    it('returns false when any judgment is further_discussion', () => {
      const collector = new ModeJudgmentCollector();
      collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'conversation', reason: 'further_discussion' });
      collector.record({ participantId: 'ai-3', participantName: 'C', judgment: 'conversation', reason: 'no_action' });
      expect(collector.hasUnanimousNoAction()).toBe(false);
    });

    it('returns false when any judgment is work mode', () => {
      const collector = new ModeJudgmentCollector();
      collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'work', reason: 'code_change' });
      expect(collector.hasUnanimousNoAction()).toBe(false);
    });

    it('returns false when reason is missing on a judgment', () => {
      const collector = new ModeJudgmentCollector();
      collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'conversation' });
      expect(collector.hasUnanimousNoAction()).toBe(false);
    });

    it('does not collide with hasMajorityWork (mutually exclusive)', () => {
      const collector = new ModeJudgmentCollector();
      collector.record({ participantId: 'ai-1', participantName: 'A', judgment: 'conversation', reason: 'no_action' });
      collector.record({ participantId: 'ai-2', participantName: 'B', judgment: 'conversation', reason: 'no_action' });
      expect(collector.hasMajorityWork()).toBe(false);
      expect(collector.hasUnanimousNoAction()).toBe(true);
    });
  });
});
