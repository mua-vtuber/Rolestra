/**
 * PermissionSet — R12-W 채널 권한 wire-up 의 공통 타입 (main / renderer /
 * preload 공유).
 *
 * R12-S `ToolGrant` (dot key — `'file.read'` 등) 은 카탈로그/시스템 프롬프트
 * 표현이고, SQLite 의 `channels` 테이블은 underscore 5컬럼 (`file_read` 등)
 * 으로 저장된다. PromptComposer 합성, ChannelService 조회, IPC round-trip
 * 모두가 이 두 표현 사이를 무손실로 오가야 한다. 본 모듈은 그 변환을 단일
 * source 로 묶고, 카탈로그 default 도 helper 한 군데로 모은다 — 직원-수준
 * 권한이 코드 여러 곳에서 재발명되지 않도록.
 *
 * 변환 계약:
 *   - `toolGrantsToPermissionSet` ↔ `permissionSetToToolGrants` 는 idempotent
 *     (왕복 시 원본과 동일). 5 axis 가 enum-닫혀있어 누락 없음.
 *   - `permissionSetFromRow` ↔ `permissionSetToRow` 는 0/1 INTEGER ↔ boolean
 *     변환만 담당 — SQLite better-sqlite3 가 boolean 을 native 로 다루지
 *     않으므로 row I/O 경계에서 한 번씩 거친다.
 *   - `catalogDefaultFor(roleId)` 는 SKILL_CATALOG 단일 source 를 통해 부서
 *     default 권한을 반환 — 채널 생성 시 권한 5컬럼 backfill 의 정본.
 *   - `catalogDefaultForNullRole()` 은 D2 (미설정 시 읽기 허용) 의 코드
 *     표현 — system 채널 / DM / role=NULL row 가 잡을 안전 기본값. 회의
 *     컨텍스트에서는 PromptComposer 가 채널 권한을 읽지 않으므로 실제
 *     사용은 schema 일관성 차원.
 */

import type { RoleId, ToolGrant } from './role-types';
import { SKILL_CATALOG } from './skill-catalog';

/**
 * 5 axis boolean. SQL row 표현 (`PermissionSetRow`) 와 카탈로그 표현
 * (`Record<ToolGrant, boolean>`) 사이의 정본 도메인 타입.
 */
export interface PermissionSet {
  fileRead: boolean;
  fileWrite: boolean;
  commandExec: boolean;
  webSearch: boolean;
  dbRead: boolean;
}

/**
 * SQLite `channels` 테이블의 권한 5컬럼 (마이그레이션 023). INTEGER 0/1
 * — boolean 으로 변환 후 사용.
 */
export interface PermissionSetRow {
  file_read: number;
  file_write: number;
  command_exec: number;
  web_search: number;
  db_read: number;
}

/** 카탈로그 dot key → 도메인 camelCase. */
export function toolGrantsToPermissionSet(
  grants: Record<ToolGrant, boolean>,
): PermissionSet {
  return {
    fileRead: grants['file.read'],
    fileWrite: grants['file.write'],
    commandExec: grants['command.exec'],
    webSearch: grants['web.search'],
    dbRead: grants['db.read'],
  };
}

/** 도메인 camelCase → 카탈로그 dot key. */
export function permissionSetToToolGrants(
  p: PermissionSet,
): Record<ToolGrant, boolean> {
  return {
    'file.read': p.fileRead,
    'file.write': p.fileWrite,
    'command.exec': p.commandExec,
    'web.search': p.webSearch,
    'db.read': p.dbRead,
  };
}

/**
 * 부서 default 권한 — `SKILL_CATALOG[roleId].toolGrants` 단일 source.
 * 채널 생성 시 권한 5컬럼 INSERT 의 정본 (T5 ChannelService).
 */
export function catalogDefaultFor(roleId: RoleId): PermissionSet {
  return toolGrantsToPermissionSet(SKILL_CATALOG[roleId].toolGrants);
}

/**
 * `role IS NULL` row (system 채널 / DM) 의 안전 기본값. D2 결재 —
 * "최소 읽기 허용". 실제 회의 발화 합성에서는 PromptComposer 가
 * channelRole=null 분기에서 권한 단락을 생략하므로 이 값은 schema
 * 일관성 및 비-회의 경로 (예: 향후 사용자 채널 권한 미지정 보호) 의 기준.
 */
export function catalogDefaultForNullRole(): PermissionSet {
  return {
    fileRead: true,
    fileWrite: false,
    commandExec: false,
    webSearch: false,
    dbRead: false,
  };
}

/** 모든 axis 가 같으면 true. 짧은 helper 라 inline 가능하지만 EventEmitter
 *  invalidation 분기 (T8) 에서 "변경 없음" 판정에 반복 호출되어 별도 export. */
export function permissionSetsEqual(
  a: PermissionSet,
  b: PermissionSet,
): boolean {
  return (
    a.fileRead === b.fileRead &&
    a.fileWrite === b.fileWrite &&
    a.commandExec === b.commandExec &&
    a.webSearch === b.webSearch &&
    a.dbRead === b.dbRead
  );
}

/** SQL row (INTEGER 0/1) → 도메인 boolean. */
export function permissionSetFromRow(row: PermissionSetRow): PermissionSet {
  return {
    fileRead: row.file_read === 1,
    fileWrite: row.file_write === 1,
    commandExec: row.command_exec === 1,
    webSearch: row.web_search === 1,
    dbRead: row.db_read === 1,
  };
}

/** 도메인 boolean → SQL row (INTEGER 0/1). better-sqlite3 가 boolean 을
 *  native 로 다루지 않으므로 INSERT/UPDATE 직전에 한 번 거친다. */
export function permissionSetToRow(p: PermissionSet): PermissionSetRow {
  return {
    file_read: p.fileRead ? 1 : 0,
    file_write: p.fileWrite ? 1 : 0,
    command_exec: p.commandExec ? 1 : 0,
    web_search: p.webSearch ? 1 : 0,
    db_read: p.dbRead ? 1 : 0,
  };
}
