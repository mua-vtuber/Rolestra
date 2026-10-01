/**
 * permission-set-types — 변환 idempotency + 카탈로그 default 5 케이스.
 *
 * 본 테스트는 R12-W T2 가 land 한 공통 helper 의 단일 source 성격을
 * 검증한다 — 카탈로그 `toolGrants` 와 도메인 `PermissionSet`, 그리고
 * SQL row 표현 사이의 변환이 무손실인지, 그리고 `catalogDefaultFor` 가
 * `SKILL_CATALOG` 정본과 drift 없는지.
 *
 * 마이그레이션 023 (T3) 의 backfill SQL 도 같은 카탈로그를 정본으로
 * 삼는다 — drift 발견은 023 sanity 테스트가 추가로 잡지만, 본 테스트는
 * helper 레벨에서 먼저 잡는다.
 */

import { describe, it, expect } from 'vitest';
import {
  toolGrantsToPermissionSet,
  permissionSetToToolGrants,
  catalogDefaultFor,
  catalogDefaultForNullRole,
  permissionSetsEqual,
  permissionSetFromRow,
  permissionSetToRow,
  type PermissionSet,
  type PermissionSetRow,
} from '../permission-set-types';
import { SKILL_CATALOG } from '../skill-catalog';
import { ALL_ROLE_IDS } from '../role-types';

describe('permission-set-types', () => {
  describe('toolGrantsToPermissionSet ↔ permissionSetToToolGrants', () => {
    it('round-trips for every RoleId in the catalog', () => {
      // ALL_ROLE_IDS 전체에 대해 왕복 시 원본과 동일해야 한다 — 5 axis
      // enum 닫힘이 깨지면 (예: 새 ToolGrant 추가 시 helper 갱신 누락)
      // 본 테스트가 즉시 fail.
      for (const roleId of ALL_ROLE_IDS) {
        const original = SKILL_CATALOG[roleId].toolGrants;
        const set = toolGrantsToPermissionSet(original);
        const back = permissionSetToToolGrants(set);
        expect(back, `round-trip mismatch for role=${roleId}`).toEqual(
          original,
        );
      }
    });
  });

  describe('catalogDefaultFor — 5 cases', () => {
    it('idea = READ_PLUS_WEB (db.read + web.search)', () => {
      const p = catalogDefaultFor('idea');
      const g = SKILL_CATALOG.idea.toolGrants;
      expect(p.dbRead).toBe(g['db.read']);
      expect(p.webSearch).toBe(g['web.search']);
      expect(p.fileWrite).toBe(g['file.write']);
    });

    it('implement = file.write + command.exec', () => {
      const p = catalogDefaultFor('implement');
      const g = SKILL_CATALOG.implement.toolGrants;
      expect(p.fileWrite).toBe(g['file.write']);
      expect(p.commandExec).toBe(g['command.exec']);
    });

    it('design.ui = READ_ONLY (db.read only)', () => {
      const p = catalogDefaultFor('design.ui');
      const g = SKILL_CATALOG['design.ui'].toolGrants;
      expect(p.dbRead).toBe(g['db.read']);
      expect(p.webSearch).toBe(g['web.search']);
      expect(p.fileWrite).toBe(g['file.write']);
    });

    it('audit catalog matches helper output axis-by-axis', () => {
      const p = catalogDefaultFor('audit');
      const g = SKILL_CATALOG.audit.toolGrants;
      expect(p.fileRead).toBe(g['file.read']);
      expect(p.fileWrite).toBe(g['file.write']);
      expect(p.commandExec).toBe(g['command.exec']);
      expect(p.webSearch).toBe(g['web.search']);
      expect(p.dbRead).toBe(g['db.read']);
    });

    it('general catalog matches helper output axis-by-axis', () => {
      const p = catalogDefaultFor('general');
      const g = SKILL_CATALOG.general.toolGrants;
      expect(p.fileRead).toBe(g['file.read']);
      expect(p.fileWrite).toBe(g['file.write']);
      expect(p.commandExec).toBe(g['command.exec']);
      expect(p.webSearch).toBe(g['web.search']);
      expect(p.dbRead).toBe(g['db.read']);
    });
  });

  describe('catalogDefaultForNullRole — D2 안전 측', () => {
    it('returns read-only baseline (file_read=true, 나머지 false)', () => {
      const p = catalogDefaultForNullRole();
      expect(p.fileRead).toBe(true);
      expect(p.fileWrite).toBe(false);
      expect(p.commandExec).toBe(false);
      expect(p.webSearch).toBe(false);
      expect(p.dbRead).toBe(false);
    });

    it('is stable across calls (pure)', () => {
      const a = catalogDefaultForNullRole();
      const b = catalogDefaultForNullRole();
      expect(permissionSetsEqual(a, b)).toBe(true);
    });
  });

  describe('permissionSetsEqual', () => {
    const base: PermissionSet = {
      fileRead: true,
      fileWrite: false,
      commandExec: false,
      webSearch: true,
      dbRead: true,
    };

    it('returns true for identical sets', () => {
      const a = { ...base };
      const b = { ...base };
      expect(permissionSetsEqual(a, b)).toBe(true);
    });

    it('returns false when any single axis differs', () => {
      const axes: Array<keyof PermissionSet> = [
        'fileRead',
        'fileWrite',
        'commandExec',
        'webSearch',
        'dbRead',
      ];
      for (const axis of axes) {
        const flipped: PermissionSet = { ...base, [axis]: !base[axis] };
        expect(
          permissionSetsEqual(base, flipped),
          `equality should fail when ${axis} flips`,
        ).toBe(false);
      }
    });
  });

  describe('permissionSetFromRow ↔ permissionSetToRow', () => {
    it('round-trips 0/1 → boolean → 0/1 (mixed pattern)', () => {
      const row: PermissionSetRow = {
        file_read: 1,
        file_write: 0,
        command_exec: 1,
        web_search: 0,
        db_read: 1,
      };
      const set = permissionSetFromRow(row);
      expect(set.fileRead).toBe(true);
      expect(set.fileWrite).toBe(false);
      expect(set.commandExec).toBe(true);
      expect(set.webSearch).toBe(false);
      expect(set.dbRead).toBe(true);

      const back = permissionSetToRow(set);
      expect(back).toEqual(row);
    });

    it('round-trips all-zeros and all-ones', () => {
      const zeros: PermissionSetRow = {
        file_read: 0,
        file_write: 0,
        command_exec: 0,
        web_search: 0,
        db_read: 0,
      };
      const ones: PermissionSetRow = {
        file_read: 1,
        file_write: 1,
        command_exec: 1,
        web_search: 1,
        db_read: 1,
      };
      expect(permissionSetToRow(permissionSetFromRow(zeros))).toEqual(zeros);
      expect(permissionSetToRow(permissionSetFromRow(ones))).toEqual(ones);
    });

    it('treats non-1 INTEGER as false (defensive against SQLite quirks)', () => {
      // better-sqlite3 의 INTEGER 가 어떤 이유로 2 / -1 / NaN 등이 들어와도
      // 1 이 아니면 false 로 해석 — CHECK constraint 가 0/1 강제하지만
      // 방어 코드가 곱셈 효과를 막는다.
      const odd: PermissionSetRow = {
        file_read: 2,
        file_write: 0,
        command_exec: 0,
        web_search: 0,
        db_read: 0,
      };
      const set = permissionSetFromRow(odd);
      expect(set.fileRead).toBe(false);
    });
  });
});
