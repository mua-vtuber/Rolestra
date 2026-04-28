/**
 * Channel Message 도메인 타입 — migrations/005-messages.ts 컬럼과 1:1 camelCase 매핑.
 *
 * 주의: shared/provider-types.ts의 Message(프로바이더 I/O 용)와 이름이 겹치지만
 * 서로 다른 도메인이므로 둘 다 유지한다. import 시 별칭으로 구분한다.
 */

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
  [k: string]: unknown;
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
