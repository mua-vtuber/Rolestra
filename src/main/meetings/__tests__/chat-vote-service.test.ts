import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import { insertChannel, insertProvider } from '../../database/__tests__/_helpers';
import { OpinionRepository } from '../opinion-repository';
import { ChatVoteRepository } from '../chat-vote-repository';
import { ChatVoteService } from '../chat-vote-service';
import type { BaseProvider } from '../../providers/provider-interface';
import { asAbsolutePath } from '../../../shared/absolute-path';
import { ChatRoomService } from '../../channels/chat-room-service';
import { ChatRoomRepository } from '../../channels/chat-room-repository';
import { ChannelRepository } from '../../channels/channel-repository';
import { SystemRowInModelInputError } from '../../channels/message-visibility';
import { CHAT_RUNTIME_ENVIRONMENT_RULE, withChatRuntimeRules } from '../../members/persona-builder';
import { CHAT_PASS_MODEL_LINE } from '../../channels/chat-whisper-output';
import { CHAT_PASS_CODE, type Message } from '../../../shared/message-types';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

type MockResponse = string | Error | Promise<string> | { partial: string; rest: Promise<string> };
type HistoryRow = Pick<Message, 'role' | 'content' | 'authorKind' | 'authorId' | 'meta'>;
const ROOM_HISTORY: HistoryRow[] = [{ role: 'user', content: 'room history', authorKind: 'user', authorId: 'user', meta: null }];
function setup(responses: Record<string, MockResponse> = {}, timeoutMs = 60_000, history = ROOM_HISTORY) {
  const db = new Database(':memory:'); opened.push(db);
  db.pragma('foreign_keys = ON'); runMigrations(db, migrations);
  for (const id of ['a', 'b', 'c']) insertProvider(db, id);
  insertChannel(db, 'room', null, 'user');
  db.prepare("INSERT INTO chat_rooms(channel_id, created_at) VALUES ('room', 1)").run();
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    db.prepare(`INSERT INTO chat_room_members(channel_id,provider_id,sort_order,display_name,persona_source,role,personality,expertise,legacy_persona,effective_persona)
      VALUES ('room', ?, ?, ?, 'default','','','','',?)`).run(id, i, id.toUpperCase(), `persona-${id}`);
  }
  db.prepare(`INSERT INTO opinion(id,meeting_id,channel_id,kind,author_label,title,content,status,round,created_at,updated_at)
    VALUES ('op',NULL,'room','user-raised','user_1','Proposal','Body','pending',0,1,1)`).run();
  const calls: Array<{ id: string; persona: string; messages: unknown[] }> = [];
  const viewers: unknown[] = [];
  const available = new Set(['a','b','c']);
  const providerLookup = { get: (id: string) => available.has(id) ? ({
    id, displayName: id.toUpperCase(), config: { type: 'local' },
  } as unknown as BaseProvider) : undefined };
  const channels = new ChannelRepository(db);
  const roomService = new ChatRoomService(new ChatRoomRepository(db, channels), channels,
    providerLookup as never, { getProfile: () => ({}) } as never);
  const createIsolatedProvider = (provider: BaseProvider) => ({
    async *streamCompletion(messages: unknown[], persona: string) {
      calls.push({ id: provider.id, persona, messages });
      const response = responses[provider.id];
      if (response instanceof Error) throw response;
      if (response && typeof response === 'object' && 'partial' in response) {
        yield response.partial;
        yield await response.rest;
        return;
      }
      yield await (response ?? '{"opinion":"ok","vote":"agree"}');
    },
    cooldown: vi.fn(async () => undefined),
  });
  const service = new ChatVoteService(
    new ChatVoteRepository(db), new OpinionRepository(db),
    roomService,
    { listByChannel: (_channelId, _options, viewer) => {
      viewers.push(viewer);
      return history;
    } },
    providerLookup, createIsolatedProvider as never, () => 'C:/test-consensus',
    asAbsolutePath('C:/test-app-data/chat-cli-instructions', 'vote test'),
    // F3 STEP 3b: BaseProvider no longer carries an in-memory persona —
    // this callback stands in for the characterSheet-based one
    // chat-services.ts wires in production; any per-provider string
    // works here since the test only cares that SOME persona reaches
    // streamCompletion (asserted via `calls[].persona` below).
    () => false, (provider) => `persona-for-${provider.displayName}`, timeoutMs,
  );
  roomService.on('closed', ({ channelId }: { channelId: string }) => service.interruptChannel(channelId));
  return { db, service, calls, viewers, roomService, available };
}

async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe('chat vote runtime', () => {
  it('refuses a stored system row in the vote context instead of sending it to any model', () => {
    // The public viewer SQL excludes stored system rows; this simulates that
    // filter regressing with a legacy failure line (spec 2026-09-29 §C).
    const { service, calls } = setup({}, 60_000, [
      { role: 'system', content: '응답 실패: codex.cmd exited 1', authorKind: 'member', authorId: 'a', meta: null },
    ]);
    expect(() => service.startVote('op')).toThrow(SystemRowInModelInputError);
    expect(service.getVote('op')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows a pass row in the vote context as the pass line, never as its stored code (spec 2026-10-01 F1)', async () => {
    const { service, calls } = setup({}, 60_000, [
      { role: 'user', content: CHAT_PASS_CODE, authorKind: 'user', authorId: 'user', meta: { chatPass: CHAT_PASS_CODE } },
    ]);
    service.startVote('op');
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    const context = JSON.stringify(calls[0]?.messages);
    expect(context).toContain(CHAT_PASS_MODEL_LINE);
    expect(context).not.toContain(CHAT_PASS_CODE);
  });

  it('starts only on explicit request, is idempotent, and counts three votes separately', async () => {
    const { service, calls, viewers } = setup({
      a: '{"opinion":"yes","vote":"agree"}',
      b: '{"opinion":"no","vote":"oppose"}',
      c: '{"opinion":"maybe","vote":"abstain"}',
    });
    expect(service.getVote('op')).toBeNull();
    const first = service.startVote('op');
    expect(first.status).toBe('running');
    expect(service.startVote('op').id).toBe(first.id);
    await settle();
    const result = service.getVote('op');
    expect(result?.counts).toEqual({ agree: 1, oppose: 1, abstain: 1, pending: 0, failed: 0, total: 3 });
    expect(calls).toHaveLength(3);
    // The stored snapshot plus the runtime rule, added once at call time (spec 2026-10-01 F4-6).
    expect(calls.every((call) => call.persona === withChatRuntimeRules(`persona-${call.id}`))).toBe(true);
    expect(calls.every((call) => call.persona.split(CHAT_RUNTIME_ENVIRONMENT_RULE).length === 2)).toBe(true);
    expect(viewers).toEqual([{ kind: 'public' }]);
  });

  it('fails malformed or forged replies without turning failures into abstentions', async () => {
    const { service } = setup({ a: '{"opinion":"", "vote":"agree"}', b: '{"opinion":"ok","vote":"oppose","providerId":"a"}', c: new Error('offline') });
    service.startVote('op'); await settle();
    const result = service.getVote('op');
    expect(result?.counts).toEqual({ agree: 0, oppose: 0, abstain: 0, pending: 0, failed: 3, total: 3 });
    expect(result?.participants.map((part) => part.error)).toEqual(['invalid_response','invalid_response','provider_error']);
  });

  it('interrupts on archive and rejects late responses', async () => {
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => { resolve = done; });
    const { service, roomService } = setup({ a: response });
    service.startVote('op');
    await settle();
    roomService.archive('room');
    expect(() => service.startVote('op')).toThrow(/archived/);
    resolve('{"opinion":"late","vote":"agree"}');
    await settle();
    expect(service.getVote('op')?.status).toBe('interrupted');
    expect(service.getVote('op')?.counts).toEqual({ agree: 0, oppose: 0, abstain: 0, pending: 0, failed: 3, total: 3 });
  });

  it('marks persisted running votes interrupted after restart without calling providers', () => {
    const { service, db, calls } = setup();
    service.startVote('op');
    new ChatVoteRepository(db).interruptRunning();
    expect(service.getVote('op')?.status).toBe('interrupted');
    expect(calls).toHaveLength(0);
  });

  it('preserves participant identity after provider removal and cascades on room delete', async () => {
    const { service, db, roomService, available } = setup();
    available.delete('b');
    service.startVote('op'); await settle();
    db.prepare("DELETE FROM providers WHERE id = 'b'").run();
    expect(service.getVote('op')?.participants[1]).toMatchObject({
      providerId: 'b', displayName: 'B', status: 'failed', error: 'provider_unavailable',
    });
    roomService.archive('room'); roomService.delete('room');
    expect(service.getVote('op')).toBeNull();
  });

  it('rejects a valid late ballot when its provider disappears during generation', async () => {
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => { resolve = done; });
    const { service, db, available, calls } = setup({ a: response });
    service.startVote('op');
    await settle();
    expect(calls.map((call) => call.id)).toEqual(['a']);
    available.delete('a');
    db.prepare("DELETE FROM providers WHERE id = 'a'").run();
    resolve('{"opinion":"late yes","vote":"agree"}');
    await settle();
    expect(service.getVote('op')?.participants[0]).toMatchObject({
      providerId: 'a', displayName: 'A', status: 'failed', vote: null,
      opinion: null, error: 'provider_unavailable',
    });
    expect(service.getVote('op')?.counts).toEqual({
      agree: 2, oppose: 0, abstain: 0, pending: 0, failed: 1, total: 3,
    });
    expect(calls.map((call) => call.id)).toEqual(['a', 'b', 'c']);
  });

  it('times out after a partial response and continues to the next participant', async () => {
    const stalled = new Promise<string>(() => undefined);
    const { service, calls } = setup({ a: { partial: '{"opinion":', rest: stalled } }, 5);
    service.startVote('op');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.getVote('op')?.participants[0]).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(calls.map((call) => call.id)).toEqual(['a','b','c']);
  });

  it('shutdown interrupts a stalled provider and waits for runner cleanup', async () => {
    const stalled = new Promise<string>(() => undefined);
    const { service } = setup({ a: stalled });
    service.startVote('op'); await settle();
    await service.shutdown();
    expect(service.getVote('op')?.status).toBe('interrupted');
    expect(service.getVote('op')?.counts.pending).toBe(0);
    expect(() => service.startVote('op')).toThrow(/shutting down/);
  });

  it('marks an oversized reply invalid even when its abort wins the race', async () => {
    const { service } = setup({ a: 'x'.repeat(65 * 1024) });
    service.startVote('op'); await settle();
    expect(service.getVote('op')?.participants[0]).toMatchObject({
      status: 'failed', error: 'invalid_response',
    });
    expect(service.getVote('op')?.counts).toEqual({
      agree: 2, oppose: 0, abstain: 0, pending: 0, failed: 1, total: 3,
    });
  });

  it('permits only one active vote per room', async () => {
    const stalled = new Promise<string>(() => undefined);
    const { service, db } = setup({ a: stalled });
    db.prepare(`INSERT INTO opinion(id,meeting_id,channel_id,kind,author_label,title,content,status,round,created_at,updated_at)
      VALUES ('op2',NULL,'room','user-raised','user_2','Second','Body','pending',0,2,2)`).run();
    service.startVote('op');
    expect(() => service.startVote('op2')).toThrow();
    await service.shutdown();
    expect(service.getVote('op2')).toBeNull();
  });

  it('accepts a ballot wrapped in exactly one code fence, or a leading BOM (W9)', async () => {
    const { service } = setup({
      a: '```json\n{"opinion":"fenced yes","vote":"agree"}\n```',
      b: '```\n{"opinion":"bare fence","vote":"oppose"}\n```',
      c: '﻿{"opinion":"bom only","vote":"abstain"}',
    });
    service.startVote('op'); await settle();
    const result = service.getVote('op');
    expect(result?.counts).toEqual({ agree: 1, oppose: 1, abstain: 1, pending: 0, failed: 0, total: 3 });
    expect(result?.participants.map((part) => part.opinion))
      .toEqual(['fenced yes', 'bare fence', 'bom only']);
  });

  it.each([
    ['prose before the block', 'Sure:\n```json\n{"opinion":"x","vote":"agree"}\n```'],
    ['prose after the block', '```json\n{"opinion":"x","vote":"agree"}\n```\nDone.'],
    ['two blocks', '```json\n{"opinion":"x","vote":"agree"}\n```\n```json\n{"opinion":"y","vote":"oppose"}\n```'],
    ['text after the closing fence', '```json\n{"opinion":"x","vote":"agree"}\n``` extra'],
    ['a fence around invalid JSON', '```json\n{"opinion":\n```'],
  ])('still fails a ballot with %s', async (_label, raw) => {
    const { service } = setup({ a: raw });
    service.startVote('op'); await settle();
    expect(service.getVote('op')?.participants[0]).toMatchObject({ status: 'failed', error: 'invalid_response' });
  });
});
