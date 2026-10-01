/**
 * Whisper thread positions (spec 2026-10-01 F2) — the one app-side
 * definition of who writes which position of a thread. Migration
 * `035-whisper-threads.ts` enforces the same rule in its insert trigger.
 *
 * A thread is the root whisper (position 1, root sender → root recipient)
 * plus alternating replies: even positions go from the root recipient back
 * to the root sender, odd positions from the root sender to the root
 * recipient, up to {@link CHAT_WHISPER_THREAD_MAX_MESSAGES}.
 */
import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from './chat-limits';

export const WHISPER_THREAD_ROOT_SEQ = 1;
export const WHISPER_THREAD_FIRST_REPLY_SEQ = 2;

export interface WhisperThreadPair {
  rootSenderId: string;
  rootRecipientId: string;
}

/** A position a reply may take: 2..CHAT_WHISPER_THREAD_MAX_MESSAGES. */
export function isWhisperThreadReplySeq(seq: number): boolean {
  return Number.isInteger(seq) && seq >= WHISPER_THREAD_FIRST_REPLY_SEQ &&
    seq <= CHAT_WHISPER_THREAD_MAX_MESSAGES;
}

/** Who writes position `seq` of the thread, and to whom. */
export function whisperThreadStep(pair: WhisperThreadPair, seq: number): { authorId: string; recipientId: string } {
  return seq % 2 === 0
    ? { authorId: pair.rootRecipientId, recipientId: pair.rootSenderId }
    : { authorId: pair.rootSenderId, recipientId: pair.rootRecipientId };
}

/**
 * Reads the stored position of a whisper row. Every whisper row carries one
 * from migration 035 on (backfill plus insert trigger), so a missing value
 * is damaged data and is reported instead of guessed.
 */
export function storedWhisperThreadSeq(messageId: string, value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < WHISPER_THREAD_ROOT_SEQ) {
    throw new Error(`Whisper ${messageId} has no valid thread position (whisper_thread_seq)`);
  }
  return value;
}
