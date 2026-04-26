/**
 * R11-Task7: Meeting → ApprovalConsensusContext projection.
 *
 * Why a free function instead of a MeetingService method:
 *   `MeetingService` is the meetings-domain owner; `ApprovalConsensusContext`
 *   is shaped for the approvals-domain panel. Coupling the service class to
 *   the approvals type would force every meeting consumer to drag the
 *   approvals types into its compile path even when it does not care about
 *   the projection. A pure function imported by the two handlers that
 *   actually need it (`approval:detail-fetch` + `meeting:voting-history`)
 *   is the lighter coupling.
 *
 * Source-of-truth:
 *   `meetings.state_snapshot_json` carries the SSM `ConsensusSnapshot`
 *   serialised on every transition. The `votes` field is `VoteRecord[]`
 *   (defined in `consensus-types.ts`). The projection translates SSM vote
 *   literals (`agree | disagree | block | abstain`) to the approvals-side
 *   trio (`approve | reject | abstain`) — `disagree` and `block` both
 *   collapse to `reject` because the approvals UI does not surface the
 *   block-reason tooling that lives inside the SSM.
 */

import type { Meeting } from '../../shared/meeting-types';
import type { ApprovalConsensusContext } from '../../shared/approval-detail-types';
import type { VoteRecord } from '../../shared/consensus-types';

type ApprovalVote = ApprovalConsensusContext['participantVotes'][number]['vote'];

/**
 * Translate an SSM vote literal to the approvals-domain trio. Block /
 * disagree both fold into `reject` because the approvals panel does not
 * differentiate the block sub-reason — a user reading the panel only
 * cares whether the participant supported, opposed, or sat out.
 */
function mapSsmVote(vote: VoteRecord['vote']): ApprovalVote {
  if (vote === 'agree') return 'approve';
  if (vote === 'disagree' || vote === 'block') return 'reject';
  return 'abstain';
}

/** Empty projection used when the snapshot is missing or unparseable. */
export function emptyConsensusContext(
  meetingId: string,
): ApprovalConsensusContext {
  return { meetingId, participantVotes: [] };
}

/**
 * Project a `Meeting` row into the approvals-side consensus context. The
 * fallback to {@link emptyConsensusContext} on any parsing failure means
 * the detail panel renders a zero-state instead of crashing — a malformed
 * snapshot is a bug we want to surface in logs but not in the user's
 * face.
 */
export function extractConsensusContext(
  meeting: Meeting,
): ApprovalConsensusContext {
  if (meeting.stateSnapshotJson === null) {
    return emptyConsensusContext(meeting.id);
  }

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(meeting.stateSnapshotJson);
  } catch {
    return emptyConsensusContext(meeting.id);
  }

  if (snapshot === null || typeof snapshot !== 'object') {
    return emptyConsensusContext(meeting.id);
  }

  const rawVotes = (snapshot as { votes?: unknown }).votes;
  if (!Array.isArray(rawVotes)) {
    return emptyConsensusContext(meeting.id);
  }

  const participantVotes: ApprovalConsensusContext['participantVotes'] = [];
  for (const v of rawVotes) {
    if (v === null || typeof v !== 'object') continue;
    const rec = v as Partial<VoteRecord>;
    const providerId =
      typeof rec.participantId === 'string' && rec.participantId.length > 0
        ? rec.participantId
        : '';
    if (providerId.length === 0) continue;
    const ssmVote =
      rec.vote === 'agree' ||
      rec.vote === 'disagree' ||
      rec.vote === 'block' ||
      rec.vote === 'abstain'
        ? rec.vote
        : 'abstain';
    const entry: ApprovalConsensusContext['participantVotes'][number] = {
      providerId,
      vote: mapSsmVote(ssmVote),
    };
    if (typeof rec.comment === 'string' && rec.comment.length > 0) {
      entry.comment = rec.comment;
    }
    participantVotes.push(entry);
  }

  return { meetingId: meeting.id, participantVotes };
}
