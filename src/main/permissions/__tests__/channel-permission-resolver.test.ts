/**
 * ChannelPermissionResolver — 단일 row lookup + throwing read 검증.
 *
 * R12-W T6. v2 의 2계층 결합 (global default + project override) 로직이
 * *없음* — 채널 row 가 단일 source. 본 테스트는 그 단순성을 명문화한다.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { ChannelRepository } from '../../channels/channel-repository';
import {
  ChannelPermissionLookupError,
  ChannelPermissionResolver,
} from '../channel-permission-resolver';
import {
  catalogDefaultFor,
  catalogDefaultForNullRole,
  permissionSetsEqual,
} from '../../../shared/permission-set-types';
import {
  insertChannel,
  insertProject,
} from '../../database/__tests__/_helpers';
import { BACKFILL_SQL } from '../../database/migrations/023-channel-permissions';

describe('ChannelPermissionResolver', () => {
  let db: Database.Database;
  let repo: ChannelRepository;
  let resolver: ChannelPermissionResolver;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
    repo = new ChannelRepository(db);
    resolver = new ChannelPermissionResolver(repo);
  });

  afterEach(() => {
    db.close();
  });

  it('returns the channel row PermissionSet for a known department channel', () => {
    insertProject(db, 'p1');
    insertChannel(db, 'ch-impl', 'p1', 'user', 'impl');
    db.prepare(`UPDATE channels SET role='implement' WHERE id = ?`).run(
      'ch-impl',
    );
    // backfill 정본 (T3) 을 row 에 박는다.
    db.exec(BACKFILL_SQL);

    const got = resolver.resolve('ch-impl');
    expect(permissionSetsEqual(got, catalogDefaultFor('implement'))).toBe(true);
  });

  it('returns D2 safe default for role IS NULL row (ALTER DEFAULT applied)', () => {
    insertProject(db, 'p1');
    insertChannel(db, 'ch-sys', 'p1', 'system_general', 'system');
    // role 컬럼은 NULL 유지 — BACKFILL_SQL 대상이 아님. ALTER DEFAULT 가
    // file_read=1, 나머지 0 로 채워둠 = `catalogDefaultForNullRole()` 와 일치.

    const got = resolver.resolve('ch-sys');
    expect(permissionSetsEqual(got, catalogDefaultForNullRole())).toBe(true);
  });

  it('throws ChannelPermissionLookupError for unknown channelId (silent fallback 금지)', () => {
    expect(() => resolver.resolve('not-a-real-id')).toThrow(
      ChannelPermissionLookupError,
    );
    // message 에 id surface 되어야 디버깅이 용이.
    try {
      resolver.resolve('mystery-id');
    } catch (err) {
      expect((err as Error).message).toContain('mystery-id');
    }
  });

  it('reflects updates made through ChannelRepository.updatePermissions', () => {
    insertProject(db, 'p1');
    insertChannel(db, 'ch-idea', 'p1', 'user', 'idea-ch');
    db.prepare(`UPDATE channels SET role='idea' WHERE id = ?`).run('ch-idea');
    db.exec(BACKFILL_SQL);

    // 사용자가 채널 설정 모달에서 file_write 토글 on.
    const patched = { ...catalogDefaultFor('idea'), fileWrite: true };
    expect(repo.updatePermissions('ch-idea', patched)).toBe(true);

    const got = resolver.resolve('ch-idea');
    expect(got.fileWrite).toBe(true);
    expect(permissionSetsEqual(got, patched)).toBe(true);
  });
});
