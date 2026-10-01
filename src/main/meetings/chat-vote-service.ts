import { randomUUID } from 'node:crypto';
import type { AbsolutePath } from '../../shared/absolute-path';
import type { ChatVote, ChatVoteError, ChatVoteValue } from '../../shared/chat-vote-types';
import type { Message as ProviderMessage } from '../../shared/provider-types';
import type { Message, MessageViewer } from '../../shared/message-types';
import type { BaseProvider } from '../providers/provider-interface';
import type { OpinionRepository } from './opinion-repository';
import { ChatVoteRepository, type VoteParticipantSnapshot } from './chat-vote-repository';
import { consensusOnlyCliWorkspace } from '../providers/cli/cli-workspace';
import { tryGetLogger } from '../log/logger-accessor';
import { maskSecrets } from '../log/mask-secrets';
import {
  CHAT_HISTORY_LIMIT, CHAT_RESPONSE_MAX_BYTES, CHAT_RESPONSE_TIMEOUT_MS, LOG_ERROR_CAUSE_MAX_CHARS,
} from '../channels/chat-limits';
import { modelFacingBody, unwrapSingleJsonFence } from '../channels/chat-whisper-output';
import { withChatRuntimeRules } from '../members/persona-builder';
import { participantAlias } from '../channels/participant-alias';
import { SystemRowInModelInputError } from '../channels/message-visibility';

type VoteProvider = Pick<BaseProvider, 'streamCompletion' | 'cooldown'>;

export interface ChatVoteRoomLookup {
  get(channelId: string): { archivedAt: number | null } | null;
  listMembers(channelId: string): Array<{
    providerId: string; displayName: string; effectivePersona: string; sortOrder: number;
  }>;
}
export interface ChatVoteMessageLookup {
  listByChannel(channelId: string, options: { limit: number }, viewer?: MessageViewer): Array<
    Pick<Message, 'role' | 'content' | 'authorKind' | 'authorId' | 'meta'>
  >;
}
export interface ChatVoteProviderLookup {
  get(id: string): BaseProvider | undefined;
  listInstances?(): BaseProvider[];
}
export type IsolatedVoteProviderFactory = (provider: BaseProvider) => VoteProvider;

/** W9: the same single-code-fence tolerance as the room-turn and private-reply parsers. */
function parseResponse(raw: string): { opinion: string; vote: ChatVoteValue } | null {
  let value: unknown;
  try { value = JSON.parse(unwrapSingleJsonFence(raw)); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'opinion') || !Object.hasOwn(record, 'vote')) return null;
  if (typeof record.opinion !== 'string' || !record.opinion.trim() || record.opinion.length > 100_000) return null;
  if (record.vote !== 'agree' && record.vote !== 'oppose' && record.vote !== 'abstain') return null;
  return { opinion: record.opinion.trim(), vote: record.vote };
}

export class ChatVoteService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Set<Promise<void>>();
  private shuttingDown = false;
  constructor(
    private readonly repo: ChatVoteRepository,
    private readonly opinions: OpinionRepository,
    private readonly rooms: ChatVoteRoomLookup,
    private readonly messages: ChatVoteMessageLookup,
    private readonly providers: ChatVoteProviderLookup,
    private readonly createIsolatedProvider: IsolatedVoteProviderFactory,
    private readonly consensusPath: () => string,
    /** Persona files for CLI vote calls (`files/chat-cli-instructions.ts`). */
    private readonly chatCliInstructionsDir: AbsolutePath,
    private readonly isGlobalGeneral: (channelId: string) => boolean = () => false,
    // F3 STEP 3b: BaseProvider no longer carries an in-memory legacy
    // persona (see factory.ts's CreateProviderOptions doc) — production
    // wiring (chat-services.ts) always passes an explicit characterSheet-
    // based callback, so this default only ever fires for a caller
    // (a test) that omits the argument entirely; '' is the honest answer
    // for "no persona source was supplied", not a fabricated placeholder.
    private readonly globalPersona: (provider: BaseProvider) => string = () => '',
    private readonly timeoutMs = CHAT_RESPONSE_TIMEOUT_MS,
  ) {
    // An unfinished persisted run cannot be resumed: it has no live model call.
    this.repo.interruptRunning();
  }

  getVote(opinionId: string): ChatVote | null { return this.repo.getByOpinion(opinionId); }

  startVote(opinionId: string): ChatVote {
    if (this.shuttingDown) throw new Error('Chat vote service is shutting down');
    const opinion = this.opinions.get(opinionId);
    if (!opinion || opinion.meetingId !== null ||
        (opinion.kind !== 'self-raised' && opinion.kind !== 'user-raised')) {
      throw new Error(`Chat opinion not found: ${opinionId}`);
    }
    const room = this.rooms.get(opinion.channelId);
    if (room?.archivedAt != null) throw new Error(`Chat room archived: ${opinion.channelId}`);
    if (!room && !this.isGlobalGeneral(opinion.channelId)) {
      throw new Error(`Chat room not found: ${opinion.channelId}`);
    }
    const existing = this.getVote(opinionId);
    if (existing) return existing;
    const snapshots: VoteParticipantSnapshot[] = room
      ? this.rooms.listMembers(opinion.channelId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({ providerId: item.providerId,
          displayName: item.displayName, persona: item.effectivePersona }))
      : (this.providers.listInstances?.() ?? []).map((item) => ({
          providerId: item.id, displayName: item.displayName, persona: this.globalPersona(item),
        }));
    if (!snapshots.length) throw new Error('Chat vote requires at least one participant');
    // Capture the same public context before any participant can submit a vote.
    // The public viewer already leaves out stored system rows (observer notices
    // and legacy failure lines); one that still arrives is refused, never sent.
    // A speaker without a snapshot name is labelled by its opaque alias, never
    // its provider id (spec 2026-09-29 §C).
    const history = this.messages.listByChannel(opinion.channelId, { limit: CHAT_HISTORY_LIMIT }, { kind: 'public' })
      .slice().reverse().filter((item) => item.role !== 'tool')
      .map((item): ProviderMessage => {
        if (item.role === 'system') throw new SystemRowInModelInputError(opinion.channelId, null);
        return {
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: `[Speaker: ${JSON.stringify(item.authorKind === 'user' ? 'User' :
            snapshots.find((part) => part.providerId === item.authorId)?.displayName
              ?? participantAlias(opinion.channelId, item.authorId))}]\n${modelFacingBody(item)}`,
        };
      });
    const prompt: ProviderMessage = { role: 'user', content:
      `Proposal: ${opinion.title ?? ''}\n${opinion.content ?? ''}\n` +
      'Respond with only JSON {"opinion":"non-empty opinion","vote":"agree|oppose|abstain"}. ' +
      'No other fields or text.' };
    const voteId = randomUUID();
    try { this.repo.insert(voteId, opinionId, opinion.channelId, snapshots); }
    catch (error) {
      // A second click may race with the first insert; return the persisted row.
      const raced = this.getVote(opinionId);
      if (raced) return raced;
      throw error;
    }
    const vote = this.getVote(opinionId);
    if (!vote) throw new Error(`Chat vote missing after insert: ${voteId}`);
    queueMicrotask(() => {
      if (this.shuttingDown) return;
      const run = this.run(voteId, opinion.channelId, snapshots, [...history, prompt]);
      this.runs.add(run);
      void run.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const logger = tryGetLogger();
        if (logger) {
          logger.error({
            component: 'chat-vote',
            action: 'runner-failed',
            result: 'failure',
            metadata: { channelId: opinion.channelId, cause: maskSecrets(message).slice(0, LOG_ERROR_CAUSE_MAX_CHARS) },
          });
        } else {
          console.error('[chat-vote] runner failed', error);
        }
        this.repo.interruptChannel(opinion.channelId);
      }).finally(() => this.runs.delete(run));
    });
    return vote;
  }

  interruptChannel(channelId: string): void {
    this.repo.interruptChannel(channelId);
    for (const [key, controller] of this.controllers) {
      if (key.startsWith(`${channelId}:`)) controller.abort();
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.repo.interruptRunning();
    await Promise.allSettled([...this.runs]);
  }

  private async run(voteId: string, channelId: string, snapshots: VoteParticipantSnapshot[], messages: ProviderMessage[]): Promise<void> {
    for (const part of snapshots) {
      const current = this.repo.getByOpinionForId(voteId);
      if (!current || current.status !== 'running') return;
      const provider = this.providers.get(part.providerId);
      if (!provider) {
        this.repo.settleParticipant(voteId, part.providerId, { status: 'failed', opinion: null, vote: null, error: 'provider_unavailable' });
        continue;
      }
      const controller = new AbortController();
      const key = `${channelId}:${voteId}:${part.providerId}`;
      this.controllers.set(key, controller);
      let isolated: VoteProvider | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let oversized = false;
      let onAbort: (() => void) | undefined;
      try {
        isolated = this.createIsolatedProvider(provider);
        const voteProvider = isolated;
        const work = async () => {
          let raw = '';
          const options = provider.type === 'cli'
            ? { cliWorkspace: consensusOnlyCliWorkspace(this.consensusPath()),
                chatSession: { scopeKey: `vote:${voteId}:${part.providerId}`, resumeSessionId: null,
                  currentStateHint: '', instructionsDir: this.chatCliInstructionsDir } }
            : undefined;
          // Runtime rules join the stored snapshot persona here (spec 2026-10-01 F4-6).
          const persona = withChatRuntimeRules(part.persona);
          for await (const chunk of voteProvider.streamCompletion(messages, persona, options, controller.signal)) {
            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') > CHAT_RESPONSE_MAX_BYTES) {
              oversized = true;
              controller.abort(); throw new Error('Vote response too large');
            }
          }
          return raw;
        };
        const raw = await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Vote timeout')); }, this.timeoutMs);
        }), new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Vote interrupted'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
        })]);
        const parsed = parseResponse(raw);
        this.repo.settleParticipant(voteId, part.providerId,
          !this.providers.get(part.providerId)
            ? { status: 'failed', opinion: null, vote: null, error: 'provider_unavailable' }
            : parsed
              ? { status: 'submitted', opinion: parsed.opinion, vote: parsed.vote, error: null }
              : { status: 'failed', opinion: null, vote: null, error: 'invalid_response' });
      } catch {
        const code: ChatVoteError = !this.providers.get(part.providerId)
          ? 'provider_unavailable' : timedOut
          ? 'timeout' : oversized ? 'invalid_response'
            : controller.signal.aborted ? 'interrupted' : 'provider_error';
        this.repo.settleParticipant(voteId, part.providerId, {
          status: 'failed', opinion: null, vote: null, error: code,
        });
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        this.controllers.delete(key);
        if (isolated) await isolated.cooldown().catch(() => undefined);
      }
    }
    this.repo.complete(voteId);
  }
}
