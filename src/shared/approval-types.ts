/**
 * Approval Inbox 도메인 타입 — migrations/006-approval-inbox.ts 컬럼과 1:1 camelCase 매핑.
 */

export type ApprovalKind =
  | 'cli_permission'
  | 'mode_transition'
  | 'consensus_decision'
  | 'review_outcome'
  | 'failure_report';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';
export type ApprovalDecision = 'approve' | 'reject' | 'conditional';

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  projectId: string | null;
  channelId: string | null;
  meetingId: string | null;
  requesterId: string | null;
  payload: unknown;
  status: ApprovalStatus;
  decisionComment: string | null;
  createdAt: number;
  decidedAt: number | null;
}
