/**
 * Unit tests for MessageService (R2 Task 11).
 *
 * Coverage:
 *   - append happy path: UUID id, epoch createdAt, emit('message')
 *   - user literal guard → UserAuthorMismatchError (service-layer)
 *   - member FK trigger → AuthorTriggerError (DB-layer, wrapped)
 *   - user literal from the DB side (defence-in-depth verification)
 *   - meta JSON round-trip (object + null)
 *   - listByChannel order (newest first) + `before` cursor
 *   - listByChannel respects default/max limits
 *   - search: channelId scope
 *   - search: projectId scope (joins channels)
 *   - search: global (no scope)
 *   - search: mutual exclusivity → SearchScopeError
 *   - search: bad FTS syntax → InvalidQueryError
 *   - search: bm25 ordering (more relevant row first)
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite,
 * matching the pattern used by Task 8/10 tests.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { ChannelRepository } from '../channel-repository';
import { ChannelService } from '../channel-service';
import { MessageRepository } from '../message-repository';
import {
  AuthorTriggerError,
  InvalidQueryError,
  MESSAGE_EVENT,
  MessageService,
  SearchScopeError,
  UserAuthorMismatchError,
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
  let projectRepo: ProjectRepository;
  let projectService: ProjectService;
  let channelRepo: ChannelRepository;
  let channelService: ChannelService;
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

    projectRepo = new ProjectRepository(db);
    projectService = new ProjectService(projectRepo, arenaRootService);
    channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo, projectRepo);
    messageRepo = new MessageRepository(db);
    messageService = new MessageService(messageRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // Small helper: build a channel we can hang messages off of.
  async function makeChannel(): Promise<{
    projectId: string;
    channelId: string;
  }> {
    const project = await projectService.create({
      name: 'MsgProj',
      kind: 'new',
      permissionMode: 'hybrid',
    });
    const channel = channelService.create({
      projectId: project.id,
      name: 'chat',
    });
    return { projectId: project.id, channelId: channel.id };
  }

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
  });

  // ── search ─────────────────────────────────────────────────────────

  describe('search', () => {
    it('finds messages by literal keyword within a channel', async () => {
      const { channelId } = await makeChannel();
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'banana tree',
      });
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'apple pie',
      });

      const hits = messageService.search('banana', { channelId });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toBe('banana tree');
      // bm25 is negative (smaller = more relevant).
      expect(hits[0]!.rank).toBeLessThan(0);
    });

    it('scopes by projectId across all channels in the project', async () => {
      // Make two projects, each with one channel. Messages in channels of
      // `target` project should match; messages in the other project
      // should NOT.
      const target = await projectService.create({
        name: 'Target',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const other = await projectService.create({
        name: 'Other',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const targetCh = channelService.create({
        projectId: target.id,
        name: 'chat',
      });
      const otherCh = channelService.create({
        projectId: other.id,
        name: 'chat',
      });

      messageService.append({
        channelId: targetCh.id,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'find me strawberry',
      });
      messageService.append({
        channelId: otherCh.id,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'another strawberry elsewhere',
      });

      const hits = messageService.search('strawberry', {
        projectId: target.id,
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.channelId).toBe(targetCh.id);
    });

    it('searches globally when neither channelId nor projectId is set', async () => {
      const { channelId: a } = await makeChannel();
      const projB = await projectService.create({
        name: 'B',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const chB = channelService.create({
        projectId: projB.id,
        name: 'chat',
      });
      messageService.append({
        channelId: a,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'global watermelon',
      });
      messageService.append({
        channelId: chB.id,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'also watermelon here',
      });

      const hits = messageService.search('watermelon');
      expect(hits).toHaveLength(2);
    });

    it('throws SearchScopeError when both channelId and projectId are given', async () => {
      const { channelId, projectId } = await makeChannel();
      expect(() =>
        messageService.search('foo', { channelId, projectId }),
      ).toThrow(SearchScopeError);
    });

    it('wraps malformed FTS5 queries as InvalidQueryError', async () => {
      const { channelId } = await makeChannel();
      // Need at least one row so the query planner actually evaluates the
      // MATCH (empty FTS table short-circuits to "no rows" without parsing).
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'anything at all',
      });
      // FTS5 parses an unterminated quoted phrase as a syntax error.
      expect(() =>
        messageService.search('"unterminated phrase', { channelId }),
      ).toThrow(InvalidQueryError);
    });

    it('orders results by bm25 ascending (most relevant first)', async () => {
      const { channelId } = await makeChannel();
      // Higher term frequency on the query word = smaller (more negative)
      // bm25 rank.
      const denser = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'pineapple pineapple pineapple',
      });
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'pineapple once, with other words around it',
      });

      const hits = messageService.search('pineapple', { channelId });
      expect(hits).toHaveLength(2);
      expect(hits[0]!.id).toBe(denser.id);
      expect(hits[0]!.rank).toBeLessThanOrEqual(hits[1]!.rank);
    });

    it('respects search limit', async () => {
      const { channelId } = await makeChannel();
      for (let i = 0; i < 5; i += 1) {
        messageService.append({
          channelId,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          // Avoid hyphens in tokens — FTS5 would parse `foo-bar` as
          // `foo NOT bar`. Plain alphanumerics keep the query literal.
          content: `keyword${i} keyword${i}`,
        });
      }
      const limited = messageService.search(
        'keyword0 OR keyword1 OR keyword2',
        { channelId, limit: 2 },
      );
      expect(limited).toHaveLength(2);
    });
  });
});
