/**
 * channel-permission-handler — R12-W T7 wiring 검증.
 *
 * handler 의 단일 책임은 ChannelService accessor 호출 + wire ↔ domain 변환.
 * 따라서 본 테스트는 실제 ChannelService + ChannelRepository + in-memory DB
 * stack 을 그대로 사용해 accessor 미설정 / 정상 흐름 / 미존재 channelId
 * (silent fallback 금지) 3 케이스를 검증한다. zod 검증은 router 가 wire 단
 * 책임이므로 본 layer 에서는 검증하지 않는다 (별도 ipc-schemas 테스트가 담당).
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../database/migrator';
import { migrations } from '../../../database/migrations/index';
import { ChannelRepository } from '../../../channels/channel-repository';
import {
  ChannelService,
  PERMISSION_CHANGED_EVENT,
  type PermissionChangedPayload,
} from '../../../channels/channel-service';
import { ChannelNotFoundError } from '../../../channels/channel-service';
import {
  handleChannelGetPermissions,
  handleChannelUpdatePermissions,
  setChannelPermissionServiceAccessor,
} from '../channel-permission-handler';
import {
  insertChannel,
  insertProject,
} from '../../../database/__tests__/_helpers';
import { BACKFILL_SQL } from '../../../database/migrations/023-channel-permissions';
import { catalogDefaultFor } from '../../../../shared/permission-set-types';

describe('channel-permission-handler', () => {
  let db: Database.Database;
  let svc: ChannelService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    const repo = new ChannelRepository(db);
    // ChannelService 는 ProjectMemberLookup 을 필요로 함 — handler 권한 path
    // 는 member lookup 을 사용하지 않으므로 빈 lookup 으로 충분.
    svc = new ChannelService(repo, { listMembers: () => [] });
    setChannelPermissionServiceAccessor(() => svc);

    insertProject(db, 'p1');
    insertChannel(db, 'ch-impl', 'p1', 'user', 'impl-ch');
    db.prepare(`UPDATE channels SET role='implement' WHERE id = ?`).run(
      'ch-impl',
    );
    db.exec(BACKFILL_SQL);
  });

  afterEach(() => {
    db.close();
    setChannelPermissionServiceAccessor(null as unknown as () => ChannelService);
  });

  describe('handleChannelGetPermissions', () => {
    it('returns the 5 axis flat shape matching catalogDefaultFor', () => {
      const res = handleChannelGetPermissions({ channelId: 'ch-impl' });
      const expected = catalogDefaultFor('implement');
      expect(res).toEqual({
        fileRead: expected.fileRead,
        fileWrite: expected.fileWrite,
        commandExec: expected.commandExec,
        webSearch: expected.webSearch,
        dbRead: expected.dbRead,
      });
    });

    it('throws ChannelNotFoundError for unknown channelId (silent fallback 금지)', () => {
      expect(() =>
        handleChannelGetPermissions({ channelId: 'nope-not-real' }),
      ).toThrow(ChannelNotFoundError);
    });
  });

  describe('handleChannelUpdatePermissions', () => {
    it('updates the row and emits permission-changed', () => {
      const events: PermissionChangedPayload[] = [];
      svc.on(PERMISSION_CHANGED_EVENT, (p) => events.push(p));

      const res = handleChannelUpdatePermissions({
        channelId: 'ch-impl',
        fileRead: true,
        fileWrite: false, // 사용자가 implement 의 쓰기를 off — 미세 조정.
        commandExec: true,
        webSearch: false,
        dbRead: true,
      });
      expect(res).toEqual({ ok: true });

      const after = handleChannelGetPermissions({ channelId: 'ch-impl' });
      expect(after.fileWrite).toBe(false);
      expect(after.commandExec).toBe(true);

      expect(events).toEqual([{ channelId: 'ch-impl' }]);
    });

    it('throws ChannelNotFoundError for unknown channelId without emitting', () => {
      const events: PermissionChangedPayload[] = [];
      svc.on(PERMISSION_CHANGED_EVENT, (p) => events.push(p));

      expect(() =>
        handleChannelUpdatePermissions({
          channelId: 'nope-not-real',
          fileRead: true,
          fileWrite: false,
          commandExec: false,
          webSearch: false,
          dbRead: false,
        }),
      ).toThrow(ChannelNotFoundError);
      expect(events).toEqual([]);
    });
  });

  describe('accessor lifecycle', () => {
    it('throws a descriptive error when accessor is not initialized', () => {
      setChannelPermissionServiceAccessor(
        null as unknown as () => ChannelService,
      );
      expect(() =>
        handleChannelGetPermissions({ channelId: 'ch-impl' }),
      ).toThrow(/not initialized/);
    });
  });
});
