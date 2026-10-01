import type { ChannelRole } from './channel-role-types';

export type PlanningDesignCheckVerdict =
  | 'aligned'
  | 'misaligned'
  | 'needs_user_decision';

export type PlanningDesignCheckStatus =
  | 'request_created'
  | 'aligned'
  | 'returned_to_design'
  | 'needs_user_decision';

export type PlanningDesignCheckUserDecision =
  | 'send_to_implementation'
  | 'request_design_revision'
  | 'stop';

export interface PlanningDesignCheckWireframeRecord {
  id: string;
  status: string;
  title: string;
  documentPath: string;
  userNote: string | null;
  decidedAt: number | null;
}

export interface PlanningDesignCheckRecord {
  id: string;
  projectId: string;
  sourceDesignMeetingId: string;
  designChannelId: string;
  designChannelRole: ChannelRole;
  planningChannelId: string;
  implementationChannelId: string | null;
  requestTitle: string;
  requestBody: string;
  finalDesignMinutesPath: string;
  finalDesignMinutesBody: string;
  snapshotDesktopPath: string | null;
  snapshotMobilePath: string | null;
  wireframeCheckpointsJson: string;
  wireframeUserNotesJson: string;
  workBundleKey: string | null;
  originalPlanningMinutesId: string | null;
  originalPlanningMinutesPath: string | null;
  originalPlanningMinutesBody: string | null;
  originalPlanningMinutesMissingReason: string | null;
  returnCount: number;
  verdict: PlanningDesignCheckVerdict | null;
  status: PlanningDesignCheckStatus;
  reason: string | null;
  revisionDirection: string | null;
  implementationDispatchId: string | null;
  designReturnDispatchId: string | null;
  userDecision: PlanningDesignCheckUserDecision | null;
  userDecisionNote: string | null;
  userDecisionDispatchId: string | null;
  payloadJson: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface PlanningDesignCheckCardMeta {
  id: string;
  status: PlanningDesignCheckStatus;
  verdict?: PlanningDesignCheckVerdict | null;
  returnCount: number;
  sourceDesignMeetingId: string;
  designChannelId: string;
  planningChannelId: string;
  implementationChannelId?: string | null;
  title?: string;
  reason?: string | null;
  revisionDirection?: string | null;
  userDecision?: PlanningDesignCheckUserDecision | null;
}

export interface PlanningDesignCheckGetRequest {
  checkId: string;
}

export interface PlanningDesignCheckDecideRequest {
  checkId: string;
  decision: PlanningDesignCheckUserDecision;
  userNote?: string;
}

export interface PlanningDesignCheckDecideResponse {
  check: PlanningDesignCheckRecord;
  dispatchRowId: string | null;
}

export interface PlanningDesignCheckReceiverContext {
  channelId: string;
  handoffMode: 'check' | 'auto';
  assignedProviderId: string;
}

export interface PlanningDesignCheckPayloadContext {
  sourceHandoffDispatchId?: string | null;
  designReceiver?: PlanningDesignCheckReceiverContext | null;
  implementationReceiver?: PlanningDesignCheckReceiverContext | null;
  reviewerProviderId?: string;
  skipped?: unknown;
}
