import {
  isChatPassMessage, isChatVoteResultMessage, type ChatErrorCode, type Message as ChannelMessage,
} from '../../shared/message-types';
import { ChatCliInstructionsInsideWorkspaceError } from '../files/chat-cli-instructions';
import { ProviderUsageLimitError } from '../providers/provider-usage-limit-error';
import { CHAT_RESPONSE_MAX_BYTES } from './chat-limits';
import { ParticipantAliasCollisionError } from './participant-alias';

/**
 * Room output contract (2026-09-28 whisper rules). A regular turn freely
 * combines at most one public message with any number of whispers, one per
 * recipient; `{ public: null, whispers: [] }` is an explicit silence. A private
 * reply either answers or declines. Both are strict JSON with no extra keys.
 */
export interface RoomWhisper {
  /** The provider id resolved from the alias the model wrote (`participant-alias.ts`). */
  recipientId: string;
  content: string;
}
export interface RoomTurnDecision { public: string | null; whispers: RoomWhisper[] }
export interface PrivateReplyDecision { reply: string | null }

/**
 * Output the room cannot use. `empty_response` marks a provider that finished
 * without any content; both reasons surface as the `invalid_response` notice.
 */
export class InvalidChatOutputError extends Error {
  constructor(reason: 'invalid_response' | 'empty_response' = 'invalid_response') { super(reason); }
}

export class ChatOutputLimitError extends Error {
  constructor() { super('output_limit'); }
}

/**
 * A validated whisper recipient stopped being live between validation and
 * the store-time re-check in `chat-room-turns.ts`'s `storeRoot` (W10 — the
 * recipient list is snapshotted before the model call, so this is a
 * store-time race, not a model mistake). Kept distinct from
 * {@link InvalidChatOutputError} so the sender's notice names the real
 * cause instead of reading like the model produced bad output.
 */
export class WhisperRecipientUnavailableError extends Error {
  constructor() { super('recipient_unavailable'); }
}

/** Maps a failed chat turn (or whisper write) to the stored notice code. */
export function chatErrorCodeFor(error: unknown, timedOut: boolean): ChatErrorCode {
  if (timedOut) return 'timeout';
  if (error instanceof ProviderUsageLimitError) return 'usage_limit';
  if (error instanceof WhisperRecipientUnavailableError) return 'recipient_unavailable';
  if (error instanceof InvalidChatOutputError) return 'invalid_response';
  if (error instanceof ChatOutputLimitError) return 'whisper_limit';
  // Not the provider's fault: a generic provider_error would send the user
  // looking at the AI instead of at the room or the app folder layout.
  if (error instanceof ParticipantAliasCollisionError) return 'participant_alias_collision';
  if (error instanceof ChatCliInstructionsInsideWorkspaceError) return 'consensus_folder_contains_app_data';
  return 'provider_error';
}

/**
 * A provider that only emits whitespace produced no real content. Both the
 * CLI coordinator and the API/CLI callers in `dm-auto-responder.ts` must
 * treat this the same as a truly empty stream — trimming here means every
 * caller sees one definition instead of repeating `.trim()` (D1).
 */
export function isEmptyChatOutput(raw: string): boolean {
  return raw.trim().length === 0;
}

/**
 * W9 (user decision, 2026-09-28): tolerate exactly one code-fence wrapper
 * around the whole output. Strips one leading BOM and surrounding
 * whitespace, then unwraps a single ```` ``` ```` or ```` ```json ````
 * block only when the fence spans the ENTIRE (trimmed) string — prose
 * before/after the block, a second block, or text after the closing fence
 * all fail to match and are left as-is, so the strict parser that runs
 * next still rejects them. Shared by the room-turn parser, the
 * private-reply parser and the vote parser (`chat-vote-service.ts`) so all
 * three apply the exact same tolerance.
 */
export function unwrapSingleJsonFence(raw: string): string {
  const withoutBom = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const trimmed = withoutBom.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidChatOutputError();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).sort().join(',') !== [...keys].sort().join(',')) throw new InvalidChatOutputError();
  return object;
}

function parseExactObject(raw: string, keys: readonly string[]): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(unwrapSingleJsonFence(raw)); } catch { throw new InvalidChatOutputError(); }
  return exactObject(value, keys);
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new InvalidChatOutputError();
  return value.trim();
}

/**
 * Validates the whole turn before anything is stored: an extra key, blank
 * text, an unknown recipient, the sender itself or a second whisper to the
 * same recipient rejects the entire output.
 *
 * The model addresses recipients by the opaque alias the turn hint listed
 * (`participant-alias.ts`), never by provider id. `recipientsByAlias` maps
 * each eligible alias back to its provider id; the returned whispers carry
 * that provider id. A raw provider id, the sender's own alias or any alias
 * not in the map is an unknown recipient.
 */
export function parseRoomTurnOutput(
  raw: string,
  recipientsByAlias: ReadonlyMap<string, string>,
  senderId: string,
): RoomTurnDecision {
  const object = parseExactObject(raw, ['public', 'whispers']);
  const publicText = object.public === null ? null : text(object.public);
  if (!Array.isArray(object.whispers)) throw new InvalidChatOutputError();
  const recipients = new Set<string>();
  const whispers = object.whispers.map((item: unknown): RoomWhisper => {
    const whisper = exactObject(item, ['recipientId', 'content']);
    const alias = whisper.recipientId;
    const recipientId = typeof alias === 'string' ? recipientsByAlias.get(alias) : undefined;
    if (recipientId === undefined || recipientId === senderId || recipients.has(recipientId)) {
      throw new InvalidChatOutputError();
    }
    recipients.add(recipientId);
    return { recipientId, content: text(whisper.content) };
  });
  return { public: publicText, whispers };
}

/** A private reply can only answer or decline; it can never start a whisper. */
export function parsePrivateReplyOutput(raw: string): PrivateReplyDecision {
  const object = parseExactObject(raw, ['reply']);
  return { reply: object.reply === null ? null : text(object.reply) };
}

/**
 * Silence guidance for rooms and the general channel (spec 2026-10-01 F4-1).
 * Models are built to answer, so the rule names concrete moments to stay
 * silent instead of a vague "speak when relevant". DMs never get it: a DM
 * always answers (F4-5).
 */
const ROOM_SILENCE_RULES = 'Silence: Silence is normal and often the best choice. ' +
  'Do not speak just because it is your turn. ' +
  'Stay silent when the topic has reached a conclusion, after goodbyes have been exchanged, ' +
  'when you would only agree, thank or repeat what was said, or when no one needs your answer. ' +
  'Speak only when you add something new.';

/**
 * Stable for every turn kind of one participant, so a CLI session is not
 * rebuilt between a private reply and the same participant's regular turn.
 * This text is the real version marker of the room output contract
 * (`chat-session-coordinator.ts` fingerprint): editing it rebuilds every
 * room CLI session once.
 */
export function roomOutputPersona(persona: string): string {
  return `${persona}\n\nRoom output: Answer every turn with exactly one JSON object and nothing else (no markdown, no extra keys).\n` +
    '- Room turn: {"public":"message"|null,"whispers":[{"recipientId":"ID","content":"message"}]}. "public" is said to everyone; null says nothing publicly. Each whisper goes privately to one listed participant, at most one per participant; [] sends none. {"public":null,"whispers":[]} passes the turn in silence.\n' +
    '- Private reply: {"reply":"message"|null}. It goes only to the other participant of that private exchange; null means you do not reply and ends the exchange. A private exchange can go back and forth a few times. A reply cannot whisper.\n' +
    'Whispers are visible only to their two AI participants and the human observer. Never repeat private content in a public message.\n' +
    ROOM_SILENCE_RULES;
}

/**
 * W8: appended to every turn hint so a fresh/recovered CLI session and every
 * API turn is told, every time, not to wrap its JSON. Hints are not part of
 * the session fingerprint (`chat-session-coordinator.ts`), so adding this
 * line does not rebuild any existing session — W9 still tolerates exactly
 * one code-fence wrapper regardless of whether a model follows this line.
 */
const NO_FENCE_LINE = 'Output only the raw JSON object: no code fence and no text before or after it.';

/**
 * Every regular turn lists every other live participant, whatever happened
 * earlier in the round, so the hint never reveals that a whisper took place.
 * `id` is the participant's opaque alias (`participant-alias.ts`), never a
 * provider id.
 */
export function roomTurnHint(recipients: ReadonlyArray<{ id: string; name: string }>,
  source: ChatRoundSourceKind = 'message'): string {
  const silence = source === 'pass' ? PASS_ROUND_LINE : 'Stay silent unless you have something new to add.';
  return `Room turn: reply with {"public":"message"|null,"whispers":[{"recipientId":"ID","content":"message"}]}. You may whisper to any of these participants, at most once each: ${JSON.stringify(recipients)}. {"public":null,"whispers":[]} stays silent this turn. ${silence} Never publish private content. ${NO_FENCE_LINE}`;
}

/** What started a round: a user message, or the pass button (spec 2026-10-01 F1). */
export type ChatRoundSourceKind = 'message' | 'pass';

/** Regular-turn hint line of a pass round (spec 2026-10-01 F1-4). */
const PASS_ROUND_LINE = 'The user passed without adding anything. Speak only if you have something new to say; otherwise stay silent.';

/**
 * Model-facing text of a stored pass row (spec 2026-10-01 F1-4). The row
 * itself stores only `CHAT_PASS_CODE`; every model input builder (CLI, API
 * history, vote context) shows this line in its place, after the usual
 * `[Speaker: "User"]` label.
 */
export const CHAT_PASS_MODEL_LINE = 'The user added nothing and let the conversation continue.';

/** Expand code-only public notices for every model input path. */
export function modelFacingBody(message: Pick<ChannelMessage, 'authorKind' | 'role' | 'meta' | 'content'>): string {
  if (isChatVoteResultMessage(message)) {
    const { title, counts } = message.meta.chatVoteResult;
    return `The user shared the final vote result for proposal ${JSON.stringify(title)}. ` +
      `Final tally — agree: ${counts.agree}; oppose: ${counts.oppose}; abstain: ${counts.abstain}; unanswered: ${counts.failed}. ` +
      'Individual ballots and reasons have not been shared. React to the result without inventing who voted for what.';
  }
  return isChatPassMessage(message) ? CHAT_PASS_MODEL_LINE : message.content;
}

/**
 * DM turn hint (D2). A DM is a 1:1 conversation, not a room, and this hint
 * must never claim new activity happened — the CLI path can resume with no
 * unseen input (see `buildChatDeltaPrompt`'s own neutral wording for that
 * case), and asserting "new activity" then would be false.
 */
export function directMessageTurnHint(): string {
  return 'Reply to the user in this direct conversation.';
}

/**
 * First reply of a whisper thread (position 2): the recipient answers the
 * root whisper only when it needs an answer (spec 2026-10-01 F4-2).
 */
export function privateReplyHint(senderName: string): string {
  return `Private reply to ${JSON.stringify(senderName)}: they whispered to you. Reply only if the whisper needs an answer; otherwise return {"reply":null}. Return {"reply":"message"} to answer only them. Do not start a new whisper. ${NO_FENCE_LINE}`;
}

/**
 * Later replies of a whisper thread (position 3 and up, spec 2026-10-01
 * F2-5): the other side answered, so reply again only when it is still
 * needed. `otherName` follows the same name rules as {@link privateReplyHint}.
 */
export function whisperThreadReplyHint(otherName: string): string {
  return `Private reply to ${JSON.stringify(otherName)}: they answered you. Reply again only if it still needs an answer; otherwise return {"reply":null}. Return {"reply":"message"} to answer only them. Do not start a new whisper. ${NO_FENCE_LINE}`;
}

/** Bounds the output even when a transport ignores cancellation. */
export async function collectChatOutput(stream: AsyncGenerator<string>, signal?: AbortSignal,
  onChunk?: (chunk: string) => void): Promise<string> {
  if (signal?.aborted) throw new Error('chat_aborted');
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('chat_aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  let content = '';
  let completed = false;
  try {
    for (;;) {
      const next = await (signal ? Promise.race([stream.next(), aborted]) : stream.next());
      if (next.done) { completed = true; break; }
      content += next.value;
      onChunk?.(next.value);
      if (Buffer.byteLength(content, 'utf8') > CHAT_RESPONSE_MAX_BYTES) throw new ChatOutputLimitError();
    }
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (!completed) {
      // A transport may ignore cancellation. Do not wait forever for cleanup.
      void stream.return('').catch(() => undefined);
    }
  }
  return content;
}
