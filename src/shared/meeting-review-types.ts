import type { ChannelRole } from './channel-role-types';

export type MeetingReviewGateKind = 'planning_minutes';

export type MeetingReviewGateStatus =
  | 'pending'
  | 'approved'
  | 'revision_requested'
  | 'restart_requested'
  | 'stopped';

export type MeetingReviewDecision =
  | 'approve'
  | 'revise'
  | 'restart'
  | 'stop';

export interface MeetingReviewGate {
  id: string;
  projectId: string;
  meetingId: string;
  sourceChannelId: string;
  targetChannelId: string | null;
  targetRole: ChannelRole;
  kind: MeetingReviewGateKind;
  status: MeetingReviewGateStatus;
  title: string;
  documentPath: string;
  documentBodySnapshot: string;
  userNote: string | null;
  payloadJson: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface MeetingReviewListRequest {
  projectId?: string;
  status?: MeetingReviewGateStatus;
  kind?: MeetingReviewGateKind;
}

export interface MeetingReviewGetRequest {
  reviewId: string;
}

export interface MeetingReviewDecideRequest {
  reviewId: string;
  decision: MeetingReviewDecision;
  userNote?: string;
}

export interface MeetingReviewDecideResponse {
  review: MeetingReviewGate;
  dispatchRowId: string | null;
  followUpRequired: boolean;
}
