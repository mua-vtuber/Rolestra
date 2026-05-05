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
import type { Project, AutonomyMode } from './project-types';
import type { MemberView, WorkStatus } from './member-profile-types';
import type { NotificationKind, NotificationPrefs } from './notification-types';
import type { MeetingOutcome } from './meeting-types';

export interface StreamChannelMessagePayload {
  message: Message;
}

/**
 * R10-Task1: member 의 출근 상태 또는 프로필 메타가 바뀔 때 renderer 가
 * 전체 목록을 다시 가져오지 않고도 reducer 로 반영할 수 있도록 `member`
 * 필드에 최신 `MemberView` 를 통째로 싣는다.
 *
 * R8/R9 에서 `{providerId, status}` 만 담던 `stream:member-status` 를
 * R10 에서 `stream:member-status-changed` 로 이름을 맞추고 payload 를
 * `MemberView` 수준으로 확장(Decision D9 — R8 mutation-후-invalidation
 * 패턴과 공존, stream 은 추가 layer 로만 작동).
 *
 * `status` 는 {@link MemberView.workStatus} 와 동일한 값이지만 "이 이벤트의
 * 트리거가 status 변화냐 프로필 편집이냐"를 renderer 가 구분할 수 있게
 * `cause` 필드를 같이 싣는다.
 */
export interface StreamMemberStatusChangedPayload {
  providerId: string;
  member: MemberView;
  /** 편의성 shortcut — `member.workStatus` 와 동일. */
  status: WorkStatus;
  /**
   * - `'status'`  : 출근 상태(online/connecting/offline-*) 가 바뀜.
   * - `'profile'` : 이름/아바타/역할/성격 등 구조화 필드가 바뀜.
   * - `'warmup'`  : MemberWarmupService 의 backoff retry 결과 반영.
   */
  cause: 'status' | 'profile' | 'warmup';
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

/**
 * R12-C2 T10a — phase 전환 신호. 옛 `stream:meeting-state-changed` (state: string)
 * 와 함께 dispatch — `state-changed` 의 `state` 필드는 새 phase 문자열을 그대로
 * 담는다 (schema 호환). 본 신호는 prev / round / 진행 의견 정보를 풍부하게
 * 추가해 P3 SsmBox 가 어떤 phase / 어떤 round / 어떤 의견 카드 highlight 할지
 * 결정할 수 있게 한다.
 *
 * 옛 신호 (`state-changed`) 통째 삭제는 P3 SsmBox 마이그레이션 종결 시점.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md §5
 *  + 결정 메모리 rolestra-r12-c2-t10-split.md (사용자 답 ① 2026-05-04).
 */
export interface StreamMeetingPhaseChangedPayload {
  meetingId: string;
  channelId: string;
  /** 직전 phase. 회의 시작 직후 첫 emit 은 null. */
  prevPhase: string | null;
  /** 현재 phase 문자열 — `MeetingPhase` (`gather` | `tally` | ...). */
  phase: string;
  /**
   * `free_discussion` phase 안 라운드 카운터. 다른 phase 에서는 0. 의견 1 개
   * 합의되면 다음 의견 진입 시 0 으로 리셋.
   */
  round: number;
  /**
   * `free_discussion` phase 안 진행 중 의견의 *화면 ID* (예 `ITEM_002`).
   * 다른 phase 에서는 null.
   */
  currentOpinionScreenId: string | null;
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
 *
 * `messageId` / `speakerId` are populated when the failure is tied to a
 * specific in-flight turn (e.g. provider stream rejected mid-response).
 * Renderer hooks use them to flip the matching liveTurn's status to
 * `failed` and surface the speaker's name. Failures that fire BEFORE a
 * turn was even allocated (e.g. provider not found) leave them unset.
 */
export interface StreamMeetingErrorPayload {
  meetingId: string;
  channelId: string;
  error: string;
  fatal: boolean;
  messageId?: string;
  speakerId?: string;
}

/**
 * R8-Task9: a turn was skipped because the participant was not `online`
 * (spec §7.2). The renderer reflects this as a system message ("⚠ {name}
 * 가 외근 중이라 이 턴을 건너뜁니다") and the SSM does NOT receive a
 * TURN_DONE/TURN_FAIL — skip is "this slot is empty", not failure.
 *
 * `reason` is the {@link WorkStatus} that triggered the skip (anything
 * !== 'online'). The renderer maps it to an i18n label rather than relying
 * on a hard-coded string here.
 */
export interface StreamMeetingTurnSkippedPayload {
  meetingId: string;
  channelId: string;
  participantId: string;
  participantName: string;
  reason: 'connecting' | 'offline-connection' | 'offline-manual';
  /** Synthetic id used by the renderer to key a transient liveTurn entry
   *  for this skip notice (no persisted message row corresponds to it). */
  skipId?: string;
}

/**
 * R9-Task1: full queue snapshot broadcast. Emitted after any mutation
 * (add/remove/reorder/pause/resume/startNext) so renderers reconcile
 * their view without needing `queue:list` round-trips. Authoritative
 * surface for the renderer's `useQueue` hook — the F6 cleanup retired
 * the per-item `stream:queue-progress` fall-back since no consumer
 * subscribed to it (renderer reads only `stream:queue-updated`).
 *
 * `paused` reflects the project-level run state toggled by `queue:pause` /
 * `queue:resume`; when true, `QueueService.startNext` is a no-op even if
 * pending items exist.
 */
export interface StreamQueueUpdatedPayload {
  projectId: string;
  items: QueueItem[];
  paused: boolean;
}

/**
 * R9-Task1: notification preferences changed (any kind × display/sound
 * toggle). Payload carries the FULL `NotificationPrefs` so any surface
 * (settings view / toast suppression logic) can reconcile state without
 * extra fetches. Emitted from `NotificationService.updatePrefs`.
 */
export interface StreamNotificationPrefsChangedPayload {
  prefs: NotificationPrefs;
}

/**
 * R9-Task1: project autonomy mode changed (manual ↔ auto_toggle ↔ queue),
 * whether by user toggle (`project:set-autonomy`) or system downgrade
 * (Circuit Breaker fire / AutonomyGate fail path). The project-scoped
 * payload lets listeners skip projects they don't care about cheaply.
 */
export interface StreamAutonomyModeChangedPayload {
  projectId: string;
  mode: AutonomyMode;
  reason?: 'user' | 'circuit_breaker' | 'autonomy_gate_fail';
}

/** Discriminated union of all Rolestra v3 push events. */
export type StreamEvent =
  | { type: 'stream:channel-message'; payload: StreamChannelMessagePayload }
  | {
      type: 'stream:member-status-changed';
      payload: StreamMemberStatusChangedPayload;
    }
  | { type: 'stream:approval-created'; payload: StreamApprovalCreatedPayload }
  | { type: 'stream:approval-decided'; payload: StreamApprovalDecidedPayload }
  | { type: 'stream:project-updated'; payload: StreamProjectUpdatedPayload }
  | {
      type: 'stream:meeting-state-changed';
      payload: StreamMeetingStateChangedPayload;
    }
  | {
      type: 'stream:meeting-phase-changed';
      payload: StreamMeetingPhaseChangedPayload;
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
  | {
      type: 'stream:meeting-turn-skipped';
      payload: StreamMeetingTurnSkippedPayload;
    }
  | { type: 'stream:queue-updated'; payload: StreamQueueUpdatedPayload }
  | { type: 'stream:notification'; payload: StreamNotificationPayload }
  | {
      type: 'stream:notification-clicked';
      payload: StreamNotificationClickedPayload;
    }
  | {
      type: 'stream:notification-prefs-changed';
      payload: StreamNotificationPrefsChangedPayload;
    }
  | {
      type: 'stream:autonomy-mode-changed';
      payload: StreamAutonomyModeChangedPayload;
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
