/**
 * R11-Task7: voting-history projection unit tests.
 *
 * The projection is the only place SSM vote literals
 * (`agree | disagree | block | abstain`) are translated into the
 * approvals-side trio (`approve | reject | abstain`). Test cases pin
 * each translation, malformed-snapshot fallback, and the empty-meeting
 * shortcut.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyConsensusContext,
  extractConsensusContext,
} from '../voting-history';
import type { Meeting } from '../../../shared/meeting-types';

function makeMeeting(snapshotJson: string | null, id = 'mtg-1'): Meeting {
  return {
    id,
    channelId: 'ch-1',
    topic: 't',
    state: 'CONVERSATION',
    stateSnapshotJson: snapshotJson,
    startedAt: 0,
    endedAt: null,
    outcome: null,
  };
}

describe('voting-history (R11-Task7)', () => {
  it('null snapshot → empty context', () => {
    const ctx = extractConsensusContext(makeMeeting(null));
    expect(ctx).toEqual({ meetingId: 'mtg-1', participantVotes: [] });
  });

  it('malformed JSON snapshot → falls back to empty context', () => {
    const ctx = extractConsensusContext(makeMeeting('}{not json{'));
    expect(ctx.participantVotes).toEqual([]);
    expect(ctx.meetingId).toBe('mtg-1');
  });

  it('snapshot without votes array → empty context', () => {
    const ctx = extractConsensusContext(
      makeMeeting('{"phase":"DISCUSSING","round":1}'),
    );
    expect(ctx.participantVotes).toEqual([]);
  });

  it('translates agree → approve, disagree → reject, abstain → abstain', () => {
    const snapshot = JSON.stringify({
      votes: [
        { participantId: 'p-a', vote: 'agree', timestamp: 1 },
        { participantId: 'p-b', vote: 'disagree', timestamp: 2 },
        { participantId: 'p-c', vote: 'abstain', timestamp: 3 },
      ],
    });
    const ctx = extractConsensusContext(makeMeeting(snapshot));
    expect(ctx.participantVotes).toEqual([
      { providerId: 'p-a', vote: 'approve' },
      { providerId: 'p-b', vote: 'reject' },
      { providerId: 'p-c', vote: 'abstain' },
    ]);
  });

  it('block vote folds into reject (approvals UI does not surface block reason)', () => {
    const snapshot = JSON.stringify({
      votes: [
        {
          participantId: 'p-block',
          vote: 'block',
          blockReasonType: 'safety',
          comment: '안전 우려',
          timestamp: 4,
        },
      ],
    });
    const ctx = extractConsensusContext(makeMeeting(snapshot));
    expect(ctx.participantVotes).toEqual([
      { providerId: 'p-block', vote: 'reject', comment: '안전 우려' },
    ]);
  });

  it('empty comment is dropped (optional field stays absent on the wire)', () => {
    const snapshot = JSON.stringify({
      votes: [
        { participantId: 'p-q', vote: 'agree', comment: '', timestamp: 5 },
      ],
    });
    const ctx = extractConsensusContext(makeMeeting(snapshot));
    const entry = ctx.participantVotes[0];
    expect(entry).toBeDefined();
    expect(entry?.providerId).toBe('p-q');
    expect(entry?.comment).toBeUndefined();
  });

  it('skips votes with missing participantId or invalid shape', () => {
    const snapshot = JSON.stringify({
      votes: [
        { participantId: '', vote: 'agree' },
        null,
        { vote: 'agree' },
        { participantId: 'p-good', vote: 'unknown_vote' },
        { participantId: 'p-good-2', vote: 'agree' },
      ],
    });
    const ctx = extractConsensusContext(makeMeeting(snapshot));
    // 'unknown_vote' degrades to 'abstain', everything else without
    // participantId is dropped.
    expect(ctx.participantVotes).toEqual([
      { providerId: 'p-good', vote: 'abstain' },
      { providerId: 'p-good-2', vote: 'approve' },
    ]);
  });

  it('emptyConsensusContext returns the documented zero-shape', () => {
    expect(emptyConsensusContext('mtg-x')).toEqual({
      meetingId: 'mtg-x',
      participantVotes: [],
    });
  });
});
