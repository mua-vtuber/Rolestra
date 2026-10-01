import { createHash } from 'node:crypto';
import type { AbsolutePath } from '../../shared/absolute-path';
import type { Message as ChannelMessage } from '../../shared/message-types';
import type { CompletionOptions, Message as ProviderMessage } from '../../shared/provider-types';
import type { BaseProvider } from '../providers/provider-interface';
import { ChatCliSessionMissingError, CliProvider } from '../providers/cli/cli-provider';
import { createProvider } from '../providers/factory';
import { CHAT_HISTORY_LIMIT } from './chat-limits';
import { ChatSessionRepository, type VisibleMessageSlice } from './chat-session-repository';
import { collectChatOutput, isEmptyChatOutput, modelFacingBody } from './chat-whisper-output';
import { SystemRowInModelInputError } from './message-visibility';

const MAX_IDLE_CLI_SESSIONS = 8;
// W11: the real version marker of the room output contract is the
// `roomOutputPersona` text, not this string. If the contract changes while
// the persona text stays the same, bump this value.
// v2 (spec 2026-09-29 §B2/§C): the persona moved from the first input into
// the CLI system prompt file, and participants are addressed by opaque alias.
// A resumed v1 session would keep the CLI's recorded coding prompt and the
// raw provider ids it already saw, so every v1 session is rebuilt once.
const PROMPT_SCHEMA = 'room-whisper-json-v2';
// v2: stored system rows (legacy failure lines included) left model input.
const VISIBILITY_SCHEMA = 'room-provider-v2';

type ScopedCliProvider = Pick<CliProvider,
  'streamCompletion' | 'getChatSessionId' | 'resetConversationContext' | 'cooldown'>;

export interface ChatSessionTurn {
  channelId: string;
  provider: BaseProvider;
  persona: string;
  options: CompletionOptions;
  currentStateHint: string;
  /**
   * True for a private reply: it answers the new root whisper and is skipped
   * when nothing unseen is visible. A regular turn resumes a live session with
   * the current state hint alone instead of being skipped.
   */
  requiresNewInput: boolean;
  speakerName(authorId: string): string;
  assertActive(): void;
  /** Validates and stores the output; throwing keeps the checkpoint unsaved. */
  appendReply(content: string): void;
  signal?: AbortSignal;
  /** Called once when the turn leaves the shared CLI queue and starts running. */
  onStart(): void;
}

/**
 * Whisper labels name both sides the same way as the speaker label, not by
 * the names stored with the row: a stored name can predate a rename (e.g. the
 * default "Claude Code") and would tell a model what the participant runs on
 * (spec 2026-09-29 §C). The observer UI keeps showing the stored names.
 * Stored system rows are excluded by the viewer SQL; one that still arrives
 * is refused, never passed to the CLI. A pass row reads as the pass line
 * (`modelFacingBody`, spec 2026-10-01 F1-4).
 */
function toProviderMessages(messages: ChannelMessage[], speakerName: (id: string) => string): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === 'system') throw new SystemRowInModelInputError(message.channelId, message.id);
    const speaker = message.authorKind === 'user' ? 'User' : speakerName(message.authorId);
    const privacy = message.visibility === 'whisper' && message.whisper
      ? `[Private ${JSON.stringify(speaker)} → ${JSON.stringify(speakerName(message.whisper.recipientId))}]\n`
      : '';
    return { role: message.role as 'user' | 'assistant',
      content: `[Speaker: ${JSON.stringify(speaker)}]\n${privacy}${modelFacingBody(message)}` };
  });
}

/** Room-scoped CLI clones and crash-safe durable continuation checkpoints. */
export class ChatSessionCoordinator {
  private readonly clones = new Map<string, ScopedCliProvider>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: ChatSessionRepository,
    /** Where each clone keeps its persona file (`files/chat-cli-instructions.ts`). */
    private readonly instructionsDir: AbsolutePath,
    private readonly createClone: (source: BaseProvider) => ScopedCliProvider = (source) => {
      if (source.config.type !== 'cli') throw new Error('Scoped chat requires a CLI provider');
      // F3 (QA defect 1): no `persona` passed — the clone's own
      // `this.persona` is never read by streamCompletion; the actual
      // persona text always arrives as the `persona` PARAMETER on each
      // `respond()` call (see toProviderMessages / respondNow below).
      const clone = createProvider({
        id: source.id, displayName: source.displayName,
        config: source.config,
      });
      if (!(clone instanceof CliProvider)) throw new Error('CLI factory returned a non-CLI provider');
      return clone;
    },
  ) {}

  /**
   * Serializes CLI turns, including turns in different rooms sharing one
   * connection: evicting an idle clone must never stop a clone mid-response.
   * Null means the turn produced no content (or was cancelled while queued);
   * the caller decides whether that is a closed room or a failure to report.
   */
  respond(input: ChatSessionTurn): Promise<string | null> {
    const result = this.queue.then(() => this.respondNow(input));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async respondNow(input: ChatSessionTurn): Promise<string | null> {
    input.assertActive();
    if (input.signal?.aborted) return null;
    input.onStart();
    const { channelId, provider, persona } = input;
    const providerId = provider.id;
    const fingerprint = createHash('sha256').update(JSON.stringify({
      persona, config: provider.config, promptSchema: PROMPT_SCHEMA, visibility: VISIBILITY_SCHEMA,
    })).digest('hex');
    const checkpoint = this.repository.load(channelId, providerId);
    let sessionId = checkpoint?.contextFingerprint === fingerprint ? checkpoint.sessionId : null;
    let slice: VisibleMessageSlice | null = sessionId && checkpoint?.lastMessageId
      ? this.repository.listVisibleAfter(channelId, providerId, checkpoint.lastMessageId)
      : null;
    if (slice === null) {
      sessionId = null;
      slice = this.repository.listVisibleRecent(channelId, providerId, CHAT_HISTORY_LIMIT);
    }
    // Nothing unseen: a live session still takes a regular turn from the hint
    // alone (already delivered messages are never re-sent).
    if (slice.messages.length === 0 && (sessionId === null || input.requiresNewInput)) return null;
    // A crash or cancellation cannot leave a durable session pointing past the app transcript.
    this.repository.invalidate(channelId, providerId);
    const clone = await this.getClone(channelId, provider, fingerprint);
    let content = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      content = '';
      try {
        const messages = toProviderMessages(slice.messages, input.speakerName);
        // The persistent CLI adapter uses the hint on resume. Fresh/recovered
        // sessions need it as a current instruction too; persona stays stable.
        if (sessionId === null) messages.push({ role: 'system', content: input.currentStateHint });
        content = await collectChatOutput(clone.streamCompletion(messages, persona, {
          ...input.options,
          chatSession: {
            scopeKey: `${channelId}:${providerId}`,
            resumeSessionId: sessionId,
            currentStateHint: input.currentStateHint,
            instructionsDir: this.instructionsDir,
          },
        }, input.signal), input.signal, (chunk) => { content += chunk; });
        break;
      } catch (error) {
        if (!(error instanceof ChatCliSessionMissingError) || attempt !== 0 || sessionId === null || content.length > 0) {
          throw error;
        }
        // A native session was pruned. Rebuild once from the visible app transcript.
        clone.resetConversationContext();
        sessionId = null;
        slice = this.repository.listVisibleRecent(channelId, providerId, CHAT_HISTORY_LIMIT);
        if (slice.messages.length === 0) return null;
      }
    }
    if (isEmptyChatOutput(content) || input.signal?.aborted) return null;
    input.assertActive();
    input.appendReply(content);
    const newSessionId = clone.getChatSessionId();
    if (newSessionId && slice.lastInputMessageId) {
      this.repository.save({ channelId, providerId, sessionId: newSessionId,
        contextFingerprint: fingerprint, lastMessageId: slice.lastInputMessageId });
    }
    return content;
  }

  private async getClone(channelId: string, source: BaseProvider, fingerprint: string): Promise<ScopedCliProvider> {
    const prefix = `${channelId}:${source.id}:`;
    const key = `${prefix}${fingerprint}`;
    const cached = this.clones.get(key);
    if (cached) {
      this.clones.delete(key);
      this.clones.set(key, cached);
      return cached;
    }
    for (const [oldKey, oldClone] of this.clones) {
      if (oldKey.startsWith(prefix)) {
        this.clones.delete(oldKey);
        await oldClone.cooldown();
      }
    }
    if (this.clones.size >= MAX_IDLE_CLI_SESSIONS) {
      const oldest = this.clones.entries().next().value as [string, ScopedCliProvider] | undefined;
      if (oldest) {
        this.clones.delete(oldest[0]);
        await oldest[1].cooldown();
      }
    }
    const clone = this.createClone(source);
    this.clones.set(key, clone);
    return clone;
  }

  async closeRoom(channelId: string): Promise<void> {
    this.repository.invalidateRoom(channelId);
    await this.queue;
    for (const [key, clone] of this.clones) {
      if (key.startsWith(`${channelId}:`)) {
        this.clones.delete(key);
        await clone.cooldown();
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.queue;
    await Promise.allSettled([...this.clones.values()].map((clone) => clone.cooldown()));
    this.clones.clear();
  }
}
