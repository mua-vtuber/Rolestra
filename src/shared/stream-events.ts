/**
 * Rolestra v3 push stream events — discriminated union for Main → Renderer
 * push communication over the IPC stream channels (spec §6).
 *
 * Separate from `stream-types.ts` (v2 conversation/token streaming):
 * this file defines the higher-level workspace events (channel messages,
 * member status, approvals, projects, meetings, queue, notifications) that
 * power the persistent chat-app UI.
 */

import type { Message } from './message-types';
import type { ApprovalItem, ApprovalDecision } from './approval-types';
import type { QueueItem } from './queue-types';
import type { Project } from './project-types';
import type { WorkStatus } from './member-profile-types';
import type { NotificationKind } from './notification-types';
import type { MeetingOutcome } from './meeting-types';

export interface StreamChannelMessagePayload {
  message: Message;
}

export interface StreamMemberStatusPayload {
  providerId: string;
  status: WorkStatus;
}

export interface StreamApprovalCreatedPayload {
  item: ApprovalItem;
}

export interface StreamApprovalDecidedPayload {
  item: ApprovalItem;
  decision: ApprovalDecision;
  comment: string | null;
}

export interface StreamProjectUpdatedPayload {
  project: Project;
}

export interface StreamMeetingStateChangedPayload {
  meetingId: string;
  channelId: string;
  state: string;
  outcome?: MeetingOutcome;
}

export interface StreamQueueProgressPayload {
  item: QueueItem;
}

export interface StreamNotificationPayload {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channelId: string | null;
}

/** Discriminated union of all Rolestra v3 push events. */
export type StreamEvent =
  | { type: 'stream:channel-message'; payload: StreamChannelMessagePayload }
  | { type: 'stream:member-status'; payload: StreamMemberStatusPayload }
  | { type: 'stream:approval-created'; payload: StreamApprovalCreatedPayload }
  | { type: 'stream:approval-decided'; payload: StreamApprovalDecidedPayload }
  | { type: 'stream:project-updated'; payload: StreamProjectUpdatedPayload }
  | {
      type: 'stream:meeting-state-changed';
      payload: StreamMeetingStateChangedPayload;
    }
  | { type: 'stream:queue-progress'; payload: StreamQueueProgressPayload }
  | { type: 'stream:notification'; payload: StreamNotificationPayload };

export type StreamEventType = StreamEvent['type'];

/** Narrow helper for runtime dispatch tables. */
export type StreamEventOf<T extends StreamEventType> = Extract<StreamEvent, { type: T }>;
