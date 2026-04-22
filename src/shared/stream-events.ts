/**
 * Rolestra v3 push stream events — discriminated union for Main → Renderer
 * push communication over the IPC stream channels (spec §6).
 *
 * Separate from `stream-types.ts` (v2 conversation/token streaming):
 * this file defines the higher-level workspace events (channel messages,
 * member status, approvals, projects, meetings, queue, notifications) that
 * power the persistent chat-app UI.
 *
 * R6 addition (meeting turn stream):
 *   - `stream:meeting-turn-start`  — new AI turn begins; a new Message is
 *                                    being created with the given messageId.
 *   - `stream:meeting-turn-token`  — an incremental token arrives. `cumulative`
 *                                    carries the running buffer so late
 *                                    subscribers can render immediately.
 *   - `stream:meeting-turn-done`   — the turn finished; the renderer should
 *                                    refetch the persisted Message (DB has
 *                                    the final row) and drop the live buffer.
 *   - `stream:meeting-error`       — fatal or recoverable error during a
 *                                    meeting. Renderer shows in MeetingBanner.
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

/**
 * R7-Task11: user clicked an OS notification. The renderer uses this as a
 * navigation hint — e.g. `approval_pending` click → switch to messenger +
 * activate the `#승인-대기` channel. Emitted from NotificationService's
 * `'clicked'` event via StreamBridge.connect({ notifications }).
 */
export interface StreamNotificationClickedPayload {
  id: string;
  kind: NotificationKind;
  channelId: string | null;
}

/**
 * R6: AI turn starts in a meeting. `messageId` is the id the Message row
 * will carry once persisted — renderers use it to correlate live tokens
 * with the eventual DB row.
 */
export interface StreamMeetingTurnStartPayload {
  meetingId: string;
  channelId: string;
  speakerId: string;
  messageId: string;
}

/**
 * R6: Incremental token for an ongoing turn. `cumulative` is the running
 * buffer — a late subscriber can render the full partial message without
 * having to replay prior tokens. `sequence` is a monotonically increasing
 * counter so receivers can detect out-of-order delivery.
 */
export interface StreamMeetingTurnTokenPayload {
  meetingId: string;
  channelId: string;
  messageId: string;
  token: string;
  cumulative: string;
  sequence: number;
}

/**
 * R6: AI turn completed — the final Message row is persisted in the DB
 * under `messageId`. Renderers drop the live buffer and refetch via
 * `message:list-by-channel`.
 */
export interface StreamMeetingTurnDonePayload {
  meetingId: string;
  channelId: string;
  messageId: string;
  totalTokens: number;
}

/**
 * R6: Error raised during a meeting. `fatal=true` means the meeting is
 * finished with outcome='failed'; `fatal=false` is a recoverable retry.
 */
export interface StreamMeetingErrorPayload {
  meetingId: string;
  channelId: string;
  error: string;
  fatal: boolean;
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
  | {
      type: 'stream:meeting-turn-start';
      payload: StreamMeetingTurnStartPayload;
    }
  | {
      type: 'stream:meeting-turn-token';
      payload: StreamMeetingTurnTokenPayload;
    }
  | {
      type: 'stream:meeting-turn-done';
      payload: StreamMeetingTurnDonePayload;
    }
  | { type: 'stream:meeting-error'; payload: StreamMeetingErrorPayload }
  | { type: 'stream:queue-progress'; payload: StreamQueueProgressPayload }
  | { type: 'stream:notification'; payload: StreamNotificationPayload }
  | {
      type: 'stream:notification-clicked';
      payload: StreamNotificationClickedPayload;
    };

export type StreamEventType = StreamEvent['type'];

/** Narrow helper for runtime dispatch tables. */
export type StreamEventOf<T extends StreamEventType> = Extract<StreamEvent, { type: T }>;

/**
 * Mapping from v3 stream event type → payload shape. Used by preload
 * `onStream<T>()` so renderer subscribers get the correct payload type
 * without writing the extraction-type by hand each time.
 *
 * NOTE: this is separate from v2 `StreamEventMap` in `stream-types.ts`
 * — v2 streams flat fields, v3 streams `{ type, payload }` via StreamBridge.
 * R11 will retire v2 entirely and this can merge.
 */
export type StreamV3PayloadOf<T extends StreamEventType> = Extract<
  StreamEvent,
  { type: T }
>['payload'];
