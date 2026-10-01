/**
 * Spec 2026-09-29 §C: once the user has renamed the AIs, no model input tells
 * one AI which company, model or CLI another participant is. Old installs
 * registered providers as `claude` / `codex` / `gemini`, so this room uses
 * exactly those ids with neutral display names and checks every model-facing
 * surface: API history, the CLI first and delta inputs as the CLI adapter
 * builds them, turn and private-reply hints, personas and the vote context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asAbsolutePath } from '../../../shared/absolute-path';
import type { Message as ProviderMessage } from '../../../shared/provider-types';
import { insertProvider } from '../../database/__tests__/_helpers';
import { ChatVoteRepository } from '../../meetings/chat-vote-repository';
import { ChatVoteService } from '../../meetings/chat-vote-service';
import { OpinionRepository } from '../../meetings/opinion-repository';
import { CliPromptBuilder } from '../../providers/cli/cli-prompt-builder';
import type { BaseProvider } from '../../providers/provider-interface';
import { participantAlias } from '../participant-alias';
import {
  createChatRuntime, privateReply, publicReply, reply, type ChatRuntime, type ModelCall,
} from './chat-runtime-harness';

/** Anything naming a provider id, company, model or CLI command. */
const IDENTITY = /claude|codex|gemini|anthropic|openai|model-a|\.exe\b|\.cmd\b/i;
const INSTRUCTIONS_DIR = asAbsolutePath('C:/app-data/chat-cli-instructions', 'identity test');

let runtime: ChatRuntime | null = null;
afterEach(() => {
  runtime?.close();
  runtime = null;
});

function renamedRoom(): { rt: ChatRuntime; roomId: string; room: ReturnType<ChatRuntime['createRoom']> } {
  const rt = runtime = createChatRuntime({ cli: ['claude'], api: ['codex'], names: { claude: '루나', codex: '해랑' } });
  insertProvider(rt.db, 'gemini');
  const room = rt.createRoom('Room', ['claude', 'codex']);
  return { rt, roomId: room.id, room };
}

/** The exact text a CLI adapter would send for this call (first input or delta). */
function cliInputs(call: ModelCall): string[] {
  const builder = new CliPromptBuilder();
  const chatSession = { scopeKey: call.scopeKey ?? '', resumeSessionId: call.resumed,
    currentStateHint: call.hint ?? '', instructionsDir: INSTRUCTIONS_DIR };
  const messages = call.messages as ProviderMessage[];
  return [
    builder.buildPersistentJsonPayload(messages, '', call.resumed, chatSession),
    builder.buildStdinPayload(messages, '', { chatSession },
      { command: 'x', args: [], inputFormat: 'pipe', outputFormat: 'jsonl', sessionStrategy: 'per-turn',
        hangTimeout: { first: 1, subsequent: 1 } }, call.resumed),
  ];
}

describe('AI identity hiding (spec 2026-09-29 §C)', () => {
  it('keeps provider ids, kinds, model names and legacy failure text out of every model input', async () => {
    const { rt, roomId, room } = renamedRoom();
    // Pre-pivot rows: a failure line with a command path and model name, a
    // meeting notice with the old registration name, and a reply from a
    // provider that is no longer registered.
    rt.messages.append({ channelId: roomId, meetingId: null, authorId: 'claude', authorKind: 'member',
      role: 'system', content: '응답 실패: spawn C:\\Users\\me\\.local\\bin\\claude.exe ENOENT (claude-opus-4)' });
    rt.messages.append({ channelId: roomId, meetingId: null, authorId: 'codex', authorKind: 'system',
      role: 'system', content: 'meeting.turnSkipped|Codex CLI|offline-connection' });
    rt.messages.append({ channelId: roomId, meetingId: null, authorId: 'gemini', authorKind: 'member',
      role: 'assistant', content: 'an old reply' });
    // A whisper stored before the user renamed the AIs keeps the old default
    // names for the observer; models must see the current names instead.
    const oldUser = rt.messages.append({ channelId: roomId, meetingId: null, authorId: 'user',
      authorKind: 'user', role: 'user', content: 'earlier question' });
    rt.messages.appendWhisper({ channelId: roomId, authorId: 'claude', recipientId: 'codex',
      content: 'old secret', senderName: 'Claude Code', recipientName: 'Codex CLI',
      sourceMessageId: oldUser.id, replyToMessageId: null });

    const codexAlias = participantAlias(roomId, 'codex');
    rt.script('claude', reply(JSON.stringify({ public: 'hello', whispers: [{ recipientId: codexAlias, content: 'psst' }] })),
      privateReply(null), publicReply('luna again'));
    rt.script('codex', privateReply('got it'), publicReply('haerang public'), publicReply('haerang again'));

    await rt.sendUser(room, 'hi all');
    await rt.sendUser(room, 'again');

    // The whisper addressed by alias is stored to the right provider; the
    // observer still sees the old whisper's stored names.
    const whispers = rt.observer(roomId).filter((m) => m.visibility === 'whisper');
    expect(whispers.map((m) => [m.authorId, m.whisper?.recipientId, m.whisper?.senderName,
      m.whisper?.recipientName, m.content])).toEqual([
      ['claude', 'codex', 'Claude Code', 'Codex CLI', 'old secret'],
      ['claude', 'codex', '루나', '해랑', 'psst'], ['codex', 'claude', '해랑', '루나', 'got it'],
    ]);
    expect(rt.notices(roomId)).toEqual([]);

    const [claudeFirst, claudeThreadReply, claudeDelta] = rt.callsFor('claude');
    expect(claudeFirst?.kind).toBe('cli');
    expect(claudeDelta?.resumed).not.toBeNull();
    expect(claudeFirst?.hint).toContain(JSON.stringify([{ id: codexAlias, name: '해랑' }]));
    expect(claudeFirst?.messages.map((m) => m.content).join('\n'))
      .toContain(`[Speaker: ${JSON.stringify(participantAlias(roomId, 'gemini'))}]`);
    const codexCalls = rt.callsFor('codex');
    expect(codexCalls.map((call) => call.kind)).toEqual(['api', 'api', 'api']);
    for (const call of [claudeFirst, codexCalls[0]]) {
      expect(call?.messages.map((m) => m.content).join('\n')).toContain('[Private "루나" → "해랑"]\nold secret');
    }

    for (const call of rt.calls) {
      const modelFacing = JSON.stringify({ messages: call.messages, persona: call.persona, hint: call.hint });
      expect(modelFacing).not.toMatch(IDENTITY);
      expect(modelFacing).not.toContain('ENOENT');
      expect(modelFacing).not.toContain('turnSkipped');
    }
    for (const call of [claudeFirst, claudeThreadReply, claudeDelta]) {
      for (const input of cliInputs(call!)) expect(input).not.toMatch(IDENTITY);
    }

    // Vote context and personas, through the real vote service.
    const voteCalls: Array<{ messages: ProviderMessage[]; persona: string }> = [];
    rt.db.prepare(`INSERT INTO opinion(id,meeting_id,channel_id,kind,author_label,title,content,status,round,created_at,updated_at)
      VALUES ('op',NULL,?,'user-raised','user_1','Proposal','Body','pending',0,1,1)`).run(roomId);
    const votes = new ChatVoteService(new ChatVoteRepository(rt.db), new OpinionRepository(rt.db),
      rt.rooms, rt.messages, { get: (id: string) => rt.providers.get(id) },
      (_provider: BaseProvider) => ({
        async *streamCompletion(messages: ProviderMessage[], persona: string) {
          voteCalls.push({ messages, persona });
          yield '{"opinion":"fine","vote":"agree"}';
        },
        cooldown: vi.fn(async () => undefined),
      }) as never, () => 'C:/chat-consensus', INSTRUCTIONS_DIR);
    votes.startVote('op');
    await vi.waitFor(() => expect(votes.getVote('op')?.status).toBe('completed'));
    expect(voteCalls).toHaveLength(2);
    const voteContext = JSON.stringify(voteCalls);
    expect(voteContext).toContain('haerang public');
    expect(voteContext).toContain(participantAlias(roomId, 'gemini'));
    expect(voteContext).not.toMatch(IDENTITY);
    expect(voteContext).not.toContain('ENOENT');
  });

  it('rejects an unknown alias or a raw provider id as invalid output and stores no whisper', async () => {
    const { rt, roomId, room } = renamedRoom();
    rt.script('claude',
      reply(JSON.stringify({ public: null, whispers: [{ recipientId: 'p-000000000000', content: 'lost' }] })),
      reply(JSON.stringify({ public: null, whispers: [{ recipientId: 'codex', content: 'raw id' }] })));
    rt.script('codex', publicReply('one'), publicReply('two'));

    await rt.sendUser(room, 'first');
    await rt.sendUser(room, 'second');

    expect(rt.observer(roomId).filter((m) => m.visibility === 'whisper')).toEqual([]);
    expect(rt.notices(roomId)).toEqual(['invalid_response', 'invalid_response']);
  });
});
