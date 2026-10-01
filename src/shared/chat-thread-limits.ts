/**
 * Whisper thread cap shared by main and the renderer (spec 2026-10-01 F2-2).
 *
 * Most whispers one private thread may hold, the root included: root A→B,
 * then B→A, A→B, B→A. Reaching it ends the thread without asking again; the
 * observer view labels each reply "position/cap". Migration
 * `035-whisper-threads.ts` enforces the same number in its insert trigger; a
 * migration never imports app code, so changing this value needs a new
 * migration that moves the DB limit with it
 * (`migration-035-whisper-threads.test.ts` fails otherwise). Main reads it
 * through `src/main/channels/chat-limits.ts`, the list of every chat limit.
 */
export const CHAT_WHISPER_THREAD_MAX_MESSAGES = 4;
