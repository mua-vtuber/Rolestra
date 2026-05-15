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
import type { NextStepCard } from './run-step-types';

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

/**
 * R12-C2 T13 — B1 NextStep 카드 분류 결과 신호. orchestrator 가 매 turn 직후
 * (그리고 phase 경계 시스템 호출 시) classifier 호출 → 결과를 RunStep 에
 * 영속하면서 본 신호 발사. renderer 는 카드 종류 따라 모달 / Notification /
 * 진행률 갱신 등 UI 분기.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.18.8a  카드 7 종 (안전군 2 / 결과 전파군 5)
 *
 * 본 sub-task (T13) 의 renderer 응답: 안전군 ('continue'/'wait') 은 무시 / 진행
 * 표시만. 결과 전파군 ('approve'/'tool'/'handoff'/'minutes'/'end') 은 placeholder
 * — 실제 모달은 T28+ HandoffApprovalModal 등이 land 시 wire.
 */
export interface StreamNextStepClassifiedPayload {
  meetingId: string;
  channelId: string;
  /**
   * RunStep row id (UUID v4) — renderer 가 IPC `meeting:list-run-steps` 로
   * 자세한 input/output JSON 조회 시 키.
   */
  runStepId: string;
  /** 분류기 호출 시점의 phase. */
  phase: string;
  /** 자유 토론 라운드 카운터 (다른 phase 에서는 0). */
  round: number;
  /** 회의 안 turn 순서 (0 부터). */
  turnIndex: number;
  /** B1 분류 결과 — 7 카드 중 하나. */
  card: NextStepCard;
  /**
   * cap interlock 으로 자연 분류 'continue' 가 'end' 로 override 됐는지.
   * renderer 는 이 flag 가 true 면 사용자 호출 Notification + auto-end UX 분기.
   */
  capOverride: boolean;
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

// ── idea-workflow USER_PICK (T15 land — spec §5.1) ─────────────────

/**
 * `stream:idea-pick-snapshot` 페이로드 — orchestrator 가 awaiting_user_pick
 * phase 진입 시 1 회 push. UI (renderer SsmBox idea variant — T18) 가
 * 받아 카드 list + 선택 체크 + 코멘트 textarea + [기획 부서로 보내기] 버튼
 * surface 활성화.
 *
 * spec §11.13 idea variant SsmBox layout: 의견 list (kind='root' 만, 단순)
 * + 사용자 선택 여부 체크 마크. 진행 상황 X — step 2 까지만.
 */
export interface StreamIdeaPickSnapshotPayload {
  meetingId: string;
  channelId: string;
  /** 추가 아이디어 수집 이후에도 유지해야 하는 현재 사용자 선택. */
  selectedScreenIds?: string[];
  cards: Array<{
    /** 화면 ID (예: `ITEM_001`). UI 가 IPC 응답 selectedScreenIds 로 사용. */
    screenId: string;
    /** UUID — UI 가 매핑 추적 시 reference. */
    uuid: string;
    title: string;
    content: string;
    rationale: string;
    authorLabel: string;
    /** provider id (예: 'codex' / 'claude' / 'gemini'). UI 가 발의자 표시. */
    authorProviderId: string | null;
  }>;
}

// ── design-workflow (T16 land — spec §5.2 / §11.18.9) ───────────────

import type { DesignedTaskKind } from './meeting-flow-types';

/**
 * `stream:designed-task-assigned` 페이로드 — design-workflow 가 step 1/5/6
 * 진입 시 emit. UI (SsmBox design variant — T18) 가 받아 "UX 직원이 와이어프레임
 * 작성 중..." / "UI 직원이 HTML/CSS 작성 중..." 등 inline progress 표시.
 *
 * 직원 응답 도착 시 별도 이벤트 X — `stream:meeting-turn-done` 그대로 사용
 * (단일 turn dispatch). 이후 phase 전이는 `stream:meeting-phase-changed` 로
 * 알림.
 *
 * spec §5.2 디자인 부서 7 단계 + §11.18.9 designated-task 직원 응답 schema.
 */
export interface StreamDesignedTaskAssignedPayload {
  meetingId: string;
  channelId: string;
  /** 진행 sub-kind — UI 가 메시지 분기. */
  taskKind: DesignedTaskKind;
  /** 어느 회의 차수인지 (1=와이어프레임 회의, 2=디자인 회의). UI 진행 표시용. */
  meetingOrdinal: 1 | 2;
  /** 지정된 직원 provider id (designated worker). UI 가 표시. */
  assignedProviderId: string;
  /** 직원 라벨 (예: 'gemini_1'). */
  assignedAuthorLabel: string;
}

/**
 * `stream:design-snapshot-ready` 페이로드 — design-workflow 가 generating_snapshot
 * phase 완료 시 emit. UI (DesignPreview — T16c) 가 받아 desktop / mobile 탭
 * surface 활성화 + PNG 표시.
 *
 * 경로는 ArenaRoot 기준 절대 경로 (PathGuard 봉인 안). UI 는 file:// URL 로
 * 변환해 <img> src 로 사용. 동일 회의 안 재생성 X — handoff 시점에 1 회만.
 *
 * spec §11.18.9d — Playwright PNG 1280x720 + 375x812 (PathGuard 봉인 ArenaRoot
 * 안 저장).
 */
export interface StreamDesignSnapshotReadyPayload {
  meetingId: string;
  channelId: string;
  /** desktop viewport (1280x720) PNG 절대 경로. */
  desktopPath: string;
  /** mobile viewport (375x812) PNG 절대 경로. */
  mobilePath: string;
  /** 생성 timestamp (epoch ms). */
  generatedAt: number;
  /** 어느 의견 (HTML/CSS root) 으로부터 생성됐는지 — opinion uuid (audit 가능). */
  sourceOpinionUuid: string;
}

// ── dashboard 진행률 패널 (T19 land — spec §11.21) ───────────────────

/**
 * `stream:dashboard-progress-changed` 페이로드 — A RunStep 새 row 가
 * append 될 때마다 1 회 push (spec §11.21.4).
 *
 * *signal-only* — payload 안에 진행률 데이터 자체는 없다. renderer 가
 * 받으면 zustand store invalidate → `dashboard:progress-snapshot` IPC
 * 재호출. 본 분리는:
 *   - 같은 프로젝트 다중 채널 동시 갱신 시 stream payload 가 비대해지는 것
 *     을 회피
 *   - 1 분 TTL 캐시 + 사용자가 다른 프로젝트 보고 있으면 fetch skip 가능
 *
 * `projectId` 는 *어느 프로젝트의 패널을* invalidate 할지 식별 — renderer
 * 의 dashboard store 가 `projectId === currentProjectId` 분기로 fetch.
 *
 * 발사 source = StreamBridge 가 RunStepService 의 `'appended'` 이벤트
 * 구독 후 channelId → projectId 룩업으로 변환 (T19-D + T19-F).
 */
export interface StreamDashboardProgressChangedPayload {
  /** 어느 프로젝트의 패널이 invalidate 되어야 하는지. */
  projectId: string;
  /** 변경 trigger 가 된 채널 (디버깅 / 룩업 confirm 용). */
  sourceChannelId: string;
}

// ── R12-C2 P6 T28: handoff_mode 우회 룰 wire (spec §11.18.8c) ──────────

/**
 * 'check' 분기 — 회의 종결 직후 사용자 결재 모달 등장 trigger. orchestrator 가
 * chain resolver 결과 + receiver channel.handoff_mode='check' 분기에서 발사.
 *
 * payload 의 `package` 는 검증된 HandoffPackage JSON 직렬화 (renderer 가
 * `parseHandoffPackage` 로 다시 검증 — IPC boundary 안 unknown 통제).
 *
 *   - `meetingId`        보낸 회의 식별자 (= pkg.sender.meetingId). HandoffPendingState
 *                        의 키와 동일.
 *   - `senderChannelId`  보낸 부서 채널 (= pkg.sender.channelId). 사이드바 highlight.
 *   - `targetChannelId`  받는 부서 채널 (= pkg.target.channelId). 모달 라벨.
 *   - `packageJson`      `serializeHandoffPackage(pkg)` 결과 — IPC 안전 wire 위해
 *                        문자열로 dispatch. renderer 가 `parseHandoffPackage` 로 검증.
 *   - `minutesPath`      회의록 markdown 파일 절대 경로 — renderer 가 별 IPC
 *                        호출 없이 모달에서 본문 read 가능. NULL = 회의록 없음
 *                        (fallback path 시 — caller 가 별 분기).
 *   - `dispatchedAt`     모달 trigger 시점 epoch ms.
 */
export interface StreamHandoffRequiredPayload {
  meetingId: string;
  senderChannelId: string;
  targetChannelId: string;
  packageJson: string;
  minutesPath: string | null;
  dispatchedAt: number;
}

/**
 * 'auto' 분기 — orchestrator 가 dispatch 즉시 호출 직후 발사. 또는 'check' 분기
 * 모달 [확인] 후 IPC handler 가 dispatch 호출 직후 동일 payload 로 발사. 받는
 * 채널의 unread badge 갱신 + sidebar dot 표시 trigger.
 *
 *   - `meetingId`        보낸 회의 식별자
 *   - `dispatchRowId`    handoff_dispatch row 의 UUID (T27 service 반환)
 *   - `senderChannelId`  보낸 부서 채널
 *   - `targetChannelId`  받는 부서 채널
 *   - `mode`             dispatch 시점의 receiver channel.handoff_mode
 *                        ('check' 라도 사용자 [확인] 거친 후라 동일 dispatch 경로)
 *   - `dispatchedAt`     row 영속 시점 epoch ms
 */
export interface StreamHandoffDispatchedPayload {
  meetingId: string;
  dispatchRowId: string;
  senderChannelId: string;
  targetChannelId: string;
  mode: 'check' | 'auto';
  dispatchedAt: number;
}

/**
 * 'check' 분기 모달 [취소] 직후. 또는 사용자가 회의 진행 중 인계 자체를
 * abort 한 경우. dispatch 호출 X — pending state 만 비움.
 *
 *   - `meetingId`        보낸 회의 식별자 (HandoffPendingState 의 키)
 *   - `reason`           reject 사유 ('user_canceled' = 모달 [취소], 'meeting_aborted'
 *                        = 회의 자체가 abort 되어 pending 도 같이 cleanup)
 */
export interface StreamHandoffRejectedPayload {
  meetingId: string;
  reason: 'user_canceled' | 'meeting_aborted';
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
      type: 'stream:next-step-classified';
      payload: StreamNextStepClassifiedPayload;
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
    }
  | {
      type: 'stream:idea-pick-snapshot';
      payload: StreamIdeaPickSnapshotPayload;
    }
  | {
      type: 'stream:designed-task-assigned';
      payload: StreamDesignedTaskAssignedPayload;
    }
  | {
      type: 'stream:design-snapshot-ready';
      payload: StreamDesignSnapshotReadyPayload;
    }
  | {
      type: 'stream:dashboard-progress-changed';
      payload: StreamDashboardProgressChangedPayload;
    }
  | {
      type: 'stream:handoff-required';
      payload: StreamHandoffRequiredPayload;
    }
  | {
      type: 'stream:handoff-dispatched';
      payload: StreamHandoffDispatchedPayload;
    }
  | {
      type: 'stream:handoff-rejected';
      payload: StreamHandoffRejectedPayload;
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
