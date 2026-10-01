/**
 * Test-only chat runtime: real SQLite schema, message/room/channel services,
 * CLI session coordinator and responder. Only the model calls are scripted.
 */
import Database from 'better-sqlite3';
import { vi } from 'vitest';
import type { Channel } from '../../../shared/channel-types';
import type { Message } from '../../../shared/message-types';
import type { StreamChatActivityPayload, StreamChatRoundPayload } from '../../../shared/stream-events';
import type { MemberProfile } from '../../../shared/member-profile-types';
import type { BaseProvider } from '../../providers/provider-interface';
import { asAbsolutePath } from '../../../shared/absolute-path';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { insertProvider } from '../../database/__tests__/_helpers';
import { ChannelRepository } from '../channel-repository';
import { ChannelService } from '../channel-service';
import { ChatRoomRepository } from '../chat-room-repository';
import { ChatRoomService } from '../chat-room-service';
import { ChatSessionCoordinator } from '../chat-session-coordinator';
import { ChatSessionRepository } from '../chat-session-repository';
import { ChatWhisperRoundRepository } from '../chat-whisper-round-repository';
import { ChatPassService } from '../chat-pass-service';
import { CHAT_ACTIVITY_EVENT, CHAT_ROUND_EVENT, DmAutoResponder } from '../dm-auto-responder';
import { DmChannelService, type DmClosedEvent } from '../dm-channel-service';
import { MessageRepository } from '../message-repository';
import { MessageService } from '../message-service';

export interface ModelCall {
  providerId: string;
  kind: 'cli' | 'api';
  /** CLI only: `${channelId}:${providerId}`. */
  scopeKey: string | null;
  /** CLI only: the native session the call resumes. */
  resumed: string | null;
  /** CLI only: the current state hint handed to the CLI adapter. */
  hint: string | null;
  messages: Array<{ role: string; content: string }>;
  persona: string;
  signal: AbortSignal | undefined;
}

export type ModelStep = (call: ModelCall) => AsyncGenerator<string>;

export const reply = (text: string): ModelStep => async function* () { yield text; };

/** The hint a model received: CLI adapters get it directly, API calls as the last system message. */
export const hintOf = (call: ModelCall | undefined): string | null => call?.kind === 'cli'
  ? call.hint : call?.messages.filter((m) => m.role === 'system').at(-1)?.content ?? null;

const HINT_PARTICIPANTS_MARKER = 'at most once each: ';
/** The `{id, name}` list a room-turn hint offers, read the way a model reads it. */
export function hintParticipants(call: ModelCall): Array<{ id: string; name: string }> {
  const hint = hintOf(call);
  const start = hint?.indexOf(HINT_PARTICIPANTS_MARKER) ?? -1;
  if (!hint || start < 0) throw new Error(`No room-turn participant list in ${call.providerId}'s hint`);
  const list = hint.slice(start + HINT_PARTICIPANTS_MARKER.length);
  return JSON.parse(list.slice(0, list.indexOf(']. ') + 1)) as Array<{ id: string; name: string }>;
}

/**
 * Regular room turn output (2026-09-28 contract). Recipients are given by
 * provider id; like a model, the step addresses each by the alias its hint
 * lists for that participant's name (this harness names providers
 * `id.toUpperCase()`). A recipient the hint does not list fails the step.
 */
export const roomTurn = (publicText: string | null,
  whispers: Array<[recipientProviderId: string, content: string]> = []): ModelStep =>
  async function* (call) {
    const listed = whispers.length > 0 ? hintParticipants(call) : [];
    yield JSON.stringify({ public: publicText, whispers: whispers.map(([providerId, content]) => {
      const alias = listed.find((item) => item.name === providerId.toUpperCase())?.id;
      if (alias === undefined) throw new Error(`Hint for ${call.providerId} does not list ${providerId}`);
      return { recipientId: alias, content };
    }) });
  };
export const publicReply = (content: string): ModelStep => roomTurn(content);
export const whisperTo = (recipientId: string, content: string): ModelStep =>
  roomTurn(null, [[recipientId, content]]);
export const silentTurn = (): ModelStep => roomTurn(null);
/** Private reply turn output; null means the recipient chose not to reply. */
export const privateReply = (text: string | null): ModelStep => reply(JSON.stringify({ reply: text }));
export const emptyReply = (): ModelStep => async function* () { yield* []; };
export const whitespaceReply = (): ModelStep => async function* () { yield '   \n\t  '; };
export const hang = (): ModelStep => async function* () {
  await new Promise<never>(() => undefined);
  yield 'unreachable';
};
export const after = (ms: number, step: ModelStep): ModelStep => async function* (call) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  yield* step(call);
};

export interface ChatRuntime {
  db: Database.Database;
  channels: ChannelService;
  rooms: ChatRoomService;
  dms: DmChannelService;
  messages: MessageService;
  coordinator: ChatSessionCoordinator;
  responder: DmAutoResponder;
  providers: Map<string, BaseProvider>;
  calls: ModelCall[];
  /** Provider ids whose scoped CLI clone was cooled down, in order. */
  cooldowns: string[];
  observer(channelId: string): Message[];
  script(providerId: string, ...steps: ModelStep[]): void;
  createRoom(name: string, providerIds: string[]): Channel;
  /** Appends a real user row, then runs the responder for it. */
  sendUser(channel: Channel, content: string): Promise<void>;
  /** Every activity event the responder emitted (spec 2026-10-01 F5), in order. */
  activity: StreamChatActivityPayload[];
  /**
   * Activity and round events of one channel in emission order, as
   * `round:true|false` and `<providerId>:<phase>` (QA M1).
   */
  timeline(channelId: string): string[];
  /**
   * Presses the pass button (spec 2026-10-01 F1): stores the pass row through
   * the real pass service, then runs the responder for it the way the app's
   * message listener does. A rejection throws before anything is stored.
   */
  passTurn(channel: Channel): Promise<void>;
  /** Chat error codes of the system notices the observer sees, oldest first. */
  notices(channelId: string): unknown[];
  /** Observer-visible silence notices as `code:providerId`, oldest first. */
  silences(channelId: string): string[];
  publicReplies(channelId: string, providerId: string): string[];
  callsFor(providerId: string): ModelCall[];
  /**
   * Simulates an app crash and relaunch on the same database: the old
   * responder is abandoned mid-call, a fresh one takes over, and running
   * rounds are interrupted exactly as bootstrap/chat-event-bridges.ts does.
   */
  restart(): void;
  roundStatus(userMessageId: string): string | null;
  close(): void;
}

/**
 * `names` overrides a provider's display name (default: its id in upper case).
 * `roomTurn` / `whisperTo` resolve recipients by the default name, so a test
 * that renames providers writes whisper outputs with `participantAlias`.
 */
export function createChatRuntime(input: { cli?: string[]; api?: string[]; names?: Record<string, string> }): ChatRuntime {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrations);
  const scripts = new Map<string, ModelStep[]>();
  const calls: ModelCall[] = [];
  const cooldowns: string[] = [];
  const providers = new Map<string, BaseProvider>();
  const nextStep = (call: ModelCall): AsyncGenerator<string> => {
    calls.push(call);
    const step = scripts.get(call.providerId)?.shift();
    if (!step) throw new Error(`No scripted model step for ${call.providerId}`);
    return step(call);
  };
  for (const id of input.cli ?? []) {
    insertProvider(db, id);
    providers.set(id, {
      id, type: 'cli', displayName: input.names?.[id] ?? id.toUpperCase(), persona: '',
      config: { type: 'cli', command: 'codex', model: 'model-a' },
      setPermissionRequestCallback: vi.fn(), resetConversationContext: vi.fn(),
      streamCompletion: () => { throw new Error(`Unscoped CLI call for ${id}`); },
    } as unknown as BaseProvider);
  }
  for (const id of input.api ?? []) {
    insertProvider(db, id);
    providers.set(id, {
      id, type: 'api', displayName: input.names?.[id] ?? id.toUpperCase(), persona: '',
      config: { type: 'api' }, resetConversationContext: vi.fn(),
      streamCompletion: (messages: Array<{ role: string; content: string }>, persona: string,
        _options: unknown, signal?: AbortSignal) => nextStep({
        providerId: id, kind: 'api', scopeKey: null, resumed: null, hint: null,
        messages: messages.map((m) => ({ role: m.role, content: m.content })), persona, signal,
      }),
    } as unknown as BaseProvider);
  }
  const activity: StreamChatActivityPayload[] = [];
  const events: Array<{ channelId: string; step: string }> = [];
  const providerLookup = { get: (id: string) => providers.get(id) };
  const profiles = { getProfile: (providerId: string) => ({
    providerId, characterSheet: '', avatarKind: 'default',
    avatarData: null, statusOverride: null, updatedAt: 0,
  } as MemberProfile) };
  const channelRepository = new ChannelRepository(db);
  const channels = new ChannelService(channelRepository);
  const rooms = new ChatRoomService(new ChatRoomRepository(db, channelRepository),
    channelRepository, providerLookup, profiles);
  const messages = new MessageService(new MessageRepository(db), {
    assertAppendAllowed: (channelId) => rooms.assertAppendAllowed(channelId),
  });
  const buildResponder = (): { coordinator: ChatSessionCoordinator; responder: DmAutoResponder } => {
    const coordinator = new ChatSessionCoordinator(new ChatSessionRepository(db),
      asAbsolutePath('C:/chat-cli-instructions', 'chat-runtime-harness'), (source) => {
      let sessionId: string | null = null;
      return {
        streamCompletion: (messages: Array<{ role: string; content: string }>, persona: string,
          options: { chatSession: { scopeKey: string; resumeSessionId: string | null; currentStateHint: string } },
          signal?: AbortSignal) => {
          sessionId = options.chatSession.resumeSessionId ?? `session:${options.chatSession.scopeKey}`;
          return nextStep({
            providerId: source.id, kind: 'cli', scopeKey: options.chatSession.scopeKey,
            resumed: options.chatSession.resumeSessionId, hint: options.chatSession.currentStateHint,
            messages: messages.map((m) => ({ role: m.role, content: m.content })), persona, signal,
          });
        },
        getChatSessionId: () => sessionId,
        resetConversationContext: () => { sessionId = null; },
        cooldown: async () => { cooldowns.push(source.id); },
      } as never;
    });
    const roundRepository = new ChatWhisperRoundRepository(db);
    roundRepository.interruptRunning();
    const responder = new DmAutoResponder({
      channelService: channels, messageService: messages, providerLookup,
      memberProfileLookup: profiles, consensusPath: () => 'C:/chat-consensus',
      roomService: rooms, roundRepository, cliSessionCoordinator: coordinator,
    });
    responder.on(CHAT_ACTIVITY_EVENT, (event: StreamChatActivityPayload) => {
      activity.push(event);
      events.push({ channelId: event.channelId, step: `${event.providerId}:${event.phase}` });
    });
    responder.on(CHAT_ROUND_EVENT, (event: StreamChatRoundPayload) => {
      events.push({ channelId: event.channelId, step: `round:${String(event.active)}` });
    });
    return { coordinator, responder };
  };
  let current = buildResponder();
  // Same close wiring as bootstrap/chat-event-bridges.ts.
  rooms.on('closed', ({ channelId }: { channelId: string }) => current.responder.closeRoom(channelId));
  const dms = new DmChannelService(channels);
  dms.on('closed', ({ channelId }: DmClosedEvent) => current.responder.closeRoom(channelId));
  const observer = (channelId: string): Message[] =>
    messages.listByChannel(channelId, { limit: 200 }, { kind: 'observer' }).reverse();

  const passes = new ChatPassService({
    channels, rooms, messages,
    rounds: { hasActiveRound: (channelId) => current.responder.hasActiveRound(channelId) },
  });

  return {
    db, channels, rooms, dms, messages, providers, calls, cooldowns, observer, activity,
    timeline: (channelId: string) => events.filter((event) => event.channelId === channelId).map((event) => event.step),
    passTurn(channel: Channel): Promise<void> {
      const message = passes.pass(channel.id);
      return current.responder.handle(message, channel);
    },
    get coordinator() { return current.coordinator; },
    get responder() { return current.responder; },
    restart(): void { current = buildResponder(); },
    roundStatus(userMessageId: string): string | null {
      const row = db.prepare('SELECT status FROM chat_whisper_rounds WHERE user_message_id = ?')
        .get(userMessageId) as { status: string } | undefined;
      return row?.status ?? null;
    },
    script(providerId: string, ...steps: ModelStep[]): void {
      scripts.set(providerId, [...(scripts.get(providerId) ?? []), ...steps]);
    },
    createRoom(name: string, providerIds: string[]): Channel {
      return rooms.create({ name, participants: providerIds.map((providerId) => ({
        providerId, personaSource: 'default' as const })) });
    },
    sendUser(channel: Channel, content: string): Promise<void> {
      const message = messages.append({ channelId: channel.id, meetingId: null,
        authorId: 'user', authorKind: 'user', role: 'user', content });
      return current.responder.handle(message, channel);
    },
    notices(channelId: string): unknown[] {
      return observer(channelId).filter((m) => m.role === 'system' && m.meta?.chatError !== undefined)
        .map((m) => m.meta?.chatError);
    },
    silences(channelId: string): string[] {
      return observer(channelId).filter((m) => m.role === 'system' && m.meta?.chatSilence !== undefined)
        .map((m) => `${m.meta?.chatSilence?.code}:${m.authorId}`);
    },
    publicReplies(channelId: string, providerId: string): string[] {
      return observer(channelId).filter((m) => m.authorId === providerId &&
        m.role === 'assistant' && m.visibility === 'public').map((m) => m.content);
    },
    callsFor(providerId: string): ModelCall[] { return calls.filter((call) => call.providerId === providerId); },
    close(): void { db.close(); },
  };
}
