import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message as ChannelMessage } from '../../../shared/message-types';
import { asAbsolutePath } from '../../../shared/absolute-path';
import type { BaseProvider } from '../../providers/provider-interface';
import { ChatCliSessionMissingError } from '../../providers/cli/cli-provider';
import { CliPromptBuilder } from '../../providers/cli/cli-prompt-builder';
import { ChatSessionRepository } from '../chat-session-repository';
import { ChatSessionCoordinator } from '../chat-session-coordinator';
import { SystemRowInModelInputError } from '../message-visibility';
import { directMessageTurnHint } from '../chat-whisper-output';

const INSTRUCTIONS_DIR = asAbsolutePath('C:/app-data/chat-cli-instructions', 'coordinator test');

describe('ChatSessionCoordinator', () => {
  let db: Database.Database;
  let repo: ChatSessionRepository;
  let sid: string | null;
  let calls: Array<{ messages: string[]; resumed: string | null; hint: string; instructionsDir: string }>;
  let clone: {
    streamCompletion: ReturnType<typeof vi.fn>;
    getChatSessionId: () => string | null;
    resetConversationContext: ReturnType<typeof vi.fn>;
    cooldown: ReturnType<typeof vi.fn>;
  };
  let coordinator: ChatSessionCoordinator;
  let createClone = vi.fn((_source: BaseProvider) => clone as never);
  const provider = {
    id: 'alice', type: 'cli', displayName: 'Alice', persona: '',
    config: { type: 'cli', command: 'codex', model: 'model-a' },
  } as unknown as BaseProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
      meeting_id TEXT, author_id TEXT NOT NULL, author_kind TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, meta_json TEXT, created_at INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public', whisper_recipient_id TEXT,
      whisper_sender_name TEXT, whisper_recipient_name TEXT,
      whisper_source_message_id TEXT, whisper_reply_to_message_id TEXT);
      CREATE TABLE cli_chat_sessions (channel_id TEXT NOT NULL, provider_id TEXT NOT NULL,
      session_id TEXT NOT NULL, context_fingerprint TEXT NOT NULL,
      last_message_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(channel_id,provider_id));`);
    repo = new ChatSessionRepository(db);
    sid = null;
    calls = [];
    clone = {
      streamCompletion: vi.fn(async function* (messages: Array<{ content: string }>, _persona: string,
        options: { chatSession: { resumeSessionId: string | null; currentStateHint: string; instructionsDir: string } }) {
        calls.push({ messages: messages.map((m) => m.content), resumed: options.chatSession.resumeSessionId,
          hint: options.chatSession.currentStateHint, instructionsDir: options.chatSession.instructionsDir });
        sid = 'session-a';
        yield 'reply';
      }),
      getChatSessionId: () => sid,
      resetConversationContext: vi.fn(() => { sid = null; }),
      cooldown: vi.fn(async () => undefined),
    };
    createClone = vi.fn((_source: BaseProvider) => clone as never);
    coordinator = new ChatSessionCoordinator(repo, INSTRUCTIONS_DIR, createClone);
  });
  afterEach(() => db.close());

  it('refuses a stored system row that reaches CLI input instead of passing it to the CLI', async () => {
    // The repository SQL excludes stored system rows; a stub stands in for that
    // filter regressing with a legacy failure line (spec 2026-09-29 §C).
    const legacy = { ...insert('legacy', 'room-a', 'alice', 'system'), content: '응답 실패: claude.exe ENOENT' };
    const leaking = {
      load: () => null, invalidate: () => undefined, save: () => undefined,
      listVisibleAfter: () => null,
      listVisibleRecent: () => ({ messages: [legacy], lastInputMessageId: legacy.id }),
    } as unknown as ChatSessionRepository;
    const leakingCoordinator = new ChatSessionCoordinator(leaking, INSTRUCTIONS_DIR, createClone);
    await expect(leakingCoordinator.respond(turn('room-a'))).rejects.toThrow(SystemRowInModelInputError);
    expect(clone.streamCompletion).not.toHaveBeenCalled();
  });

  it('hands every scoped CLI call the app-managed instructions folder (B2)', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    insert('next-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    expect(calls.map((call) => call.instructionsDir)).toEqual([INSTRUCTIONS_DIR, INSTRUCTIONS_DIR]);
  });

  function insert(id: string, room: string, authorId: string, role: string): ChannelMessage {
    const message: ChannelMessage = {
      id, channelId: room, meetingId: null, authorId,
      authorKind: authorId === 'user' ? 'user' : 'member',
      role: role as ChannelMessage['role'], content: id, meta: null, createdAt: 1,
    };
    db.prepare(`INSERT INTO messages (id, channel_id, meeting_id, author_id,
      author_kind, role, content, meta_json, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 1)`)
      .run(id, room, authorId, message.authorKind, role, id);
    return message;
  }

  function turn(room: string, hint = 'Continue this room.', requiresNewInput = false) {
    return {
      channelId: room, provider, persona: 'Frozen Alice', options: {},
      currentStateHint: hint, requiresNewInput, speakerName: (id: string) => id,
      assertActive: () => undefined, onStart: vi.fn(),
      appendReply: (content: string) => insert(`reply-${room}-${calls.length}:${content}`, room, 'alice', 'assistant'),
    };
  }

  it('resumes with all unseen speakers and persists the last input cursor', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    expect(calls[0]?.resumed).toBeNull();
    expect(calls[0]?.messages.join('\n')).toContain('Continue this room.');
    expect(repo.load('room-a', 'alice')?.lastMessageId).toBe('first-user');
    insert('other-ai', 'room-a', 'bob', 'assistant');
    insert('foreign', 'room-b', 'bob', 'assistant');
    insert('next-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    expect(calls[1]?.resumed).toBe('session-a');
    expect(calls[1]?.messages.join('\n')).toContain('other-ai');
    expect(calls[1]?.messages.join('\n')).toContain('next-user');
    expect(calls[1]?.messages.join('\n')).not.toContain('reply-room-a-1');
    expect(calls[1]?.messages.join('\n')).not.toContain('foreign');
  });

  it('reconstructs once after a missing session, without retrying partial output', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    insert('next-user', 'room-a', 'user', 'user');
    clone.streamCompletion.mockImplementationOnce(async function* () {
      yield* [];
      throw new ChatCliSessionMissingError('session not found');
    });
    await coordinator.respond(turn('room-a'));
    expect(clone.resetConversationContext).toHaveBeenCalledOnce();
    expect(calls.at(-1)?.resumed).toBeNull();
    expect(calls.at(-1)?.messages.join('\n')).toContain('Continue this room.');
    expect(repo.load('room-a', 'alice')?.sessionId).toBe('session-a');
  });

  it('invalidates a checkpoint after generation fails', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    insert('next-user', 'room-a', 'user', 'user');
    clone.streamCompletion.mockImplementationOnce(async function* () {
      yield* [];
      throw new Error('authentication failed');
    });
    await expect(coordinator.respond(turn('room-a'))).rejects.toThrow('authentication failed');
    expect(repo.load('room-a', 'alice')).toBeNull();
  });

  it('never retries a missing session after partial output', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    insert('next-user', 'room-a', 'user', 'user');
    const callsBefore = clone.streamCompletion.mock.calls.length;
    clone.streamCompletion.mockImplementationOnce(async function* () {
      yield 'partial private output';
      throw new ChatCliSessionMissingError('session lost');
    });
    await expect(coordinator.respond(turn('room-a'))).rejects.toThrow(ChatCliSessionMissingError);
    expect(clone.streamCompletion.mock.calls.length).toBe(callsBefore + 1);
    expect(repo.load('room-a', 'alice')).toBeNull();
  });

  it('replaces a cached clone when provider configuration changes', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    provider.config = { ...provider.config, model: 'model-b' } as BaseProvider['config'];
    insert('next-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    expect(createClone).toHaveBeenCalledTimes(2);
    expect(clone.cooldown).toHaveBeenCalledOnce();
    expect(calls[1]?.resumed).toBeNull();
  });

  it('restores the saved CLI session after a coordinator restart', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    coordinator = new ChatSessionCoordinator(repo, INSTRUCTIONS_DIR, createClone);
    insert('later-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    expect(calls[1]?.resumed).toBe('session-a');
    expect(calls[1]?.messages.join('\n')).toContain('later-user');
  });

  it('resumes an already-consumed turn with only the current state hint', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    insert('second-user', 'room-a', 'user', 'user');
    const first = coordinator.respond(turn('room-a'));
    const second = coordinator.respond(turn('room-a', 'Choose one room response: public JSON'));
    expect(await first).toBe('reply');
    expect(await second).toBe('reply');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.messages.join('\n')).toContain('second-user');
    expect(calls[1]).toEqual({ messages: [], resumed: 'session-a', hint: 'Choose one room response: public JSON',
      instructionsDir: INSTRUCTIONS_DIR });
    expect(repo.load('room-a', 'alice')?.lastMessageId).toBe('second-user');
  });

  it('D2: a resumed DM turn with no unseen input carries the DM hint, not the room hint', async () => {
    insert('first-user', 'dm-a', 'user', 'user');
    insert('second-user', 'dm-a', 'user', 'user');
    const dmHint = directMessageTurnHint();
    const first = coordinator.respond(turn('dm-a', dmHint));
    const second = coordinator.respond(turn('dm-a', dmHint));
    expect(await first).toBe('reply');
    expect(await second).toBe('reply');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ messages: [], resumed: 'session-a', hint: dmHint, instructionsDir: INSTRUCTIONS_DIR });
    // The hint itself never claims "room" activity for a DM.
    expect(dmHint).not.toContain('room');
    expect(dmHint).not.toContain('new visible activity');
    // And the prompt actually sent to the CLI for that empty-input resume
    // uses the shared neutral wording, never the old room-only phrasing.
    const prompt = new CliPromptBuilder().buildChatDeltaPrompt([], dmHint);
    expect(prompt).not.toContain('new visible activity');
    expect(prompt).not.toContain('room');
    expect(prompt).toContain('Nothing new has been said since your last turn.');
  });

  it('skips a private reply turn that has no unseen input', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a'));
    const privateTurn = turn('room-a', 'Private reply to "Bob": JSON only', true);
    expect(await coordinator.respond(privateTurn)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(privateTurn.onStart).toHaveBeenCalledOnce();
  });

  it('starts a queued turn only after the previous turn leaves the shared queue', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    insert('other-user', 'room-b', 'user', 'user');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    clone.streamCompletion.mockImplementationOnce(async function* () {
      await gate;
      yield 'slow reply';
    });
    const first = turn('room-a');
    const second = turn('room-b');
    const pendingFirst = coordinator.respond(first);
    const pendingSecond = coordinator.respond(second);
    await vi.waitFor(() => expect(first.onStart).toHaveBeenCalledOnce());
    expect(second.onStart).not.toHaveBeenCalled();
    release?.();
    await Promise.all([pendingFirst, pendingSecond]);
    expect(second.onStart).toHaveBeenCalledOnce();
  });

  it('treats a whitespace-only reply as empty: returns null and saves no checkpoint (D1)', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    clone.streamCompletion.mockImplementationOnce(async function* () {
      yield '   \n\t  ';
    });
    expect(await coordinator.respond(turn('room-a'))).toBeNull();
    expect(repo.load('room-a', 'alice')).toBeNull();
  });

  it('does not start a queued turn whose signal was aborted while it waited', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    const controller = new AbortController();
    controller.abort();
    const aborted = { ...turn('room-a'), signal: controller.signal };
    expect(await coordinator.respond(aborted)).toBeNull();
    expect(aborted.onStart).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('continues the same recipient CLI session after a private reply with normal room rules', async () => {
    insert('first-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a', 'Private reply to "Bob": JSON only'));
    insert('later-user', 'room-a', 'user', 'user');
    await coordinator.respond(turn('room-a', 'Choose one room response: public or whisper JSON'));
    expect(calls[0]?.messages.join('\n')).toContain('Private reply to "Bob"');
    expect(calls[1]?.resumed).toBe('session-a');
    expect(calls[1]?.hint).toContain('Choose one room response:');
    expect(calls[1]?.messages.join('\n')).not.toContain('Private reply to "Bob"');
    expect(createClone).toHaveBeenCalledOnce();
  });
});
