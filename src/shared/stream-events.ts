/** Live Main → Renderer push events for free chat. */
import type { Message } from './message-types';
import type { MemberView, WorkStatus } from './member-profile-types';
import type { NotificationKind, NotificationPrefs } from './notification-types';

export interface StreamChannelMessagePayload {
  message: Message;
}

export interface StreamMemberStatusChangedPayload {
  providerId: string;
  member: MemberView;
  status: WorkStatus;
  cause: 'status' | 'profile' | 'warmup';
}

export interface StreamNotificationPayload {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channelId: string | null;
}

export interface StreamNotificationClickedPayload {
  id: string;
  kind: NotificationKind;
  channelId: string | null;
}

export interface StreamNotificationPrefsChangedPayload {
  prefs: NotificationPrefs;
}

/**
 * 작성 중 · 대기 중 표시 (spec 2026-10-01 F5). 저장하지 않는 휘발 이벤트다.
 * - `queued`: CLI 차례가 앱 전체 CLI 대기열에서 기다리는 중.
 * - `writing`: 제공자 호출이 시작돼 결과를 기다리는 중 (API·로컬은 바로 이 단계).
 * - `idle`: 그 호출이 끝났다 (저장·실패·시간 초과·방 닫힘 모두).
 */
export const CHAT_ACTIVITY_PHASES = ['queued', 'writing', 'idle'] as const;
export type ChatActivityPhase = (typeof CHAT_ACTIVITY_PHASES)[number];

/** 정규 차례인지, 귓속말 답장이라면 상대가 누구인지. */
export type ChatActivityTarget =
  | { kind: 'turn' }
  | { kind: 'whisper'; peerProviderId: string };

export type StreamChatActivityPayload = {
  channelId: string;
  providerId: string;
  phase: ChatActivityPhase;
} & ChatActivityTarget;

/**
 * 바퀴 진행 여부 (QA M1). main 응답기가 그 대화에 처리 중이거나 기다리는 바퀴
 * (DM 은 답장)를 갖는 동안 `active: true`, 마지막 것이 끝나면 `false` 다. 방이
 * 닫히면 그 순간 `false` 가 된다. 차례 사이에도 켜져 있으므로 넘기기 버튼이 이
 * 값으로 비활성을 판단한다. 저장하지 않는다. 화면을 새로 띄우면
 * `chat:list-active-rounds` 로 현재 값을 다시 읽는다.
 */
export interface StreamChatRoundPayload {
  channelId: string;
  active: boolean;
}

export type StreamEvent =
  | { type: 'stream:channel-message'; payload: StreamChannelMessagePayload }
  | { type: 'stream:member-status-changed'; payload: StreamMemberStatusChangedPayload }
  | { type: 'stream:notification'; payload: StreamNotificationPayload }
  | { type: 'stream:notification-clicked'; payload: StreamNotificationClickedPayload }
  | { type: 'stream:notification-prefs-changed'; payload: StreamNotificationPrefsChangedPayload }
  | { type: 'stream:chat-activity'; payload: StreamChatActivityPayload }
  | { type: 'stream:chat-round'; payload: StreamChatRoundPayload };

export type StreamEventType = StreamEvent['type'];
export const LIVE_STREAM_EVENTS = [
  'stream:channel-message',
  'stream:member-status-changed',
  'stream:notification',
  'stream:notification-clicked',
  'stream:notification-prefs-changed',
  'stream:chat-activity',
  'stream:chat-round',
] as const satisfies readonly StreamEventType[];

export type StreamEventOf<T extends StreamEventType> = Extract<StreamEvent, { type: T }>;
export type StreamV3PayloadOf<T extends StreamEventType> = StreamEventOf<T>['payload'];
