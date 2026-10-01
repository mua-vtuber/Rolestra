/**
 * Unit tests for MessageService — append/listByChannel + whisper rules
 * (R2 Task 11).
 *
 * D1 (2026-09-28): this file used to also cover `search` / `searchWithContext`
 * / `listRecent`; those three describe blocks moved verbatim (no behavior
 * change) to sibling file message-service-search.test.ts because this file
 * exceeded the 800-line cap. See that file's header for the moved coverage
 * list.
 *
 * Coverage:
 *   - whisper filtering across paging/search + observer/provider visibility
 *   - one root per user message + sender + recipient, one inverse private
 *     reply per root (migration 033-whisper-pairs)
 *   - append happy path: UUID id, epoch createdAt, emit('message')
 *   - user literal guard → UserAuthorMismatchError (service-layer)
 *   - member FK trigger → AuthorTriggerError (DB-layer, wrapped)
 *   - user literal from the DB side (defence-in-depth verification)
 *   - meta JSON round-trip (object + null)
 *   - listener error isolation from the append return path
 *   - listByChannel order (newest first) + `before` cursor
 *   - listByChannel respects default/max limits
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite,
 * matching the pattern used by Task 8/10 tests.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { insertChannel, insertProject } from '../../database/__tests__/_helpers';
import { clearLoggerAccessor, setLoggerAccessor } from '../../log/logger-accessor';
import { StructuredLogger } from '../../log/structured-logger';
import { MessageRepository } from '../message-repository';
import {
  AuthorTriggerError,
  MESSAGE_EVENT,
  MessageService,
  UserAuthorMismatchError,
  type AppendWhisperInput,
} from '../message-service';
import type { Message } from '../../../shared/message-types';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createConfigStub(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch: { arenaRoot?: string }) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

function seedProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Provider ${id}`, 1700000000000, 1700000000000);
}

describe('MessageService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let messageRepo: MessageRepository;
  let messageService: MessageService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task11-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    messageRepo = new MessageRepository(db);
    messageService = new MessageService(messageRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // Small helper: build a channel we can hang messages off of. D1
  // (2026-09-28): ChannelService.create() (project-scoped user channel)
  // was removed with the rest of the dead project/department API — no
  // IPC channel calls it. MessageService.search()'s projectId scope is
  // still live code (just not IPC-exposed), so these tests still need a
  // channel under a real project row; insertProject/insertChannel build
  // that row directly instead of going through the removed service call.
  function makeChannel(): { projectId: string; channelId: string } {
    const projectId = randomUUID();
    const channelId = randomUUID();
    insertProject(db, projectId);
    insertChannel(db, channelId, projectId, 'user', 'chat');
    return { projectId, channelId };
  }

  it('filters whispers before paging and search while the observer sees both', async () => {
    const { channelId } = await makeChannel();
    seedProvider(db, 'alice');
    seedProvider(db, 'bob');
    const source = messageService.append({ channelId, authorId: 'user', authorKind: 'user',
      role: 'user', content: 'opening' });
    const secret = messageService.appendWhisper({ channelId, authorId: 'alice',
      recipientId: 'bob', senderName: 'Alice', recipientName: 'Bob',
      sourceMessageId: source.id, content: 'hidden apricot' });
    const publicMessage = messageService.append({ channelId, authorId: 'alice', authorKind: 'member',
      role: 'assistant', content: 'public apricot' });
    messageService.appendWhisper({ channelId, authorId: 'bob', recipientId: 'alice',
      senderName: 'Bob', recipientName: 'Alice', sourceMessageId: source.id,
      replyToMessageId: secret.id, threadSeq: 2, content: 'reply apricot' });
    expect(messageService.listByChannel(channelId, { limit: 1 }).map((m) => m.content))
      .toEqual(['public apricot']);
    expect(messageService.listByChannel(channelId, {}, { kind: 'observer' }).map((m) => m.id))
      .toContain(secret.id);
    expect(messageService.listByChannel(channelId, {}, { kind: 'provider', providerId: 'bob' }).map((m) => m.id))
      .toContain(secret.id);
    expect(messageService.listByChannel(channelId, {}, { kind: 'provider', providerId: 'charlie' }).map((m) => m.id))
      .not.toContain(secret.id);
    expect(messageService.search('hidden')).toEqual([]);
    expect(messageService.searchWithContext('hidden', { channelId }, { kind: 'observer' })[0]?.id)
      .toBe(secret.id);
    for (const providerId of ['alice', 'bob']) {
      const hits = messageService.searchWithContext('hidden', { channelId },
        { kind: 'provider', providerId });
      expect(hits[0]?.id).toBe(secret.id);
      expect(hits[0]?.snippet).toContain('hidden');
    }
    expect(messageService.searchWithContext('hidden', { channelId },
      { kind: 'provider', providerId: 'charlie' })).toEqual([]);
    expect(messageService.searchWithContext('apricot', { channelId, limit: 1 })[0]?.id)
      .toBe(publicMessage.id);
    expect(messageRepo.get(secret.id)).toBeNull();
    expect(messageRepo.get(secret.id, { kind: 'observer' })?.whisper?.recipientId).toBe('bob');
    expect(messageRepo.listAllByChannel(channelId).some((m) => m.id === secret.id)).toBe(true);
  });

  it('enforces one root per user message + sender + recipient, and one inverse private reply per root', async () => {
    // D2 (2026-09-28): renamed to match migration 033
    // (033-whisper-pairs.ts) — the root uniqueness constraint moved from
    // "one root per user message" to "one root per user message AND
    // sender→recipient pair" (a message may now start several root
    // whispers to different recipients). The reply constraint is
    // unchanged: still one reply per root. This test only exercises a
    // single alice↔bob pair, so its assertions did not need to change —
    // only the name, which still described the pre-033 rule.
    const { channelId } = await makeChannel();
    seedProvider(db, 'alice');
    seedProvider(db, 'bob');
    const source = messageService.append({ channelId, authorId: 'user', authorKind: 'user',
      role: 'user', content: 'start' });
    const rootInput = { channelId, authorId: 'alice', recipientId: 'bob',
      senderName: 'Alice', recipientName: 'Bob', sourceMessageId: source.id,
      content: 'secret' };
    const root = messageService.appendWhisper(rootInput);
    expect(() => messageService.appendWhisper(rootInput)).toThrow();
    expect(() => messageService.appendWhisper({ ...rootInput, replyToMessageId: '', threadSeq: 2 })).toThrow();
    expect(() => messageService.appendWhisper({ ...rootInput, sourceMessageId: 'missing' })).toThrow();
    const replyInput = { ...rootInput, authorId: 'bob', recipientId: 'alice',
      senderName: 'Bob', recipientName: 'Alice', replyToMessageId: root.id, threadSeq: 2 };
    const reply = messageService.appendWhisper(replyInput);
    expect(reply.whisper?.replyToMessageId).toBe(root.id);
    expect(() => messageService.appendWhisper(replyInput)).toThrow();
    expect(() => messageService.appendWhisper({ ...replyInput,
      authorId: 'alice', recipientId: 'bob', replyToMessageId: reply.id })).toThrow();
  });

  it('accepts an alternating whisper thread up to its limit and refuses anything out of order (spec 2026-10-01 F2)', async () => {
    const { channelId } = await makeChannel();
    for (const id of ['alice', 'bob', 'carol']) seedProvider(db, id);
    const source = messageService.append({ channelId, authorId: 'user', authorKind: 'user',
      role: 'user', content: 'start' });
    const names = { alice: 'Alice', bob: 'Bob', carol: 'Carol' } as const;
    const base = (authorId: keyof typeof names, recipientId: keyof typeof names) => ({
      channelId, authorId, recipientId, senderName: names[authorId], recipientName: names[recipientId],
      sourceMessageId: source.id, content: `${authorId} to ${recipientId}` });
    const root = messageService.appendWhisper(base('alice', 'bob'));
    expect(root.whisper?.threadSeq).toBe(1);
    const reply = (authorId: keyof typeof names, recipientId: keyof typeof names, threadSeq: number) =>
      messageService.appendWhisper({ ...base(authorId, recipientId), replyToMessageId: root.id, threadSeq });

    expect(() => reply('bob', 'alice', 3)).toThrow('Invalid whisper reply');
    expect(() => reply('alice', 'bob', 2)).toThrow('Invalid whisper reply');
    expect(() => reply('carol', 'alice', 2)).toThrow('Invalid whisper reply');
    expect(reply('bob', 'alice', 2).whisper).toMatchObject({ replyToMessageId: root.id, threadSeq: 2 });
    expect(() => reply('bob', 'alice', 3)).toThrow('Invalid whisper reply');
    expect(() => reply('carol', 'bob', 3)).toThrow('Invalid whisper reply');
    expect(reply('alice', 'bob', 3).whisper?.threadSeq).toBe(3);
    expect(reply('bob', 'alice', 4).whisper?.threadSeq).toBe(4);
    expect(() => reply('alice', 'bob', 5)).toThrow('Invalid whisper reply');
    expect(() => reply('bob', 'alice', 4)).toThrow();
    expect(() => messageService.appendWhisper({ ...base('carol', 'bob'),
      threadSeq: 2 } as unknown as AppendWhisperInput)).toThrow('Invalid whisper');
    expect(messageRepo.listAllByChannel(channelId).filter((m) => m.visibility === 'whisper')
      .map((m) => [m.authorId, m.whisper?.threadSeq])).toEqual([['alice', 1], ['bob', 2], ['alice', 3], ['bob', 4]]);
  });

  // ── append ─────────────────────────────────────────────────────────

  describe('append', () => {
    it('inserts a row, generates UUID + createdAt, and returns the saved message', async () => {
      const { channelId } = await makeChannel();

      const msg = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'hello world',
      });

      expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof msg.createdAt).toBe('number');
      expect(msg.createdAt).toBeGreaterThan(0);
      expect(msg.channelId).toBe(channelId);
      expect(msg.meetingId).toBeNull();
      expect(msg.authorId).toBe('user');
      expect(msg.authorKind).toBe('user');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('hello world');
      expect(msg.meta).toBeNull();
      expect(messageRepo.get(msg.id)).toEqual(msg);
    });

    it('throws UserAuthorMismatchError when authorKind=user but authorId!="user"', async () => {
      const { channelId } = await makeChannel();
      expect(() =>
        messageService.append({
          channelId,
          authorId: 'someone-else',
          authorKind: 'user',
          role: 'user',
          content: 'hi',
        }),
      ).toThrow(UserAuthorMismatchError);
    });

    it('does NOT write a row when the service-layer guard rejects', async () => {
      const { channelId } = await makeChannel();
      try {
        messageService.append({
          channelId,
          authorId: 'spoof',
          authorKind: 'user',
          role: 'user',
          content: 'should not persist',
        });
      } catch {
        /* expected */
      }
      expect(messageService.listByChannel(channelId)).toHaveLength(0);
    });

    it('wraps the DB trigger into AuthorTriggerError when member authorId is unknown', async () => {
      const { channelId } = await makeChannel();
      expect(() =>
        messageService.append({
          channelId,
          authorId: 'nonexistent-provider',
          authorKind: 'member',
          role: 'assistant',
          content: 'I am not a real provider',
        }),
      ).toThrow(AuthorTriggerError);
    });

    it('accepts member author when authorId references providers.id', async () => {
      seedProvider(db, 'prov-member');
      const { channelId } = await makeChannel();

      const msg = messageService.append({
        channelId,
        authorId: 'prov-member',
        authorKind: 'member',
        role: 'assistant',
        content: 'from the AI',
      });
      expect(msg.authorId).toBe('prov-member');
      expect(msg.authorKind).toBe('member');
    });

    it('round-trips meta (object) through JSON', async () => {
      const { channelId } = await makeChannel();
      const msg = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'has meta',
        meta: {
          mentions: ['prov-a'],
          approvalRef: 'appr-123',
          custom: { nested: 42 },
        },
      });
      // Read it back cold through the repo to make sure it's really in SQL,
      // not just cached in the service.
      const loaded = messageRepo.get(msg.id);
      expect(loaded?.meta).toEqual({
        mentions: ['prov-a'],
        approvalRef: 'appr-123',
        custom: { nested: 42 },
      });
    });

    it('round-trips meta=null as SQL NULL', async () => {
      const { channelId } = await makeChannel();
      const msg = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'no meta',
        meta: null,
      });
      const loaded = messageRepo.get(msg.id);
      expect(loaded?.meta).toBeNull();
      // And the raw column is SQL NULL (not the string "null").
      const raw = db
        .prepare('SELECT meta_json FROM messages WHERE id = ?')
        .get(msg.id) as { meta_json: string | null };
      expect(raw.meta_json).toBeNull();
    });

    it('emits "message" event on successful append', async () => {
      const { channelId } = await makeChannel();
      const received: Message[] = [];
      messageService.on(MESSAGE_EVENT, (m) => received.push(m));

      const sent = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'broadcast me',
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(sent);
    });

    it('does NOT emit when the append throws', async () => {
      const { channelId } = await makeChannel();
      const received: Message[] = [];
      messageService.on(MESSAGE_EVENT, (m) => received.push(m));

      try {
        messageService.append({
          channelId,
          authorId: 'wrong',
          authorKind: 'user',
          role: 'user',
          content: 'nope',
        });
      } catch {
        /* expected */
      }
      expect(received).toHaveLength(0);
    });

    it('isolates listener errors from the append return path (routes to the project logger, not console.warn)', async () => {
      const { channelId } = await makeChannel();
      // A subscriber that throws — simulates a buggy downstream listener.
      messageService.on(MESSAGE_EVENT, () => {
        throw new Error('listener exploded');
      });
      // D2 (2026-09-28): matches the pattern established for
      // DmChannelService/ChatRoomService close-listener failures
      // (dm-delete-close.test.ts) — a real StructuredLogger wired via
      // setLoggerAccessor, plus a console.warn spy to prove the old
      // fallback is gone, not just that the new path exists.
      const logger = new StructuredLogger({ console: false, level: 'debug' });
      setLoggerAccessor(() => logger);
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      let saved: Message | undefined;
      try {
        // (a) `append` must return normally — the listener throw must NOT
        // become the caller's problem.
        saved = messageService.append({
          channelId,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: 'survives the listener',
        });

        // (b) the Message is returned with a real id.
        expect(saved).toBeDefined();
        expect(saved!.id).toMatch(/^[0-9a-f-]{36}$/);

        // (c) the row is actually in the DB (insert committed before emit).
        expect(messageRepo.get(saved!.id)).toEqual(saved);

        // (d) the failure was routed through the structured logger, not
        // console.warn — this is what replaces "listener error crashes
        // the caller" in option (c) of the fix.
        const errorEntries = logger
          .getEntries({ level: 'error' })
          .filter((e) => e.component === 'message-service' && e.action === 'listener-error');
        expect(errorEntries).toHaveLength(1);
        expect(errorEntries[0]?.metadata).toMatchObject({
          messageId: saved!.id,
          channelId,
          error: 'listener exploded',
        });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        clearLoggerAccessor();
        warnSpy.mockRestore();
      }
    });
  });

  // ── listByChannel ──────────────────────────────────────────────────

  describe('listByChannel', () => {
    it('returns messages newest-first', async () => {
      const { channelId } = await makeChannel();
      const a = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'first',
      });
      // Force distinct createdAt values — SQLite may batch within a single
      // ms so we yield a couple of times to get separate timestamps.
      await new Promise((r) => setTimeout(r, 2));
      const b = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'second',
      });
      await new Promise((r) => setTimeout(r, 2));
      const c = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'third',
      });

      const listed = messageService.listByChannel(channelId);
      expect(listed.map((m) => m.id)).toEqual([c.id, b.id, a.id]);
    });

    it('honours `before` cursor (exclusive upper bound)', async () => {
      const { channelId } = await makeChannel();
      const a = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'A',
      });
      await new Promise((r) => setTimeout(r, 2));
      const b = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'B',
      });
      await new Promise((r) => setTimeout(r, 2));
      const c = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'C',
      });

      const older = messageService.listByChannel(channelId, {
        before: c.createdAt,
      });
      // Strictly older than C.
      expect(older.map((m) => m.id)).toEqual([b.id, a.id]);
    });

    it('respects limit', async () => {
      const { channelId } = await makeChannel();
      for (let i = 0; i < 10; i += 1) {
        messageService.append({
          channelId,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: `m${i}`,
        });
      }
      const two = messageService.listByChannel(channelId, { limit: 2 });
      expect(two).toHaveLength(2);
    });

    it('pages every row with tied timestamps using a channel-scoped message cursor', async () => {
      const { channelId } = await makeChannel();
      const { channelId: otherChannelId } = await makeChannel();
      for (let i = 0; i < 101; i += 1) {
        messageRepo.insert({
          id: `same-time-${i}`, channelId, meetingId: null,
          authorId: 'user', authorKind: 'user', role: 'user',
          content: String(i), meta: null, createdAt: 1000,
        });
      }
      const first = messageService.listByChannel(channelId, { limit: 50 });
      const second = messageService.listByChannel(channelId, {
        limit: 50, beforeMessageId: first.at(-1)?.id,
      });
      const third = messageService.listByChannel(channelId, {
        limit: 50, beforeMessageId: second.at(-1)?.id,
      });
      expect([...first, ...second, ...third]).toHaveLength(101);
      expect(new Set([...first, ...second, ...third].map((row) => row.id)).size).toBe(101);
      expect(() => messageService.listByChannel(otherChannelId, {
        beforeMessageId: first.at(-1)?.id,
      })).toThrow('cursor not found');
    });
  });
});
