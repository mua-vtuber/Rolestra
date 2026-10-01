/**
 * 029-notification-kinds-r12c2 스키마 계약 시험.
 *
 * 029 는 015 와 같은 "새 표를 만들고 옮겨 담고 바꿔치기" 방식이다.
 * `notification_prefs.key` 의 CHECK 목록을 여섯 종류에서 아홉 종류로
 * 넓힌다. SQLite 는 CHECK 하나만 바꾸는 명령이 없다.
 *
 * 이 방식이 조용히 망가지는 길은 하나다 — 2 단계 INSERT ... SELECT 의
 * 컬럼 순서가 어긋나면 SQL 은 멀쩡히 돌지만 값이 엉뚱한 칸에 들어간다.
 * 그러면 사용자가 꺼 둔 알림이 켜지거나, 소리 설정이 표시 설정 자리로
 * 옮겨 간다. 그래서 값 단위로 (key ↔ enabled ↔ sound_enabled 짝) 보존을
 * 확인한다.
 *
 * 방법: 028 까지만 적용한 상태에서 사용자가 손댄 pref row 를 넣고, 029 만
 * 따로 돌린 뒤 모든 row 가 값 그대로 남았는지 본다. migration 본문은
 * 손대지 않고 그대로 실행한다.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import { migration as migration029 } from '../migrations/029-notification-kinds-r12c2';
import { NOTIFICATION_KINDS } from '../../notifications/notification-repository';
import { tableExists } from './_helpers';

interface PrefRow {
  key: string;
  enabled: number;
  sound_enabled: number;
}

/** 029 이전 여섯 종류 — 011 의 CHECK 목록 그대로. */
const LEGACY_KINDS = [
  'new_message',
  'approval_pending',
  'work_done',
  'error',
  'queue_progress',
  'meeting_state',
] as const;

/** 029 이 더하는 세 종류. */
const NEW_KINDS = [
  'handoff_auto_review',
  'queue_item_started',
  'audit_result',
] as const;

function insertPref(
  db: Database.Database,
  key: string,
  enabled: number,
  soundEnabled: number,
): void {
  db.prepare(
    `INSERT INTO notification_prefs (key, enabled, sound_enabled)
     VALUES (?, ?, ?)`,
  ).run(key, enabled, soundEnabled);
}

function selectPrefs(db: Database.Database): PrefRow[] {
  return db
    .prepare('SELECT key, enabled, sound_enabled FROM notification_prefs ORDER BY key')
    .all() as PrefRow[];
}

/** 029 을 뺀 전체 chain — migrations 배열의 마지막 항목이 029 다. */
function migrationsBefore029() {
  const index = migrations.findIndex((m) => m.id === migration029.id);
  expect(index).toBeGreaterThan(-1);
  return migrations.slice(0, index);
}

describe('029-notification-kinds-r12c2 — 표 재구성 무결성', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrationsBefore029());
  });

  afterEach(() => {
    db.close();
  });

  it('029 이전에는 새 종류 insert 가 CHECK 로 막힌다', () => {
    expect(tableExists(db, 'notification_prefs')).toBe(true);
    for (const kind of NEW_KINDS) {
      expect(() => insertPref(db, kind, 1, 1), kind).toThrow();
    }
  });

  it('029 이후에는 아홉 종류가 모두 들어간다', () => {
    runMigrations(db, [migration029]);

    for (const kind of [...LEGACY_KINDS, ...NEW_KINDS]) {
      expect(() => insertPref(db, kind, 1, 1), kind).not.toThrow();
    }
    expect(selectPrefs(db)).toHaveLength(9);
  });

  it('029 이후에도 모르는 종류는 여전히 막힌다', () => {
    runMigrations(db, [migration029]);

    expect(() => insertPref(db, 'not_a_kind', 1, 1)).toThrow();
  });

  it('사용자가 손댄 설정이 값 그대로 옮겨진다 (row 손실 X)', () => {
    // 여섯 종류 각각 다른 조합 — 컬럼이 어긋나면 짝이 깨진다.
    insertPref(db, 'new_message', 1, 1);
    insertPref(db, 'approval_pending', 0, 1);
    insertPref(db, 'work_done', 1, 0);
    insertPref(db, 'error', 0, 0);
    insertPref(db, 'queue_progress', 0, 1);
    insertPref(db, 'meeting_state', 1, 0);

    runMigrations(db, [migration029]);

    expect(selectPrefs(db)).toEqual([
      { key: 'approval_pending', enabled: 0, sound_enabled: 1 },
      { key: 'error', enabled: 0, sound_enabled: 0 },
      { key: 'meeting_state', enabled: 1, sound_enabled: 0 },
      { key: 'new_message', enabled: 1, sound_enabled: 1 },
      { key: 'queue_progress', enabled: 0, sound_enabled: 1 },
      { key: 'work_done', enabled: 1, sound_enabled: 0 },
    ]);
  });

  it('빈 표에서도 통과한다 (첫 기동 경로)', () => {
    expect(selectPrefs(db)).toHaveLength(0);
    runMigrations(db, [migration029]);
    expect(selectPrefs(db)).toHaveLength(0);
  });

  it('임시 표 이름이 남지 않는다', () => {
    runMigrations(db, [migration029]);
    expect(tableExists(db, 'notification_prefs_v2')).toBe(false);
    expect(tableExists(db, 'notification_prefs')).toBe(true);
  });

  it('key 는 여전히 PRIMARY KEY — 같은 종류가 두 번 들어가지 않는다', () => {
    runMigrations(db, [migration029]);
    insertPref(db, 'audit_result', 1, 1);
    expect(() => insertPref(db, 'audit_result', 0, 0)).toThrow();
  });

  it('기본값은 켜짐 — 컬럼 DEFAULT 가 보존된다', () => {
    runMigrations(db, [migration029]);
    db.prepare(`INSERT INTO notification_prefs (key) VALUES ('audit_result')`).run();
    expect(selectPrefs(db)).toEqual([
      { key: 'audit_result', enabled: 1, sound_enabled: 1 },
    ]);
  });
});

describe('029 — 전체 chain 적용 후', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('NOTIFICATION_KINDS 의 모든 종류가 CHECK 를 통과한다', () => {
    // 이 단언이 깨지면 코드가 아는 종류와 DB 가 허용하는 종류가 갈라진
    // 것이다 — 그 상태에서는 새 종류의 알림 설정 row 가 insert 되지 않아
    // 사용자가 그 알림을 끌 수 없다.
    for (const kind of NOTIFICATION_KINDS) {
      expect(() => insertPref(db, kind, 1, 1), kind).not.toThrow();
    }
    expect(selectPrefs(db)).toHaveLength(NOTIFICATION_KINDS.length);
  });

  it('다시 돌려도 안전하다 (migrator 가 중복 적용 안 함)', () => {
    insertPref(db, 'audit_result', 0, 0);
    runMigrations(db, migrations);
    expect(selectPrefs(db)).toEqual([
      { key: 'audit_result', enabled: 0, sound_enabled: 0 },
    ]);
  });
});
