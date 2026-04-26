/**
 * R11-Task7: meeting-handler unit tests for the voting-history channel.
 *
 * Covers the read-only projection wiring for the Approval detail panel's
 * "회의 맥락" card. The voting-history projection itself has its own
 * unit suite (`voting-history.test.ts`); these tests focus on the
 * handler-level lookup-miss + accessor guard contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleMeetingVotingHistory,
  setMeetingAbortServiceAccessor,
} from '../meeting-handler';
import type { Meeting } from '../../../../shared/meeting-types';

interface ServiceMock {
  get: ReturnType<typeof vi.fn>;
}

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-1',
    channelId: 'ch-1',
    topic: 't',
    state: 'CONVERSATION',
    stateSnapshotJson: null,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

afterEach(() => {
  setMeetingAbortServiceAccessor(null as never);
});

describe('handleMeetingVotingHistory (R11-Task7)', () => {
  let svc: ServiceMock;

  beforeEach(() => {
    svc = { get: vi.fn() };
    setMeetingAbortServiceAccessor(() => svc as never);
  });

  it('meeting lookup miss → empty context with requested meetingId', () => {
    svc.get.mockReturnValue(null);
    const result = handleMeetingVotingHistory({ meetingId: 'mtg-missing' });
    expect(result.context).toEqual({
      meetingId: 'mtg-missing',
      participantVotes: [],
    });
  });

  it('null state_snapshot_json → empty participant votes', () => {
    svc.get.mockReturnValue(buildMeeting({ stateSnapshotJson: null }));
    const result = handleMeetingVotingHistory({ meetingId: 'mtg-1' });
    expect(result.context.participantVotes).toEqual([]);
  });

  it('snapshot with votes → projected to approvals trio', () => {
    svc.get.mockReturnValue(
      buildMeeting({
        stateSnapshotJson: JSON.stringify({
          votes: [
            { participantId: 'p-a', vote: 'agree' },
            { participantId: 'p-b', vote: 'block', comment: '거부' },
          ],
        }),
      }),
    );
    const result = handleMeetingVotingHistory({ meetingId: 'mtg-1' });
    expect(result.context.participantVotes).toEqual([
      { providerId: 'p-a', vote: 'approve' },
      { providerId: 'p-b', vote: 'reject', comment: '거부' },
    ]);
  });

  it('handler is read-only — never invokes service.start/finish/updateState', () => {
    const fullSvc = {
      get: vi.fn().mockReturnValue(buildMeeting()),
      start: vi.fn(),
      finish: vi.fn(),
      updateState: vi.fn(),
    };
    setMeetingAbortServiceAccessor(() => fullSvc as never);

    handleMeetingVotingHistory({ meetingId: 'mtg-1' });
    expect(fullSvc.start).not.toHaveBeenCalled();
    expect(fullSvc.finish).not.toHaveBeenCalled();
    expect(fullSvc.updateState).not.toHaveBeenCalled();
  });
});
