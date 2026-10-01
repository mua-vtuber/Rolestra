/**
 * Sanity test — 마이그레이션 023 의 backfill SQL 이 SKILL_CATALOG 정본과
 * drift 없이 일치하는지 검증.
 *
 * R12-W T3 plan 본문:
 *   ADR § D3 정본 표가 코드 SKILL_CATALOG 와 *항상* 일치한다는 보장이
 *   필요하다. 둘 중 하나가 갱신되었을 때 다른 쪽이 따라오지 않으면 권한
 *   wire-up 의 single source 원칙이 무너진다. 본 테스트는 마이그레이션
 *   의 backfill UPDATE 결과를 catalogDefaultFor(roleId) 와 axis 단위로
 *   비교해 첫 격차를 즉시 fail message 로 surface 한다.
 *
 * 시나리오:
 *   1. in-memory DB + 전체 마이그레이션 chain 적용 (001~023)
 *   2. role 별 채널 row 10개 삽입 (각 RoleId × 1) — 권한 컬럼은 ALTER
 *      DEFAULT (file_read=1, 나머지 0) 로 채워짐
 *   3. 마이그레이션 023 의 BACKFILL_SQL 을 다시 실행 — UPDATE 는 idempotent
 *      이므로 멱등. 첫 chain 적용 시 backfill 이 *기존 row* 만 영향을 줬다는
 *      가정과 무관하게, 본 테스트의 row 도 동일 카탈로그 default 로 정착해야 한다.
 *   4. 각 row 의 5 axis SELECT → catalogDefaultFor(role) 와 1:1 비교
 *
 * Drift 발견 시 명시 fail message:
 *   "code SKILL_CATALOG drift from migration 023 — role=X, axis=Y,
 *    code=true, migration=false"
 *
 * Forward-only invariant: 본 sanity 가 fail 하면 마이그레이션 023 의
 * BACKFILL_SQL 을 카탈로그에 맞춰 정정 *해야 한다* (마이그레이션은
 * land 전 immutability 가드를 우회할 수 있는 유일한 시점이 land 직전
 * sanity 단계 한정). land 후 drift 가 새로 도입되면 별도 forward
 * 마이그레이션 (024+) 으로 backfill 보강 — 023 자체 수정 금지.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { BACKFILL_SQL } from '../migrations/023-channel-permissions';
import { insertChannel, insertProject } from './_helpers';
import { ALL_ROLE_IDS } from '../../../shared/role-types';
import { catalogDefaultFor } from '../../../shared/permission-set-types';
import type { PermissionSetRow } from '../../../shared/permission-set-types';
import {
  permissionSetFromRow,
  permissionSetsEqual,
} from '../../../shared/permission-set-types';

describe('migration 023 — backfill SQL ↔ SKILL_CATALOG drift sanity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('every RoleId row matches catalogDefaultFor(role) axis-by-axis after backfill', () => {
    insertProject(db, 'p-sanity');

    // role 별 row 10개 삽입 (각 RoleId × 1). channels INSERT 는 권한 5컬럼
    // 미명시 — ALTER DEFAULT 가 적용된 상태 (file_read=1, 나머지 0).
    // 별 SQL 한 줄로 role 컬럼만 UPDATE 해서 role 매칭 backfill 의 대상이
    // 되도록 만든다.
    for (const roleId of ALL_ROLE_IDS) {
      const channelId = `ch-${roleId}`;
      insertChannel(db, channelId, 'p-sanity', 'user', `name-${roleId}`);
      db.prepare(`UPDATE channels SET role = ? WHERE id = ?`).run(
        roleId,
        channelId,
      );
    }

    // 마이그레이션 023 의 backfill 을 한 번 더 실행 — UPDATE 는 멱등.
    // (chain idempotency 가드는 마이그레이션 id 기준이라 이 row 들은
    // 첫 chain 적용 *후* 삽입됐으므로 backfill 이 미적용 상태. 본 SQL
    // 호출이 backfill 실 효과를 row 에 박는다.)
    db.exec(BACKFILL_SQL);

    // 각 row SELECT + 카탈로그 정본 비교.
    const select = db.prepare<[string], PermissionSetRow>(`
      SELECT file_read, file_write, command_exec, web_search, db_read
        FROM channels
       WHERE id = ?
    `);

    for (const roleId of ALL_ROLE_IDS) {
      const row = select.get(`ch-${roleId}`);
      expect(row, `row missing for role=${roleId}`).toBeDefined();

      const actual = permissionSetFromRow(row!);
      const expected = catalogDefaultFor(roleId);

      // axis 단위 단언 — drift 발견 시 어느 axis 가 잘못된지 message 에 surface.
      const axes: Array<keyof typeof actual> = [
        'fileRead',
        'fileWrite',
        'commandExec',
        'webSearch',
        'dbRead',
      ];
      for (const axis of axes) {
        expect(
          actual[axis],
          `code SKILL_CATALOG drift from migration 023 — ` +
            `role=${roleId}, axis=${axis}, code=${expected[axis]}, ` +
            `migration=${actual[axis]}`,
        ).toBe(expected[axis]);
      }

      // 추가 sanity — set 단위 equality 도 일치.
      expect(
        permissionSetsEqual(actual, expected),
        `set-level drift for role=${roleId}`,
      ).toBe(true);
    }
  });

  it('role IS NULL row keeps ALTER DEFAULT (file_read=1, 나머지 0)', () => {
    // system 채널 / DM 시뮬레이션 — role=NULL 인 row 는 BACKFILL_SQL 의
    // WHERE 절에 매칭되지 않으므로 ALTER DEFAULT 가 그대로 유지되어야 한다.
    insertProject(db, 'p-null');
    insertChannel(db, 'ch-null', 'p-null', 'system_general', 'general');
    // role 컬럼은 default NULL 유지.

    db.exec(BACKFILL_SQL);

    const row = db
      .prepare<[string], PermissionSetRow>(
        `SELECT file_read, file_write, command_exec, web_search, db_read
           FROM channels WHERE id = ?`,
      )
      .get('ch-null');
    expect(row).toBeDefined();
    expect(row!.file_read).toBe(1);
    expect(row!.file_write).toBe(0);
    expect(row!.command_exec).toBe(0);
    expect(row!.web_search).toBe(0);
    expect(row!.db_read).toBe(0);
  });

  it('023 is registered at chain index 22 (forward-only chain 무손상)', () => {
    // 022 까지가 22 index (0-based) 라 023 은 23 번째.
    expect(migrations.length).toBeGreaterThanOrEqual(23);
    expect(migrations[22]?.id).toBe('023-channel-permissions');
  });
});
