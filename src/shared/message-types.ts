/**
 * Channel Message 도메인 타입 — migrations/005-messages.ts 컬럼과 1:1 camelCase 매핑.
 *
 * 주의: shared/provider-types.ts의 Message(프로바이더 I/O 용)와 이름이 겹치지만
 * 서로 다른 도메인이므로 둘 다 유지한다. import 시 별칭으로 구분한다.
 */

import type { OpinionKind } from './opinion-types';
import type {
  MeetingReviewGateKind,
  MeetingReviewGateStatus,
} from './meeting-review-types';
import type {
  DesignCheckpointKind,
  DesignCheckpointStatus,
} from './design-checkpoint-types';
import type { PlanningDesignCheckCardMeta } from './planning-design-check-types';
import type { ChannelRole } from './channel-role-types';

export type { PlanningDesignCheckCardMeta } from './planning-design-check-types';

export type MessageAuthorKind = 'user' | 'member' | 'system';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type MessageViewer =
  | { kind: 'public' }
  | { kind: 'observer' }
  | { kind: 'provider'; providerId: string };

export interface WhisperDetails {
  recipientId: string;
  senderName: string;
  recipientName: string;
  sourceMessageId: string;
  /** The thread's root whisper for every reply; null on the root itself. */
  replyToMessageId: string | null;
  /**
   * Position in the whisper thread (migration 035): the root is 1, replies
   * are 2, 3, ... and alternate direction — even positions go from the root
   * recipient back to the root sender, odd ones the other way.
   */
  threadSeq: number;
}

/**
 * Spec §7.5 — `messages.author_id` for the sole end-user is the literal
 * string `'user'`. Both the service-level guard
 * (`UserAuthorMismatchError`) and the SQLite trigger
 * `messages_author_fk_check` enforce this invariant. Renderer-side
 * optimistic inserts MUST use the same constant so the row submitted
 * via `message:append` round-trips against the same contract.
 */
export const USER_AUTHOR_LITERAL = 'user' as const;

/**
 * 채팅 응답 실패 알림 코드. main 은 문장 대신 이 코드만 저장하고, 화면 문구는
 * renderer 가 `messenger.whisper.errors.<code>` 번역으로 만든다.
 */
export const CHAT_ERROR_CODES = [
  'invalid_response', 'provider_unavailable', 'provider_error', 'usage_limit', 'timeout', 'whisper_limit',
  'opinion_registration_failed', 'recipient_unavailable',
  // 방 안 두 참가자의 불투명 별칭이 겹쳐 귓속말 상대를 가릴 수 없어 차례를 건너뜀.
  'participant_alias_collision',
  // 합의 폴더 설정이 앱 데이터 폴더를 품고 있어 CLI 지시문 파일을 그 밖에 둘 수 없음.
  'consensus_folder_contains_app_data',
] as const;
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === 'string' && (CHAT_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * 침묵 알림 코드 (2026-09-28 귓속말 규칙, 2026-10-01 F3). `turn_passed` 는 차례에서
 * 공개 발언도 귓속말도 하지 않은 경우, `reply_passed` 는 받은 귓속말에 답장하지 않은
 * 경우다. `round_all_silent` 는 한 바퀴에서 모든 AI 의 정규 차례가 침묵이었다는
 * 바퀴 단위 알림이라 말한 사람이 없다. 오류가 아니다 — 화면은 흐린 한 줄로 보인다.
 */
const CHAT_SPEAKER_SILENCE_CODES = ['turn_passed', 'reply_passed'] as const;
export type ChatSpeakerSilenceCode = (typeof CHAT_SPEAKER_SILENCE_CODES)[number];
export const CHAT_ROUND_SILENCE_CODE = 'round_all_silent' as const;

/**
 * 침묵 알림 메타. AI 한 명의 침묵은 이름을 저장 당시 스냅샷으로 담는다 (귓속말
 * 발신·수신 이름과 같은 방식). 바퀴 전체 침묵은 코드만 담는다.
 */
export type ChatSilenceNotice =
  | { code: ChatSpeakerSilenceCode; speakerName: string }
  | { code: typeof CHAT_ROUND_SILENCE_CODE };

export function isChatSilenceNotice(value: unknown): value is ChatSilenceNotice {
  if (value === null || typeof value !== 'object') return false;
  const notice = value as { code?: unknown; speakerName?: unknown };
  if (notice.code === CHAT_ROUND_SILENCE_CODE) return true;
  return typeof notice.speakerName === 'string' &&
    (CHAT_SPEAKER_SILENCE_CODES as readonly string[]).includes(notice.code as string);
}

/**
 * 넘기기 행 코드 (spec 2026-10-01 F1). 사용자가 글 없이 한 바퀴를 넘기면 사용자 쪽
 * 공개 행 하나를 저장하고, 그 행이 바퀴의 출처가 된다. 문장이 아니라 이 코드만
 * `content` 와 `meta.chatPass` 에 저장한다. 화면은 번역 문구로, 모델 입력은 main 의
 * 영어 한 줄로 바꿔 보인다. 검색 결과에는 나오지 않는다.
 */
export const CHAT_PASS_CODE = 'user_pass' as const;

export function isChatPassMessage(message: Pick<Message, 'authorKind' | 'role' | 'meta'>): boolean {
  return message.authorKind === 'user' && message.role === 'user' &&
    message.meta !== null && message.meta.chatPass === CHAT_PASS_CODE;
}

/**
 * 관전자 전용 알림을 표시하는 meta 키. 이 키가 있는 system 행은 사람 화면에만
 * 보이고 어떤 모델 입력에도 들어가지 않는다. main 의 SQL 정책
 * (`message-visibility.ts`) 과 renderer 의 알림 표시가 같은 목록을 쓴다.
 */
export const OBSERVER_NOTICE_META_KEYS = ['chatError', 'chatSilence'] as const;

export function isObserverNotice(message: Pick<Message, 'role' | 'meta'>): boolean {
  const meta = message.meta;
  return message.role === 'system' && meta !== null &&
    OBSERVER_NOTICE_META_KEYS.some((key) => meta[key] !== undefined && meta[key] !== null);
}

export interface MessageMeta {
  toolCalls?: unknown[];
  approvalRef?: string;
  mentions?: string[];
  /**
   * R12-C2 P3 (T14) — 의견 카드 메타. 채팅창 메시지 row 가 회의 안 의견
   * 발화 또는 일반 채널 [##본문] 카드인 경우 채워진다. spec §11.13a.
   *
   * 채팅창 dispatcher 가 본 키 존재 여부로 `MessageRenderer/CardVariant` 와
   * 일반 `Message` 분기. 모든 필드가 *진실 데이터* — 빈 placeholder 금지
   * (CLAUDE.md mock/fallback 금지 rule). 누락 필드 발견 시 caller 가 아예
   * `opinion` 키를 빼고 시스템/일반 메시지로 보존해야 한다.
   */
  opinion?: OpinionCardMeta;
  /**
   * R12-C2 P3 (T14) — 회의록 카드 메타. compose_minutes phase 에서
   * MeetingOrchestrator 가 system 메시지에 부착. CardVariant 가 본 키
   * 존재 여부로 minutes 카드 렌더 분기.
   */
  minutes?: MinutesCardMeta;
  /**
   * R12-C2 기획 회의록 검토 안내 카드. 긴 회의록 전문 대신 대화창에는
   * 짧은 notice + 검토 화면 진입 버튼만 보여준다.
   */
  reviewGate?: ReviewGateCardMeta;
  /**
   * R12-C2 3차 — 디자인 와이어프레임 가벼운 확인 카드. 공식 승인/반려가
   * 아니므로 reviewGate 와 분리한다.
   */
  wireframeCheckpoint?: WireframeCheckpointCardMeta;
  /**
   * R12-C2 4차 — 디자인 -> 기획 검수 내부 결과 카드. 사용자 공식 승인/반려가
   * 아니라 aligned/misaligned 자동 분기와 사용자 판단 필요 상태만 보여준다.
   */
  planningDesignCheck?: PlanningDesignCheckCardMeta;
  /**
   * 채팅 응답 실패 알림 (role='system'). 사람(관전자) 화면에만 보이고 어떤
   * 모델 입력에도 들어가지 않는다 (`message-visibility.ts`).
   */
  chatError?: ChatErrorCode;
  /**
   * DM 실패 알림에만 붙는 짧은 원인 한 줄. 비밀값은 가린 뒤 길이를 잘라서
   * 저장한다. 그룹 방 알림에는 붙이지 않는다.
   */
  chatErrorDetail?: string;
  /** 사용량 소진 알림에 표시할 등록 이름의 스냅샷. */
  chatErrorSpeakerName?: string;
  /**
   * 침묵 알림 (role='system'). 오류 알림과 같이 관전자 화면에만 보이고 어떤
   * 모델 입력에도 들어가지 않는다.
   */
  chatSilence?: ChatSilenceNotice;
  /** 넘기기 행 표시 (spec 2026-10-01 F1). {@link CHAT_PASS_CODE} 만 담는다. */
  chatPass?: typeof CHAT_PASS_CODE;
  [k: string]: unknown;
}

/**
 * 채팅창 의견 카드용 메타. 모든 필드는 DB opinion row + 매번 재구성되는
 * 화면 ID 의 1:1 미러. 화면 ID 는 DB 에 없으므로 메시지 append 시점에
 * 한 번 snapshot 해 둔다 (이후 재구성 결과와 다를 수도 있지만, 메시지
 * row 는 발화 당시의 ID 를 보존하는 것이 audit 정직).
 */
export interface OpinionCardMeta {
  /** opinion.id (UUID). 후속 vote/handoff IPC 의 진실 키. */
  opinionRef: string;
  /** opinion.kind — 'root' | 'revise' | 'block' | 'addition' | 'self-raised' | 'user-raised'. */
  opinionKind: OpinionKind;
  /** 화면 ID — 'ITEM_001' / 'ITEM_001_01' / 'ITEM_001_01_01'. */
  opinionScreenId: string;
  /** 회의 안 발화 ID — 'codex_1' 형식. opinion.author_label 미러. */
  authorLabel: string;
  /** opinion.title (NULL 가능). */
  opinionTitle?: string | null;
  /** opinion.rationale (NULL 가능). */
  opinionRationale?: string | null;
}

/**
 * 회의록 카드용 메타. MeetingMinutesService.compose 결과를 그대로 미러.
 */
export interface MinutesCardMeta {
  /** ArenaRoot 봉인 안 절대 경로 — `<root>/consensus/meetings/<meetingId>/minutes.md`. */
  minutesPath: string;
  /** 'moderator' / 'moderator-retry' / 'fallback' — 회의록 출처 audit. */
  minutesSource: 'moderator' | 'moderator-retry' | 'fallback';
  /** 회의록 작성자 provider id. fallback 출처면 null. */
  minutesProviderId?: string | null;
}

export interface ReviewGateCardMeta {
  id?: string;
  kind: MeetingReviewGateKind | 'idea_bundle';
  status: MeetingReviewGateStatus;
  sourceChannelId: string;
  targetChannelId?: string | null;
  targetRole?: ChannelRole;
  title?: string;
}

export interface WireframeCheckpointCardMeta {
  id: string;
  kind: DesignCheckpointKind;
  status: DesignCheckpointStatus;
  channelId: string;
  title?: string;
}

/** Type guard: 의견 카드 메시지인가? */
export function hasOpinionMeta(
  meta: MessageMeta | null,
): meta is MessageMeta & { opinion: OpinionCardMeta } {
  if (meta === null || typeof meta !== 'object') return false;
  const op = meta.opinion;
  if (op === undefined || op === null || typeof op !== 'object') return false;
  return (
    typeof (op as OpinionCardMeta).opinionRef === 'string' &&
    typeof (op as OpinionCardMeta).opinionKind === 'string' &&
    typeof (op as OpinionCardMeta).opinionScreenId === 'string' &&
    typeof (op as OpinionCardMeta).authorLabel === 'string'
  );
}

/** Type guard: 회의록 카드 메시지인가? */
export function hasMinutesMeta(
  meta: MessageMeta | null,
): meta is MessageMeta & { minutes: MinutesCardMeta } {
  if (meta === null || typeof meta !== 'object') return false;
  const m = meta.minutes;
  if (m === undefined || m === null || typeof m !== 'object') return false;
  return (
    typeof (m as MinutesCardMeta).minutesPath === 'string' &&
    typeof (m as MinutesCardMeta).minutesSource === 'string'
  );
}

export function hasReviewGateMeta(
  meta: MessageMeta | null,
): meta is MessageMeta & { reviewGate: ReviewGateCardMeta & { id: string } } {
  if (meta === null || typeof meta !== 'object') return false;
  const gate = meta.reviewGate;
  if (gate === undefined || gate === null || typeof gate !== 'object') {
    return false;
  }
  return (
    typeof (gate as ReviewGateCardMeta).id === 'string' &&
    typeof (gate as ReviewGateCardMeta).kind === 'string' &&
    typeof (gate as ReviewGateCardMeta).status === 'string' &&
    typeof (gate as ReviewGateCardMeta).sourceChannelId === 'string'
  );
}

export function hasWireframeCheckpointMeta(
  meta: MessageMeta | null,
): meta is MessageMeta & { wireframeCheckpoint: WireframeCheckpointCardMeta } {
  if (meta === null || typeof meta !== 'object') return false;
  const checkpoint = meta.wireframeCheckpoint;
  if (
    checkpoint === undefined ||
    checkpoint === null ||
    typeof checkpoint !== 'object'
  ) {
    return false;
  }
  return (
    typeof (checkpoint as WireframeCheckpointCardMeta).id === 'string' &&
    typeof (checkpoint as WireframeCheckpointCardMeta).kind === 'string' &&
    typeof (checkpoint as WireframeCheckpointCardMeta).status === 'string' &&
    typeof (checkpoint as WireframeCheckpointCardMeta).channelId === 'string'
  );
}

export function hasPlanningDesignCheckMeta(
  meta: MessageMeta | null,
): meta is MessageMeta & { planningDesignCheck: PlanningDesignCheckCardMeta } {
  if (meta === null || typeof meta !== 'object') return false;
  const check = meta.planningDesignCheck;
  if (check === undefined || check === null || typeof check !== 'object') {
    return false;
  }
  return (
    typeof (check as PlanningDesignCheckCardMeta).id === 'string' &&
    typeof (check as PlanningDesignCheckCardMeta).status === 'string' &&
    typeof (check as PlanningDesignCheckCardMeta).returnCount === 'number' &&
    typeof (check as PlanningDesignCheckCardMeta).sourceDesignMeetingId ===
      'string' &&
    typeof (check as PlanningDesignCheckCardMeta).designChannelId === 'string' &&
    typeof (check as PlanningDesignCheckCardMeta).planningChannelId === 'string'
  );
}

export interface Message {
  id: string;
  channelId: string;
  meetingId: string | null;
  authorId: string;               // providerId 또는 literal 'user'
  authorKind: MessageAuthorKind;
  role: MessageRole;
  content: string;
  meta: MessageMeta | null;
  createdAt: number;
  /** Missing on legacy values means public. Persisted whispers always set both fields. */
  visibility?: 'public' | 'whisper';
  whisper?: WhisperDetails;
}

export interface MessageSearchResult extends Message {
  /** FTS rank (작을수록 정밀), SQLite bm25 음수값 */
  rank: number;
}

/**
 * Recent message summary for the R4 dashboard RecentWidget (spec §7.5).
 *
 * Joins `messages` with `channels` (for name) and `providers` (for sender
 * label) so the widget renders a row without extra IPC lookups. `excerpt`
 * is the first N chars of `content` (see RECENT_MESSAGE_EXCERPT_LEN in
 * `src/shared/constants.ts`).
 */
export interface RecentMessage {
  id: string;
  channelId: string;
  channelName: string;
  /** `providers.id` for member/system authors; literal `'user'` for user. */
  senderId: string;
  senderKind: MessageAuthorKind;
  /** Human label — provider.display_name for member, `'user'` literal for user. */
  senderLabel: string;
  /** First N chars of `content`; trailing ellipsis when truncated. */
  excerpt: string;
  createdAt: number;
}
