/**
 * Channel Message 도메인 타입 — migrations/005-messages.ts 컬럼과 1:1 camelCase 매핑.
 *
 * 주의: shared/provider-types.ts의 Message(프로바이더 I/O 용)와 이름이 겹치지만
 * 서로 다른 도메인이므로 둘 다 유지한다. import 시 별칭으로 구분한다.
 */

export type MessageAuthorKind = 'user' | 'member' | 'system';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

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
