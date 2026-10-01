/**
 * DmAutoResponder — D-A Task 6.
 *
 * Spec §3.1 — DM channels are single-turn: one user message in, one
 * assistant message out. No meeting row, no orchestrator, no consensus
 * SSM. The renderer's DM thread already shows messages straight from
 * `messageService.listByChannel`; this responder just makes sure each
 * user message gets a reply.
 *
 * Wired up at startup (T5) as the `dmResponder` dependency of
 * {@link MeetingAutoTrigger}. The trigger receives every channel
 * message via `MessageService.on('message')` and forwards DMs here.
 *
 * Rooms and the general channel run one round per user message; each member's
 * turn, its whispers and their threads of private replies live in
 * `chat-room-turns.ts`. A round in which every member stayed silent ends with
 * one observer-only `round_all_silent` notice (spec 2026-10-01 F3). DMs always
 * reply in plain text.
 *
 * Failure mode: when a turn fails or ends without content while the room is
 * open, we append a `system` notice that stores only a `meta.chatError` code;
 * the renderer translates it. A DM notice for a generic provider failure may
 * add one masked, shortened line of cause (`meta.chatErrorDetail`); room
 * notices never carry provider text. Notices are observer-only: no model
 * input reads them (`message-visibility.ts`). A room closed by archive,
 * delete, pause or shutdown ends the turn without a notice.
 */

import { EventEmitter } from 'node:events';
import type { Channel } from '../../shared/channel-types';
import type { ChatRoomMember } from '../../shared/chat-room-types';
import {
  CHAT_ROUND_SILENCE_CODE, isChatPassMessage, type ChatErrorCode, type Message as ChannelMessage,
} from '../../shared/message-types';
import type {
  ChatActivityPhase, StreamChatActivityPayload, StreamChatRoundPayload,
} from '../../shared/stream-events';
import type { Message as ProviderMessage } from '../../shared/provider-types';
import { tryGetLogger } from '../log/logger-accessor';
import { maskSecrets } from '../log/mask-secrets';
import type { BaseProvider } from '../providers/provider-interface';
import type { CompletionOptions } from '../../shared/provider-types';
import type { MemberProfile } from '../../shared/member-profile-types';
import { buildChatPersona, withChatRuntimeRules } from '../members/persona-builder';
import { consensusOnlyCliWorkspace } from '../providers/cli/cli-workspace';
import { isCliProvider } from '../providers/cli/is-cli-provider';
import { isSupportedChatCliCommand } from '../providers/factory';
import { CliProvider } from '../providers/cli/cli-provider';
import type { ChannelService } from './channel-service';
import type { MessageService } from './message-service';
import type { ChatRoomService } from './chat-room-service';
import type { ChatSessionCoordinator } from './chat-session-coordinator';
import {
  CHAT_HISTORY_LIMIT, CHAT_RESPONSE_TIMEOUT_MS, DM_ERROR_DETAIL_MAX_CHARS, LOG_ERROR_CAUSE_MAX_CHARS,
} from './chat-limits';
import { ChatRoomTurns, type ChatRoundSource, type ChatTurnCall, type RoomTurnOutcome } from './chat-room-turns';
import { participantAlias } from './participant-alias';
import { SystemRowInModelInputError } from './message-visibility';
import {
  InvalidChatOutputError, chatErrorCodeFor, collectChatOutput, directMessageTurnHint, isEmptyChatOutput,
  modelFacingBody, roomOutputPersona,
} from './chat-whisper-output';

/** DM only: the first non-empty line of the cause, secrets masked, then shortened. */
function dmErrorDetail(message: string): string | undefined {
  const line = message.trim().split(/\r?\n/, 1)[0]?.trim();
  return line ? maskSecrets(line).slice(0, DM_ERROR_DETAIL_MAX_CHARS) : undefined;
}

export interface DmAutoResponderDeps {
  channelService: Pick<ChannelService, 'listMembers'> & Partial<Pick<ChannelService, 'get'>>;
  messageService: Pick<MessageService, 'listByChannel' | 'append' | 'appendWhisper'>;
  providerLookup: { get(id: string): BaseProvider | undefined };
  memberProfileLookup: { getProfile(providerId: string): MemberProfile };
  /**
   * 초기화가 끝난 합의 폴더 경로. 프로젝트가 없는 DM / 일반 채널의 CLI
   * 직원은 여기서 실행된다. 아직 초기화 전이면 throw 하는 함수를 넘긴다.
   */
  consensusPath: () => string;
  roomService?: Pick<ChatRoomService, 'get' | 'listMembers' | 'getEffectivePersona' | 'assertActive'>;
  cliSessionCoordinator?: Pick<ChatSessionCoordinator, 'respond' | 'closeRoom' | 'shutdown'>;
  roundRepository?: {
    claim(channelId: string, userMessageId: string): boolean;
    finish(channelId: string, userMessageId: string): void;
    interrupt(channelId: string, userMessageId: string): void;
    interruptChannel(channelId: string): void;
    interruptRunning(): void;
  };
}

/**
 * Event name of the writing indicator (spec 2026-10-01 F5): every provider
 * call of a chat turn emits `queued` (a CLI turn waiting on the shared CLI
 * queue), `writing`, and always `idle` when it ends. Payload:
 * {@link StreamChatActivityPayload}. Nothing is stored; the stream bridge
 * forwards it to the renderer as `stream:chat-activity`.
 */
export const CHAT_ACTIVITY_EVENT = 'activity';

/**
 * Event name of the round signal (QA M1 on spec 2026-10-01 F1/F5): `true`
 * when a channel gets its first pending round (or DM reply), `false` when
 * the last one is gone — or at once when the room closes. Payload:
 * {@link StreamChatRoundPayload}; forwarded as `stream:chat-round`.
 */
export const CHAT_ROUND_EVENT = 'round';

export class DmAutoResponder extends EventEmitter {
  private shuttingDown = false;
  private readonly pendingByRoom = new Map<string, Promise<void>>();
  private readonly abortByRoom = new Map<string, AbortController>();
  private readonly closedRooms = new Set<string>();
  private readonly pausedRooms = new Set<string>();
  private readonly closeTasks = new Set<Promise<void>>();
  /** The one provider call each channel has queued or writing (a channel runs its calls in turn). */
  private readonly inFlightByRoom = new Map<string, ChatTurnCall>();
  /** Closed rooms whose round already reported `false` while their last promise still settles. */
  private readonly roundEndedEarly = new Set<string>();
  private readonly roomTurns: ChatRoomTurns;
  constructor(private readonly deps: DmAutoResponderDeps) {
    super();
    this.roomTurns = new ChatRoomTurns({
      channelService: deps.channelService, roomService: deps.roomService,
      messageService: deps.messageService, providerLookup: deps.providerLookup,
      callTurn: (turn) => this.callTurn(turn),
      isChannelClosed: (channelId) => this.isChannelClosed(channelId),
      assertChannelActive: (channelId) => this.assertChannelActive(channelId),
      reportWhisperFailure: (channelId, senderId, error) =>
        this.reportFailure(channelId, senderId, error, { group: true, timedOut: false, action: 'whisper-store-failed' }),
      reportTurnFailure: (channelId, senderId, error) =>
        this.reportFailure(channelId, senderId, error, { group: true, timedOut: false, action: 'turn-start-failed' }),
    });
  }

  /**
   * True while this channel has a round (or DM reply) running or waiting
   * behind one. The pass button is refused then (spec 2026-10-01 F1-5).
   */
  hasActiveRound(channelId: string): boolean {
    return this.pendingByRoom.has(channelId);
  }

  /**
   * Channels whose round signal is on right now — what `stream:chat-round`
   * last reported for each (QA M1). A reloaded renderer starts from this.
   */
  activeRoundChannelIds(): string[] {
    return [...this.pendingByRoom.keys()].filter((channelId) => !this.roundEndedEarly.has(channelId));
  }

  async handle(_message: ChannelMessage, channel: Channel): Promise<void> {
    if (this.shuttingDown) return;
    const prior = this.pendingByRoom.get(channel.id);
    const current = (prior ?? Promise.resolve()).catch(() => undefined).then(() => this.handleNow(_message, channel));
    this.pendingByRoom.set(channel.id, current);
    if (prior === undefined) this.reportRound(channel.id, true);
    try {
      await current;
    } finally {
      if (this.pendingByRoom.get(channel.id) === current) {
        this.pendingByRoom.delete(channel.id);
        if (!this.roundEndedEarly.delete(channel.id)) this.reportRound(channel.id, false);
      }
    }
  }

  private async handleNow(source: ChannelMessage, channel: Channel): Promise<void> {
    if (this.isChannelClosed(channel.id)) return;
    this.assertChannelActive(channel.id);
    const roomMembers = this.deps.roomService?.get(channel.id)
      ? this.deps.roomService.listMembers(channel.id)
      : null;
    const members = roomMembers ?? this.deps.channelService.listMembers(channel.id);
    if (members.length === 0) {
      tryGetLogger()?.warn({
        component: 'dm-auto-responder',
        action: 'no-member',
        result: 'failure',
        metadata: { channelId: channel.id },
      });
      return;
    }

    // 일반 채널 (전역 system_general) 과 채팅방은 사용자 메시지 1건마다 라운드
    // 1회: 등록 직원이 순서대로 1턴씩 차례를 갖는다. 각 차례는 공개 발언·귓속말
    // (여러 개)·침묵을 자유롭게 고른다 (chat-room-turns.ts). 저장할 때마다
    // messageService.append → stream:channel-message → renderer 가 1명씩
    // 차례로 표시한다.
    //
    // DM 은 1 턴 응답 (1:1 정체성 — partial unique index
    // `idx_dm_unique_per_provider` 가 channel_members.length === 1 보장).
    if (channel.kind === 'system_general' || (channel.kind === 'user' && roomMembers !== null)) {
      await this.runRound(channel, {
        messageId: source.id, kind: isChatPassMessage(source) ? 'pass' : 'message',
      }, members, roomMembers);
      return;
    }

    const member = members[0];
    if (member === undefined) return;
    // DMs always answer in plain text: no JSON contract, no silence.
    await this.callTurn({
      channel, providerId: member.providerId, roomMembers, group: false, requiresNewInput: false,
      activity: { kind: 'turn' }, hint: directMessageTurnHint(),
      consume: (raw) => {
        this.deps.messageService.append({ channelId: channel.id, meetingId: null,
          authorId: member.providerId, authorKind: 'member', role: 'assistant', content: raw });
      },
    });
  }

  /**
   * One round of a room or the general channel, bound to the stored row that
   * started it (`source.messageId`, claimed once in `chat_whisper_rounds`): a
   * user message, or the pass row the pass button stored (spec 2026-10-01 F1),
   * whose round asks each member for new content or silence.
   * Every member takes one regular turn in order; each turn runs its whisper
   * threads to the end before the next member (`chat-room-turns.ts`).
   *
   * When every member's regular turn was an explicit silence, the observer
   * gets one code-only notice (spec 2026-10-01 F3). A failed turn or a room
   * that closed during the round never produces it.
   */
  private async runRound(channel: Channel, source: ChatRoundSource, members: ReadonlyArray<{ providerId: string }>,
    roomMembers: ChatRoomMember[] | null): Promise<void> {
    const sourceMessageId = source.messageId;
    if (this.deps.roundRepository && !this.deps.roundRepository.claim(channel.id, sourceMessageId)) return;
    try {
      const outcomes: RoomTurnOutcome[] = [];
      for (const member of members) {
        if (this.isChannelClosed(channel.id)) break;
        outcomes.push(await this.roomTurns.runTurn(channel, member.providerId, roomMembers, source));
      }
      if (!this.isChannelClosed(channel.id) && outcomes.length === members.length &&
          outcomes.every((outcome) => outcome === 'silent')) {
        this.appendRoundSilence(channel.id);
      }
      if (this.isChannelClosed(channel.id)) this.deps.roundRepository?.interrupt(channel.id, sourceMessageId);
      else this.deps.roundRepository?.finish(channel.id, sourceMessageId);
    } catch (error) {
      this.deps.roundRepository?.interrupt(channel.id, sourceMessageId);
      throw error;
    }
  }

  /** Observer-only, code-only notice for a round in which everyone stayed silent. */
  private appendRoundSilence(channelId: string): void {
    try {
      this.deps.messageService.append({
        channelId, meetingId: null, authorId: 'system', authorKind: 'system', role: 'system',
        content: CHAT_ROUND_SILENCE_CODE, meta: { chatSilence: { code: CHAT_ROUND_SILENCE_CODE } },
      });
    } catch (error) {
      if (!this.isChannelClosed(channelId)) throw error;
    }
  }

  /**
   * 단일 직원의 provider 호출 1회 — provider lookup → persona → CLI 세션 또는
   * API stream → `consume` 가 출력을 검사·저장한다. 실패 시 system error
   * 알림으로 surface (silent fallback 금지). 방이 닫혀 끝나면 알림 없이
   * false. 멤버별로 독립 — 한 명 실패가 다음 멤버 응답 흐름을 막지 않는다.
   *
   * Writing indicator (spec 2026-10-01 F5): a CLI call reports `queued`
   * until the shared CLI queue starts it (`onStart` → `writing`); any other
   * call reports `writing` at once. `idle` follows in `finally` on every
   * exit path — stored output, failure notice, missing provider, timeout
   * and closed room alike.
   */
  private async callTurn(turn: ChatTurnCall): Promise<boolean> {
    this.assertChannelActive(turn.channel.id);
    const provider = this.deps.providerLookup.get(turn.providerId);
    this.reportActivity(turn, provider !== undefined && isCliProvider(provider) ? 'queued' : 'writing');
    try {
      return await this.callProvider(turn, provider);
    } finally {
      this.reportActivity(turn, 'idle');
    }
  }

  private async callProvider(turn: ChatTurnCall, provider: BaseProvider | undefined): Promise<boolean> {
    const { channel, providerId, roomMembers, group } = turn;
    if (!provider) {
      this.appendSystemError(channel.id, providerId, 'provider_unavailable');
      return false;
    }

    const controller = new AbortController();
    this.abortByRoom.set(channel.id, controller);
    // The response clock covers this turn's own provider call only. A CLI turn
    // may first wait behind other rooms on the shared CLI queue; that wait is
    // not charged (the coordinator calls onStart when the turn leaves it).
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startClock = (): void => {
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, CHAT_RESPONSE_TIMEOUT_MS);
    };
    const startWriting = (): void => {
      startClock();
      this.reportActivity(turn, 'writing');
    };
    try {
      if (
        provider.config?.type === 'cli' &&
        (!isSupportedChatCliCommand(provider.config.command) ||
          (provider instanceof CliProvider && provider.getPermissionAdapter() === null))
      ) {
        throw new Error('Unsupported chat CLI provider');
      }
      // Chat gets the provider's current character profile, built by
      // buildChatPersona — no office/tool-usage sections, chat rules only.
      const basePersona = roomMembers !== null
        ? this.deps.roomService?.getEffectivePersona(channel.id, providerId)
        : this.buildDefaultChatPersona(provider, providerId);
      if (!basePersona) throw new Error('Chat persona unavailable');
      // Runtime rules join here, never the stored snapshot (spec 2026-10-01 F4-6).
      const persona = withChatRuntimeRules(group ? roomOutputPersona(basePersona) : basePersona);
      const options = this.buildCompletionOptions(provider);
      const persist = (raw: string): void => {
        this.assertChannelActive(channel.id);
        if (!this.deps.providerLookup.get(providerId)) throw new Error('provider_unavailable');
        turn.consume(raw);
      };
      if (isCliProvider(provider)) {
        if (!this.deps.cliSessionCoordinator) throw new Error('Chat CLI session coordinator unavailable');
        const result = await this.deps.cliSessionCoordinator.respond({
          channelId: channel.id, provider, persona,
          options: options ?? {}, currentStateHint: turn.hint,
          requiresNewInput: turn.requiresNewInput,
          speakerName: (id) => this.speakerName(channel.id, id, roomMembers),
          assertActive: () => this.assertChannelActive(channel.id),
          appendReply: persist,
          signal: controller.signal,
          onStart: startWriting,
        });
        // A closed room is sorted out in the catch below; an open one gets a notice.
        if (result === null) throw new InvalidChatOutputError('empty_response');
      } else {
        const providerMessages = this.buildProviderMessages(channel.id, roomMembers, providerId);
        if (group) providerMessages.push({ role: 'system', content: turn.hint });
        provider.resetConversationContext();
        startClock();
        const fullContent = await collectChatOutput(provider.streamCompletion(
          providerMessages, persona, options, controller.signal,
        ), controller.signal);
        if (isEmptyChatOutput(fullContent)) throw new InvalidChatOutputError('empty_response');
        persist(fullContent);
      }
      return true;
    } catch (err) {
      if (this.isChannelClosed(channel.id)) return false;
      controller.abort();
      this.reportFailure(channel.id, providerId, err, { group, timedOut, action: 'generate-failed' });
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.abortByRoom.get(channel.id) === controller) this.abortByRoom.delete(channel.id);
    }
  }

  /**
   * Reports one call's phase. A closed room never gets a new `queued` or
   * `writing` (a queued CLI turn of a closed room is dropped before it
   * starts); `idle` is reported once per call, possibly early by
   * {@link endChannelActivity} when the room closes.
   */
  private reportActivity(turn: ChatTurnCall, phase: ChatActivityPhase): void {
    const channelId = turn.channel.id;
    if (phase === 'idle') {
      if (this.inFlightByRoom.get(channelId) !== turn) return;
      this.inFlightByRoom.delete(channelId);
    } else {
      if (this.isChannelClosed(channelId)) return;
      this.inFlightByRoom.set(channelId, turn);
    }
    this.emitSignal(CHAT_ACTIVITY_EVENT, {
      channelId, providerId: turn.providerId, phase, ...turn.activity,
    } satisfies StreamChatActivityPayload);
  }

  private reportRound(channelId: string, active: boolean): void {
    this.emitSignal(CHAT_ROUND_EVENT, { channelId, active } satisfies StreamChatRoundPayload);
  }

  /** Ends the writing indicator of a channel whose room just closed or paused (QA m6). */
  private endChannelActivity(channelId: string): void {
    const turn = this.inFlightByRoom.get(channelId);
    if (turn) this.reportActivity(turn, 'idle');
  }

  /** A listener failure is logged and never breaks the turn or round it reports on. */
  private emitSignal(event: string, payload: StreamChatActivityPayload | StreamChatRoundPayload): void {
    try {
      this.emit(event, payload);
    } catch (error) {
      tryGetLogger()?.error({ component: 'dm-auto-responder', action: 'signal-listener-error',
        result: 'failure', metadata: { event, channelId: payload.channelId,
          error: error instanceof Error ? error.message : String(error) } });
    }
  }

  /**
   * Logs the failure and stores its notice.
   *
   * The log entry always carries both the code and a masked, length-capped
   * cause sentence — room and DM alike — so a room failure is diagnosable
   * from the log file even though its on-screen notice stays code-only
   * (`appendSystemError` below keeps that split: only a DM `provider_error`
   * gets a masked one-line detail in the stored notice itself). Chat message
   * bodies are never part of `errMsg` — it is the thrown error's own
   * message, not any message content.
   */
  private reportFailure(channelId: string, providerId: string, error: unknown,
    context: { group: boolean; timedOut: boolean;
      action: 'generate-failed' | 'whisper-store-failed' | 'turn-start-failed' }): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    const code = chatErrorCodeFor(error, context.timedOut);
    const cause = maskSecrets(errMsg).slice(0, LOG_ERROR_CAUSE_MAX_CHARS);
    tryGetLogger()?.error({
      component: 'dm-auto-responder',
      action: context.action,
      result: 'failure',
      metadata: { channelId, providerId, code, cause },
    });
    this.appendSystemError(channelId, providerId, code,
      !context.group && code === 'provider_error' ? dmErrorDetail(errMsg) : undefined);
  }

  /**
   * General-channel / DM default persona: the member's live character
   * sheet (F3, migration 034) — not a room snapshot. Named "default" (not
   * "legacy") because the F3 rewrite replaced the old role/personality/
   * expertise + `[Legacy Persona]` combination with a single free-text
   * field; this build path is simply "no room snapshot applies here".
   */
  private buildDefaultChatPersona(provider: BaseProvider, providerId: string): string {
    const profile = this.deps.memberProfileLookup.getProfile(providerId);
    return buildChatPersona({
      displayName: provider.displayName,
      characterSheet: profile.characterSheet,
    });
  }

  private assertChannelActive(channelId: string): void {
    if (this.isChannelClosed(channelId)) {
      throw new Error(`Chat channel closed: ${channelId}`);
    }
  }

  private isChannelClosed(channelId: string): boolean {
    if (this.shuttingDown) return true;
    if (this.closedRooms.has(channelId)) return true;
    if (this.pausedRooms.has(channelId)) return true;
    if (this.deps.channelService.get && !this.deps.channelService.get(channelId)) return true;
    const room = this.deps.roomService?.get(channelId);
    return room !== undefined && room !== null && room.archivedAt !== null;
  }

  closeRoom(channelId: string): void {
    this.closedRooms.add(channelId);
    this.abortByRoom.get(channelId)?.abort();
    this.abortByRoom.delete(channelId);
    // The observer stops seeing "writing" / "waiting" now, not when a queued
    // CLI turn of this room finally reaches the front of the shared queue.
    this.endChannelActivity(channelId);
    if (this.pendingByRoom.has(channelId) && !this.roundEndedEarly.has(channelId)) {
      this.roundEndedEarly.add(channelId);
      this.reportRound(channelId, false);
    }
    // The round-repository interrupt must never block the CLI clone cleanup
    // below (D3): a stuck coordinator queue entry or leaked clone is worse
    // than an unrecorded round interrupt, and both must be attempted.
    try {
      this.deps.roundRepository?.interruptChannel(channelId);
    } catch (error) {
      tryGetLogger()?.error({ component: 'dm-auto-responder', action: 'interrupt-round',
        result: 'failure', metadata: { channelId, error: error instanceof Error ? error.message : String(error) } });
    }
    const closeTask = this.deps.cliSessionCoordinator?.closeRoom(channelId).catch((error: unknown) => {
      tryGetLogger()?.error({ component: 'dm-auto-responder', action: 'close-room',
        result: 'failure', metadata: { channelId, error: String(error) } });
    });
    if (closeTask) {
      this.closeTasks.add(closeTask);
      void closeTask.finally(() => this.closeTasks.delete(closeTask));
    }
  }

  /** Legacy general export keeps the channel row, but starts a fresh conversation. */
  async pauseRoom(channelId: string): Promise<void> {
    this.pausedRooms.add(channelId);
    this.abortByRoom.get(channelId)?.abort();
    this.endChannelActivity(channelId);
    this.deps.roundRepository?.interruptChannel(channelId);
    const pending = this.pendingByRoom.get(channelId);
    if (pending) await Promise.allSettled([pending]);
    await this.deps.cliSessionCoordinator?.closeRoom(channelId);
  }

  resumeRoom(channelId: string): void {
    this.pausedRooms.delete(channelId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const controller of this.abortByRoom.values()) controller.abort();
    this.deps.roundRepository?.interruptRunning();
    await Promise.allSettled([...this.pendingByRoom.values()]);
    await Promise.allSettled([...this.closeTasks]);
    await this.deps.cliSessionCoordinator?.shutdown();
  }

  /**
   * CLI 직원의 실행 폴더를 정한다 — R12-X T4.
   *
   * Chat CLI always runs from the bounded consensus folder, including
   * legacy DM rows that still carry a projectId. Archived project metadata
   * must never expand a chat provider's filesystem or command permissions.
   *
   * 여기서 나는 오류 (합의 폴더 미초기화) 는 호출자의
   * catch 를 타고 DM 화면의 system 메시지로 나간다 — 삼키지 않는다.
   */
  private buildCompletionOptions(
    provider: BaseProvider,
  ): CompletionOptions | undefined {
    if (!isCliProvider(provider)) return undefined;

    const cliWorkspace = consensusOnlyCliWorkspace(this.deps.consensusPath());

    return { cliWorkspace };
  }

  /**
   * Reverse-chronological history → chronological provider input. Filters
   * out `tool` rows since the provider message shape only carries
   * user/assistant. Stored system rows must never arrive here (the provider
   * viewer excludes them in SQL: observer notices and legacy pre-pivot failure
   * lines alike); one that does is refused with
   * {@link SystemRowInModelInputError}. Other rows receive model-facing speaker
   * labels without changing their stored DB content.
   */
  private buildProviderMessages(channelId: string, roomMembers: ChatRoomMember[] | null,
    providerId: string): ProviderMessage[] {
    const recent = this.deps.messageService.listByChannel(channelId, {
      limit: CHAT_HISTORY_LIMIT,
    }, { kind: 'provider', providerId });
    return recent
      .slice()
      .reverse()
      .filter((m) => m.role !== 'tool')
      .map((m) => {
        if (m.role === 'system') throw new SystemRowInModelInputError(channelId, m.id);
        const role = m.role as 'user' | 'assistant';

        const speaker = m.authorKind === 'user' ? 'User' : this.speakerName(channelId, m.authorId, roomMembers);
        const privacy = m.visibility === 'whisper' && m.whisper
          // Current names, like the speaker label (see chat-session-coordinator
          // `toProviderMessages`): a stored name can predate a rename.
          ? `[Private ${JSON.stringify(speaker)} → ${JSON.stringify(this.speakerName(channelId, m.whisper.recipientId, roomMembers))}]\n`
          : '';
        const content = `[Speaker: ${JSON.stringify(speaker)}]\n${privacy}${modelFacingBody(m)}`;
        return { role, content };
      });
  }

  /**
   * Model-facing speaker label (API history and CLI input alike): the room
   * snapshot name, else the registered name, else the participant's opaque
   * alias — never the raw provider id, which on old installs names the
   * company or CLI (`claude` / `codex` / `gemini`, spec 2026-09-29 §C).
   */
  private speakerName(channelId: string, authorId: string, roomMembers: ChatRoomMember[] | null): string {
    return roomMembers?.find((member) => member.providerId === authorId)?.displayName
      ?? this.deps.providerLookup.get(authorId)?.displayName ?? participantAlias(channelId, authorId);
  }

  /** Stores a code (never a sentence); `detail` is the DM-only masked cause. */
  private appendSystemError(
    channelId: string,
    providerId: string,
    code: ChatErrorCode,
    detail?: string,
  ): void {
    if (this.isChannelClosed(channelId)) return;
    const registered = this.deps.providerLookup.get(providerId) !== undefined;
    try {
      this.deps.messageService.append({
        channelId,
        meetingId: null,
        authorId: registered ? providerId : 'system',
        authorKind: registered ? 'member' : 'system',
        role: 'system',
        content: code,
        meta: detail ? { chatError: code, chatErrorDetail: detail } : { chatError: code },
      });
    } catch (error) {
      if (!this.isChannelClosed(channelId)) throw error;
    }
  }
}
