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
});
