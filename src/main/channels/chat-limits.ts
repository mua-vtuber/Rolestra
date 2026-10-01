/**
 * Chat runtime limits — the single definition shared by room and DM replies,
 * AI whispers, CLI session recovery and chat votes. Every chat path imports
 * these names; no module keeps a local copy of the numbers.
 */

/**
 * One provider turn may run this long. The clock starts when the turn's own
 * provider call starts; time spent waiting behind other rooms on the shared
 * CLI queue is not counted.
 */
export const CHAT_RESPONSE_TIMEOUT_MS = 60_000;

/** Largest provider output accepted for one reply, whisper or vote ballot. */
export const CHAT_RESPONSE_MAX_BYTES = 64 * 1024;

/** Recent visible messages given to a model: API history, CLI recovery and vote context. */
export const CHAT_HISTORY_LIMIT = 50;

/**
 * Most whispers one private thread may hold, the root included (spec
 * 2026-10-01 F2-2). Defined once in `src/shared/chat-thread-limits.ts`
 * because the observer view shows each reply as "position/cap"; listed here
 * with every other chat limit for main. Migration `035-whisper-threads.ts`
 * enforces the same number (see the shared file).
 */
export { CHAT_WHISPER_THREAD_MAX_MESSAGES } from '../../shared/chat-thread-limits';

/** A DM failure notice may carry at most this many characters of masked cause. */
export const DM_ERROR_DETAIL_MAX_CHARS = 160;

/** A failure log entry may carry at most this many characters of masked cause text. */
export const LOG_ERROR_CAUSE_MAX_CHARS = 500;
