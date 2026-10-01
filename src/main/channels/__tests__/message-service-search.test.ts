/**
 * Unit tests for MessageService — search surfaces (R2 Task 11 / R10-Task2 /
 * R4-Task7).
 *
 * D1 (2026-09-28): split out of message-service.test.ts, which exceeded the
 * 800-line file cap. The `search` / `searchWithContext` / `listRecent`
 * describe blocks moved here verbatim (no behavior change); `append` /
 * `listByChannel` and the two whisper-focused top-level `it`s stayed in the
 * original file. Header, helpers, and `makeChannel()` are duplicated so this
 * file is a self-contained suite, matching the existing split-file pattern
 * elsewhere in this repo.
 *
 * Coverage:
 *   - search: channelId scope
 *   - search: projectId scope (joins channels)
 *   - search: global (no scope)
 *   - search: mutual exclusivity → SearchScopeError
 *   - search: bad FTS syntax → InvalidQueryError
 *   - search: non-FTS SQLITE_ERROR must NOT be wrapped as InvalidQueryError
 *   - search: bm25 ordering (more relevant row first) + limit
 *   - searchWithContext: snippet + channelName + projectName join
 *   - searchWithContext: projectName=null for DM channels
 *   - searchWithContext: SearchScopeError / InvalidQueryError / limit clamp
 *     / bm25 ordering (same contract as search())
 *   - listRecent: newest-first with channelName + senderLabel joined
 *   - listRecent: excerpt truncation + limit
 *
 * Each test provisions its own temp ArenaRoot + fresh on-disk SQLite,
 * matching the pattern used by Task 8/10 tests.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { insertChannel, insertProject } from '../../database/__tests__/_helpers';
import { ChannelRepository } from '../channel-repository';
import { ChannelService } from '../channel-service';
import { MessageRepository } from '../message-repository';
import {
  InvalidQueryError,
  MessageService,
  SearchScopeError,
} from '../message-service';

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

    channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo);
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
      const target = { id: randomUUID() };
      const other = { id: randomUUID() };
      insertProject(db, target.id);
      insertProject(db, other.id);
      const targetCh = { id: randomUUID() };
      const otherCh = { id: randomUUID() };
      insertChannel(db, targetCh.id, target.id, 'user', 'chat');
      insertChannel(db, otherCh.id, other.id, 'user', 'chat');

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
      const projB = { id: randomUUID() };
      insertProject(db, projB.id);
      const chB = { id: randomUUID() };
      insertChannel(db, chB.id, projB.id, 'user', 'chat');
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

    it('does NOT wrap a non-FTS SQLITE_ERROR (e.g. column typo) as InvalidQueryError', () => {
      // Regression guard for the tightened `isFtsQueryError` mapper.
      // `SQLITE_ERROR` is SQLite's generic catch-all and fires for code
      // bugs like a column typo in a future edit. Before the tightening
      // we would have mis-wrapped that as InvalidQueryError and blamed
      // the user's query string. Now the error must bubble up unwrapped.
      //
      // We simulate a real SQLITE_ERROR via a stub repo (constructing an
      // actual column typo would require owning the repo's SQL, which is
      // not the service's layer to poke at).
      const nonFtsError = Object.assign(
        new Error('no such column: messages.missing_col'),
        { code: 'SQLITE_ERROR' },
      );
      const stubRepo = {
        insert: () => {
          throw new Error('not used in this test');
        },
        get: () => null,
        listByChannel: () => [],
        search: () => {
          throw nonFtsError;
        },
      } as unknown as MessageRepository;
      const svc = new MessageService(stubRepo);

      let caught: unknown;
      try {
        svc.search('any query');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBe(nonFtsError);
      expect(caught).not.toBeInstanceOf(InvalidQueryError);
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

  // ── searchWithContext (R10-Task2) ─────────────────────────────────

  describe('searchWithContext', () => {
    it('returns snippet + channelName + projectName for a project-scope hit', async () => {
      const project = { id: randomUUID() };
      db.prepare(
        `INSERT INTO projects (id, slug, name, kind, permission_mode, created_at)
         VALUES (?, ?, ?, 'new', 'hybrid', ?)`,
      ).run(project.id, project.id, 'Alpha', Date.now());
      const channel = { id: randomUUID() };
      insertChannel(db, channel.id, project.id, 'user', 'general');
      messageService.append({
        channelId: channel.id,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'find me pineapple easily',
      });

      const hits = messageService.searchWithContext('pineapple', {
        projectId: project.id,
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.channelName).toBe('general');
      expect(hits[0]!.projectName).toBe('Alpha');
      expect(hits[0]!.snippet).toContain('<mark>pineapple</mark>');
      expect(hits[0]!.rank).toBeLessThan(0);
    });

    it('returns projectName=null for DM (channel with project_id IS NULL)', async () => {
      seedProvider(db, 'prov-dm');
      const dm = channelService.createDm('prov-dm');
      messageService.append({
        channelId: dm.id,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'dm only raspberry content',
      });

      const hits = messageService.searchWithContext('raspberry', {
        channelId: dm.id,
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.projectName).toBeNull();
      expect(hits[0]!.channelName).toBe(dm.name);
    });

    it('propagates SearchScopeError when both scope options given', async () => {
      const { channelId, projectId } = await makeChannel();
      expect(() =>
        messageService.searchWithContext('x', { channelId, projectId }),
      ).toThrow(SearchScopeError);
    });

    it('wraps malformed FTS5 query as InvalidQueryError (same as search)', async () => {
      const { channelId } = await makeChannel();
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'indexable content',
      });
      expect(() =>
        messageService.searchWithContext('"no close quote', { channelId }),
      ).toThrow(InvalidQueryError);
    });

    it('respects the limit clamp', async () => {
      const { channelId } = await makeChannel();
      for (let i = 0; i < 4; i += 1) {
        messageService.append({
          channelId,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: `match${i} match${i}`,
        });
      }
      const hits = messageService.searchWithContext(
        'match0 OR match1 OR match2 OR match3',
        { channelId, limit: 2 },
      );
      expect(hits).toHaveLength(2);
    });

    it('orders results by bm25 ascending like search()', async () => {
      const { channelId } = await makeChannel();
      const denser = messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'avocado avocado avocado',
      });
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'just one avocado here',
      });
      const hits = messageService.searchWithContext('avocado', { channelId });
      expect(hits[0]!.id).toBe(denser.id);
      expect(hits[0]!.rank).toBeLessThanOrEqual(hits[1]!.rank);
    });
  });

  // ── listRecent (R4-Task7 RecentWidget) ────────────────────────────

  describe('listRecent', () => {
    it('returns messages newest-first with channelName + senderLabel joined', async () => {
      seedProvider(db, 'prov-x');
      const { channelId } = await makeChannel();

      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: 'first message',
      });
      // Guarantee a later created_at.
      await new Promise((resolve) => setTimeout(resolve, 5));
      messageService.append({
        channelId,
        authorId: 'prov-x',
        authorKind: 'member',
        role: 'assistant',
        content: 'member response',
      });

      const recent = messageService.listRecent();
      expect(recent).toHaveLength(2);
      // Newest first.
      expect(recent[0].excerpt).toBe('member response');
      expect(recent[0].senderLabel).toBe('Provider prov-x');
      expect(recent[0].senderKind).toBe('member');
      expect(recent[0].channelName).toBe('chat');
      // Older user row.
      expect(recent[1].senderKind).toBe('user');
      expect(recent[1].senderLabel).toBe('user');
    });

    it('truncates long content with an ellipsis', async () => {
      const { channelId } = await makeChannel();
      const long = 'a'.repeat(200);
      messageService.append({
        channelId,
        authorId: 'user',
        authorKind: 'user',
        role: 'user',
        content: long,
      });
      const [row] = messageService.listRecent();
      // RECENT_MESSAGE_EXCERPT_LEN = 140 — excerpt is 140 chars + ellipsis.
      expect(row.excerpt.endsWith('…')).toBe(true);
      expect(row.excerpt.length).toBe(141);
    });

    it('respects limit', async () => {
      const { channelId } = await makeChannel();
      for (let i = 0; i < 5; i += 1) {
        messageService.append({
          channelId,
          authorId: 'user',
          authorKind: 'user',
          role: 'user',
          content: `m${i}`,
        });
      }
      const two = messageService.listRecent(2);
      expect(two).toHaveLength(2);
    });
  });
});
