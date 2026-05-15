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

/**
 * Spec §7.5 — `messages.author_id` for the sole end-user is the literal
 * string `'user'`. Both the service-level guard
 * (`UserAuthorMismatchError`) and the SQLite trigger
 * `messages_author_fk_check` enforce this invariant. Renderer-side
 * optimistic inserts MUST use the same constant so the row submitted
 * via `message:append` round-trips against the same contract.
 */
export const USER_AUTHOR_LITERAL = 'user' as const;

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
