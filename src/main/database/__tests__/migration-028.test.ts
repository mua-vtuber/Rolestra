/**
 * Schema contract tests for v3 migration 028-department-audit-role
 * (R12-W ruling R26 — 기본 부서 `검토` 채널의 role 을 review → audit 정정).
 *
 * 실제 업그레이드 경로를 그대로 재현한다:
 *   1. 027 까지의 chain 만 적용 (028 land 이전 상태의 DB)
 *   2. 그 시점에 만들어졌을 row 를 심는다 — 잘못된 `검토`/review row,
 *      사용자가 권한을 직접 조정한 `검토`/review row, 손대면 안 되는
 *      `리뷰`/review row
 *   3. 전체 chain 을 적용 (028 만 pending) → 결과 검사
 *
 * Coverage:
 * - `검토` + role='review' row 가 role='audit' 로 정정된다
 * - 그 row 의 권한이 리뷰 default 그대로였다면 검토 default 로 이동한다
 * - 사용자가 손댄 권한은 그대로 유지되고 role 만 정정된다
 * - 이름이 `리뷰` 인 review 채널은 role / 권한 모두 무손상
 * - role IS NULL row (system 채널) 무손상
 * - 마이그레이션의 권한 리터럴이 SKILL_CATALOG 정본과 일치 (drift sanity)
 * - 028 이 chain index 27 에 기록됨
 * - 두 번 실행해도 결과가 같다 (멱등)
 *
 * In-memory SQLite + PRAGMA foreign_keys=ON mirrors production `connection.ts`.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import {
  PERMISSION_MIGRATE_SQL,
  ROLE_MIGRATE_SQL,
} from '../migrations/028-department-audit-role';
import { insertChannel, insertProject } from './_helpers';
import {
  catalogDefaultFor,
  permissionSetFromRow,
} from '../../../shared/permission-set-types';
import type {
  PermissionSet,
  PermissionSetRow,
} from '../../../shared/permission-set-types';

const MIGRATION_ID = '028-department-audit-role';

/** 028 을 뺀 chain — 마이그레이션 land 이전의 DB 상태를 만든다. */
const CHAIN_BEFORE_028 = migrations.filter((m) => m.id !== MIGRATION_ID);

interface ChannelRoleRow extends PermissionSetRow {
  role: string | null;
}

function seedChannel(
  db: Database.Database,
  id: string,
  name: string,
  role: string | null,
  permissions: PermissionSet,
): void {
  insertChannel(db, id, 'p-028', 'user', name);
  db.prepare(
    `UPDATE channels
        SET role = ?, file_read = ?, file_write = ?,
            command_exec = ?, web_search = ?, db_read = ?
      WHERE id = ?`,
  ).run(
    role,
    permissions.fileRead ? 1 : 0,
    permissions.fileWrite ? 1 : 0,
    permissions.commandExec ? 1 : 0,
    permissions.webSearch ? 1 : 0,
    permissions.dbRead ? 1 : 0,
    id,
  );
}

function readChannel(db: Database.Database, id: string): ChannelRoleRow {
  const row = db
    .prepare<[string], ChannelRoleRow>(
      `SELECT role, file_read, file_write, command_exec, web_search, db_read
         FROM channels WHERE id = ?`,
    )
    .get(id);
  if (!row) throw new Error(`channel row missing: ${id}`);
  return row;
}

describe('migration 028 — 검토 채널 role review → audit 정정', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // 028 land 이전 상태까지만 올린다.
    runMigrations(db, CHAIN_BEFORE_028);
    insertProject(db, 'p-028');
  });

  afterEach(() => {
    db.close();
  });

  it('검토/review row 의 role 과 권한이 모두 audit 정본으로 이동한다', () => {
    seedChannel(db, 'ch-audit', '검토', 'review', catalogDefaultFor('review'));

    runMigrations(db, migrations);

    const row = readChannel(db, 'ch-audit');
    expect(row.role).toBe('audit');
    expect(permissionSetFromRow(row)).toEqual(catalogDefaultFor('audit'));
  });

  it('사용자가 직접 조정한 권한은 유지하고 role 만 정정한다', () => {
    // 리뷰 default 에서 web_search 만 꺼 둔 상태 — 사용자 의도가 남아 있다.
    const tuned: PermissionSet = {
      ...catalogDefaultFor('review'),
      webSearch: false,
    };
    seedChannel(db, 'ch-tuned', '검토', 'review', tuned);

    runMigrations(db, migrations);

    const row = readChannel(db, 'ch-tuned');
    expect(row.role).toBe('audit');
    expect(permissionSetFromRow(row)).toEqual(tuned);
  });

  it('이름이 리뷰 인 review 채널은 role / 권한 모두 건드리지 않는다', () => {
    seedChannel(db, 'ch-review', '리뷰', 'review', catalogDefaultFor('review'));

    runMigrations(db, migrations);

    const row = readChannel(db, 'ch-review');
    expect(row.role).toBe('review');
    expect(permissionSetFromRow(row)).toEqual(catalogDefaultFor('review'));
  });

  it('role IS NULL row (system 채널) 은 무손상', () => {
    insertChannel(db, 'ch-sys', 'p-028', 'system_minutes', '회의록');

    runMigrations(db, migrations);

    const row = readChannel(db, 'ch-sys');
    expect(row.role).toBeNull();
    expect(row.file_read).toBe(1);
    expect(row.file_write).toBe(0);
    expect(row.command_exec).toBe(0);
    expect(row.web_search).toBe(0);
    expect(row.db_read).toBe(0);
  });

  it('두 번 실행해도 결과가 같다 (멱등)', () => {
    seedChannel(db, 'ch-audit', '검토', 'review', catalogDefaultFor('review'));

    runMigrations(db, migrations);
    const first = readChannel(db, 'ch-audit');

    // chain 재실행은 028 을 skip 한다. SQL 을 직접 한 번 더 돌려도 결과가
    // 같아야 진짜 멱등 — WHERE 절이 이미 정정된 row 를 다시 잡지 않는다.
    expect(() => runMigrations(db, migrations)).not.toThrow();
    db.exec(PERMISSION_MIGRATE_SQL);
    db.exec(ROLE_MIGRATE_SQL);

    expect(readChannel(db, 'ch-audit')).toEqual(first);
  });

  it('마이그레이션 권한 리터럴이 SKILL_CATALOG 정본과 일치한다', () => {
    // 028 은 "리뷰 default 인 row 만 검토 default 로" 옮긴다. 두 default 중
    // 하나라도 카탈로그와 어긋나면 WHERE 절이 대상을 놓치거나 SET 이
    // 잘못된 값을 쓴다 — 023 sanity 와 같은 취지의 drift 감시.
    const review = catalogDefaultFor('review');
    const audit = catalogDefaultFor('audit');

    // WHERE 절이 기대하는 리뷰 default.
    expect(review).toEqual({
      fileRead: true,
      fileWrite: false,
      commandExec: false,
      webSearch: true,
      dbRead: true,
    });
    // SET 이 만들어 내는 검토 default. 두 축만 바꾸므로 나머지 세 축은
    // 리뷰와 같아야 한다.
    expect(audit).toEqual({
      fileRead: true,
      fileWrite: false,
      commandExec: true,
      webSearch: false,
      dbRead: true,
    });
    expect(audit.fileRead).toBe(review.fileRead);
    expect(audit.fileWrite).toBe(review.fileWrite);
    expect(audit.dbRead).toBe(review.dbRead);
  });

  it('028 이 chain index 27 에 등록돼 있다 (forward-only chain 무손상)', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(28);
    expect(migrations[27]?.id).toBe(MIGRATION_ID);
  });
});
