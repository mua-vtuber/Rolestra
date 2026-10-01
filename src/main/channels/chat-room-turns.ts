/**
 * Room turns under the 2026-09-28 whisper rules (spec: ai-whispers,
 * "2026-09-28 규칙 변경") and the 2026-10-01 whisper threads (spec:
 * chat-silence-and-whisper-threads F2).
 *
 * A regular turn freely combines one public message and any number of
 * whispers (one per recipient); an explicit empty turn is silence. Storage
 * order: the public message first, then each whisper in output order, and
 * right after each stored whisper its whole thread: the two sides take
 * alternating private reply turns (recipient first) until one declines, a
 * reply fails, the room closes or the thread holds
 * CHAT_WHISPER_THREAD_MAX_MESSAGES rows, root included. Only then does the
 * next whisper's thread start, and only after the last one the next member.
 * A private reply answers or declines and can never whisper to anyone.
 *
 * Every regular turn offers the same recipient list — every other current,
 * registered participant — whatever happened earlier in the round, so no
 * hint reveals that a whisper took place. Silence is stored as an
 * observer-only notice, excluded from all model input like failure notices.
 *
 * The provider call itself (CLI session or API stream, response clock,
 * abort and failure notices) belongs to `DmAutoResponder.callTurn`.
 */
import type { Channel } from '../../shared/channel-types';
import type { ChatRoomMember } from '../../shared/chat-room-types';
import type { ChatSpeakerSilenceCode, Message as ChannelMessage } from '../../shared/message-types';
import type { ChatActivityTarget } from '../../shared/stream-events';
import { tryGetLogger } from '../log/logger-accessor';
import type { BaseProvider } from '../providers/provider-interface';
import type { ChannelService } from './channel-service';
import type { ChatRoomService } from './chat-room-service';
import type { MessageService } from './message-service';
import { CHAT_WHISPER_THREAD_MAX_MESSAGES } from './chat-limits';
import {
  InvalidChatOutputError, parsePrivateReplyOutput, parseRoomTurnOutput, privateReplyHint, roomTurnHint,
  whisperThreadReplyHint, WhisperRecipientUnavailableError, type ChatRoundSourceKind, type RoomWhisper,
} from './chat-whisper-output';
import { ParticipantAliasCollisionError, participantAlias, participantAliasMap } from './participant-alias';
import { WHISPER_THREAD_FIRST_REPLY_SEQ, whisperThreadStep, type WhisperThreadPair } from './whisper-thread';

/** One provider call of a chat turn. `consume` validates and stores its output. */
export interface ChatTurnCall {
  channel: Channel;
  providerId: string;
  roomMembers: ChatRoomMember[] | null;
  /** Rooms and the general channel use the JSON room contract; DMs reply in plain text. */
  group: boolean;
  hint: string;
  /** Private replies answer a new root whisper; regular turns may resume with the hint alone. */
  requiresNewInput: boolean;
  /** What the writing indicator shows for this call (spec 2026-10-01 F5). */
  activity: ChatActivityTarget;
  consume(raw: string): void;
}

/** The stored row a round is bound to, and whether it came from the pass button (F1). */
export interface ChatRoundSource {
  messageId: string;
  kind: ChatRoundSourceKind;
}

export interface ChatRoomTurnsDeps {
  channelService: Pick<ChannelService, 'listMembers'>;
  roomService?: Pick<ChatRoomService, 'get' | 'listMembers'>;
  messageService: Pick<MessageService, 'append' | 'appendWhisper'>;
  providerLookup: { get(id: string): BaseProvider | undefined };
  /** Runs one provider call. False when it failed (a notice is stored) or the room closed. */
  callTurn(turn: ChatTurnCall): Promise<boolean>;
  isChannelClosed(channelId: string): boolean;
  assertChannelActive(channelId: string): void;
  /** Stores the failure notice for a whisper that could not be written. */
  reportWhisperFailure(channelId: string, senderId: string, error: unknown): void;
  /** Stores the failure notice for a regular turn that could not start. */
  reportTurnFailure(channelId: string, senderId: string, error: unknown): void;
}

/**
 * How a member's regular turn ended (spec 2026-10-01 F3). `silent` is an
 * explicit empty turn only; a turn that whispered spoke, whatever happened
 * to its threads. `failed` stored a failure notice; `closed` means the room
 * closed before the turn completed.
 */
export type RoomTurnOutcome = 'spoke' | 'silent' | 'failed' | 'closed';

interface Recipient { providerId: string; displayName: string }
interface WhisperThread { rootId: string; sourceMessageId: string; pair: WhisperThreadPair }

export class ChatRoomTurns {
  constructor(private readonly deps: ChatRoomTurnsDeps) {}

  async runTurn(channel: Channel, senderId: string, roomMembers: ChatRoomMember[] | null,
    round: ChatRoundSource): Promise<RoomTurnOutcome> {
    const recipients = this.liveRecipients(channel.id, senderId);
    // Models address recipients by opaque alias only (spec 2026-09-29 §C). The
    // sender is part of the collision check but never an eligible recipient.
    let recipientsByAlias: Map<string, string>;
    try {
      recipientsByAlias = participantAliasMap(channel.id,
        [senderId, ...recipients.map((item) => item.providerId)]);
    } catch (error) {
      // Two participants of this room share an alias, so a whisper could not
      // be routed. The turn is not run; its notice names the cause and the
      // round goes on with the next member.
      if (!(error instanceof ParticipantAliasCollisionError)) throw error;
      this.deps.reportTurnFailure(channel.id, senderId, error);
      return 'failed';
    }
    recipientsByAlias.delete(participantAlias(channel.id, senderId));
    // Filled by `consume`; an object so the flow after the await reads the
    // values the closure wrote.
    const decided: { silent: boolean; whispers: RoomWhisper[] } = { silent: false, whispers: [] };
    const completed = await this.deps.callTurn({
      channel, providerId: senderId, roomMembers, group: true, requiresNewInput: false,
      activity: { kind: 'turn' },
      hint: roomTurnHint(recipients.map((item) => ({
        id: participantAlias(channel.id, item.providerId), name: item.displayName })), round.kind),
      consume: (raw) => {
        const decision = parseRoomTurnOutput(raw, recipientsByAlias, senderId);
        if (decision.public !== null) {
          this.deps.messageService.append({ channelId: channel.id, meetingId: null, authorId: senderId,
            authorKind: 'member', role: 'assistant', content: decision.public });
        } else if (decision.whispers.length === 0) {
          this.appendSilence(channel.id, senderId, 'turn_passed', roomMembers);
          decided.silent = true;
        }
        decided.whispers = decision.whispers;
      },
    });
    if (!completed) return this.deps.isChannelClosed(channel.id) ? 'closed' : 'failed';
    if (decided.silent) return 'silent';
    const senderName = this.nameFor(channel.id, senderId, roomMembers);
    for (const whisper of decided.whispers) {
      if (this.deps.isChannelClosed(channel.id)) break;
      const recipient = recipients.find((item) => item.providerId === whisper.recipientId);
      if (!recipient) throw new Error(`Validated whisper recipient missing: ${whisper.recipientId}`);
      const root = this.storeRoot(channel.id, senderId, senderName, recipient, whisper.content, round.messageId);
      if (root === null || this.deps.isChannelClosed(channel.id)) continue;
      await this.runThread(channel, roomMembers, {
        rootId: root.id, sourceMessageId: round.messageId,
        pair: { rootSenderId: senderId, rootRecipientId: recipient.providerId },
      });
    }
    return 'spoke';
  }

  /**
   * Runs one whisper thread to its end: the reply positions after the root,
   * each asked of the side whose turn it is, until a side declines, a reply
   * fails, the room closes or the thread is full. A full thread is not asked
   * again.
   */
  private async runThread(channel: Channel, roomMembers: ChatRoomMember[] | null,
    thread: WhisperThread): Promise<void> {
    for (let seq = WHISPER_THREAD_FIRST_REPLY_SEQ; seq <= CHAT_WHISPER_THREAD_MAX_MESSAGES; seq += 1) {
      if (this.deps.isChannelClosed(channel.id)) return;
      // Defensive guard: never ask a model for a row that could not be stored.
      // This runs right after the previous row was stored, in the same promise
      // chain, so no IPC handler (e.g. removing a provider) can run in between
      // and in practice it does not fire. If it does, no model was asked and
      // nothing was stored, so the thread just ends with a log entry. That is
      // unlike `storeRoot` (W10), which stores `recipient_unavailable` because
      // a whisper the model already wrote is dropped — as does `runThreadReply`
      // when a side disappears while its model is answering.
      const step = whisperThreadStep(thread.pair, seq);
      if (!this.isLivePair(channel.id, step.authorId, step.recipientId)) {
        tryGetLogger()?.warn({ component: 'chat-room-turns', action: 'whisper-thread-ended', result: 'failure',
          metadata: { channelId: channel.id, rootId: thread.rootId, seq, reason: 'participant_unavailable' } });
        return;
      }
      if (!(await this.runThreadReply(channel, roomMembers, thread, seq))) return;
    }
  }

  /**
   * One private reply turn of a thread. True only when a reply was stored;
   * a failure stores its notice through `callTurn`. Only a declined first
   * reply (the root recipient saying nothing) stores a `reply_passed`
   * silence notice; a later `null` ends the thread quietly, like reaching
   * the cap (user decision 2026-10-01).
   */
  private async runThreadReply(channel: Channel, roomMembers: ChatRoomMember[] | null,
    thread: WhisperThread, seq: number): Promise<boolean> {
    const { authorId, recipientId } = whisperThreadStep(thread.pair, seq);
    const otherName = this.nameFor(channel.id, recipientId, roomMembers);
    const stored = { reply: false };
    const completed = await this.deps.callTurn({
      channel, providerId: authorId, roomMembers, group: true, requiresNewInput: true,
      activity: { kind: 'whisper', peerProviderId: recipientId },
      hint: seq === WHISPER_THREAD_FIRST_REPLY_SEQ ? privateReplyHint(otherName) : whisperThreadReplyHint(otherName),
      consume: (raw) => {
        const { reply } = parsePrivateReplyOutput(raw);
        if (reply === null) {
          if (seq === WHISPER_THREAD_FIRST_REPLY_SEQ) {
            this.appendSilence(channel.id, authorId, 'reply_passed', roomMembers);
          }
          return;
        }
        // The pair was live when this turn started (`runThread`); a side that
        // disappeared during the model call is named as the cause, as in W10.
        try {
          this.assertLivePair(channel.id, authorId, recipientId);
        } catch (error) {
          throw error instanceof InvalidChatOutputError ? new WhisperRecipientUnavailableError() : error;
        }
        this.deps.messageService.appendWhisper({
          channelId: channel.id, authorId, recipientId, content: reply,
          senderName: this.nameFor(channel.id, authorId, roomMembers), recipientName: otherName,
          sourceMessageId: thread.sourceMessageId, replyToMessageId: thread.rootId, threadSeq: seq,
        });
        stored.reply = true;
      },
    });
    return completed && stored.reply;
  }

  /**
   * A whisper whose pair is no longer live is dropped with a notice; the
   * rest of the turn goes on. `assertLivePair` throws
   * {@link InvalidChatOutputError} for every kind of dead pair (sender or
   * recipient gone), but at THIS call site (W10) the sender was just
   * validated moments ago in `runTurn` — only the recipient can have
   * disappeared in between. Re-wrapping as
   * {@link WhisperRecipientUnavailableError} here (and only here) lets the
   * sender's notice name the real cause instead of reading like their own
   * output was invalid.
   */
  private storeRoot(channelId: string, senderId: string, senderName: string, recipient: Recipient,
    content: string, sourceMessageId: string): ChannelMessage | null {
    try {
      this.assertLivePair(channelId, senderId, recipient.providerId);
      return this.deps.messageService.appendWhisper({
        channelId, authorId: senderId, recipientId: recipient.providerId, content, senderName,
        recipientName: recipient.displayName, sourceMessageId, replyToMessageId: null,
      });
    } catch (error) {
      const reported = error instanceof InvalidChatOutputError
        ? new WhisperRecipientUnavailableError()
        : error;
      if (!this.deps.isChannelClosed(channelId)) this.deps.reportWhisperFailure(channelId, senderId, reported);
      return null;
    }
  }

  private appendSilence(channelId: string, providerId: string, code: ChatSpeakerSilenceCode,
    roomMembers: ChatRoomMember[] | null): void {
    this.deps.messageService.append({
      channelId, meetingId: null, authorId: providerId, authorKind: 'member', role: 'system',
      content: code, meta: { chatSilence: { code, speakerName: this.nameFor(channelId, providerId, roomMembers) } },
    });
  }

  private members(channelId: string): Array<{ providerId: string; displayName?: string }> {
    return this.deps.roomService?.get(channelId)
      ? this.deps.roomService.listMembers(channelId)
      : this.deps.channelService.listMembers(channelId);
  }

  private liveRecipients(channelId: string, senderId: string): Recipient[] {
    this.deps.assertChannelActive(channelId);
    return this.members(channelId)
      .filter((member) => member.providerId !== senderId && this.deps.providerLookup.get(member.providerId) !== undefined)
      .map((member) => ({ providerId: member.providerId,
        displayName: member.displayName ?? this.deps.providerLookup.get(member.providerId)?.displayName
          ?? participantAlias(channelId, member.providerId) }));
  }

  /** {@link assertLivePair} as a question; a closed room still throws. */
  private isLivePair(channelId: string, senderId: string, recipientId: string): boolean {
    try {
      this.assertLivePair(channelId, senderId, recipientId);
      return true;
    } catch (error) {
      if (error instanceof InvalidChatOutputError) return false;
      throw error;
    }
  }

  /** Re-checked right before every whisper write: both sides live, registered and in the room. */
  private assertLivePair(channelId: string, senderId: string, recipientId: string): void {
    this.deps.assertChannelActive(channelId);
    if (senderId === recipientId || !this.deps.providerLookup.get(senderId) ||
      !this.deps.providerLookup.get(recipientId)) throw new InvalidChatOutputError();
    const members = this.members(channelId);
    if (!members.some((member) => member.providerId === senderId) ||
      !members.some((member) => member.providerId === recipientId)) throw new InvalidChatOutputError();
  }

  /**
   * The name stored with a whisper or silence row and used in the private
   * reply hint. Model-facing whisper labels do not read the stored name (they
   * resolve the current one, `chat-session-coordinator.ts` `toProviderMessages`),
   * but the hint does, so a missing name falls to the participant's alias,
   * never its provider id.
   */
  private nameFor(channelId: string, providerId: string, roomMembers: ChatRoomMember[] | null): string {
    return roomMembers?.find((item) => item.providerId === providerId)?.displayName
      ?? this.deps.providerLookup.get(providerId)?.displayName ?? participantAlias(channelId, providerId);
  }
}
