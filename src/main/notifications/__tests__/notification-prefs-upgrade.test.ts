/**
 * 쓰던 설치본이 새 알림 종류의 설정 row 를 받는가 — R12-C2 T30/T34.
 *
 * migration 029 가 `notification_prefs.key` 의 CHECK 를 여섯에서 아홉으로
 * 넓혔지만, CHECK 를 넓힌 것만으로는 row 가 생기지 않는다. 이미 앱을 쓰던
 * 사용자는 여섯 종류 row 만 갖고 있고, 그 상태로는 새 알림 세 종류를 끌
 * 방법이 없다 (설정 화면이 row 를 못 찾는다).
 *
 * `seedDefaultPrefsIfEmpty` 는 이름과 달리 "표가 비었을 때만" 이 아니라
 * "빠진 종류만" 채운다. 이 시험이 그 동작을 실제 SQLite 로 고정한다 —
 * 이름만 보고 "비었을 때만 돈다" 로 고치면 여기서 실패한다.
 *
 * 확인:
 *   1. 여섯 종류만 있던 표에 seed 를 돌리면 새 세 종류만 생긴다.
 *   2. 사용자가 꺼 둔 기존 설정은 그대로 남는다.
 *   3. 새로 생긴 row 는 기본값 (켜짐 / 소리 켜짐) 이다.
 *   4. 한 번 더 돌리면 아무 것도 생기지 않는다 (멱등).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import {
  NotificationRepository,
  NOTIFICATION_KINDS,
} from '../notification-repository';

/** migration 011 시절의 여섯 종류 — 쓰던 설치본이 갖고 있던 목록. */
const PRE_R12C2_KINDS = [
  'new_message',
  'approval_pending',
  'work_done',
  'error',
  'queue_progress',
  'meeting_state',
] as const;

/** R12-C2 가 더한 세 종류. */
const R12C2_KINDS = [
  'handoff_auto_review',
  'queue_item_started',
  'audit_result',
] as const;

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, migrations);
  // 마이그레이션이 채워 둔 row 를 지워 "쓰던 설치본" 상태를 만든다.
  db.prepare('DELETE FROM notification_prefs').run();
  const insert = db.prepare(
    `INSERT INTO notification_prefs (key, enabled, sound_enabled) VALUES (?, 1, 1)`,
  );
  for (const kind of PRE_R12C2_KINDS) insert.run(kind);
});

afterEach(() => {
  db.close();
});

describe('쓰던 설치본의 알림 설정 갱신 (R12-C2)', () => {
  it('여섯 종류만 있던 표에 새 세 종류만 생긴다', () => {
    const repo = new NotificationRepository(db);

    const inserted = repo.seedDefaultPrefsIfEmpty();

    expect(inserted).toBe(R12C2_KINDS.length);
    const keys = (
      db.prepare('SELECT key FROM notification_prefs').all() as {
        key: string;
      }[]
    ).map((r) => r.key);
    expect(keys.sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('사용자가 꺼 둔 기존 설정은 그대로 남는다', () => {
    db.prepare(
      `UPDATE notification_prefs SET enabled = 0, sound_enabled = 0 WHERE key = 'new_message'`,
    ).run();
    const repo = new NotificationRepository(db);

    repo.seedDefaultPrefsIfEmpty();

    const prefs = repo.getPrefs();
    expect(prefs.new_message).toEqual({ enabled: false, soundEnabled: false });
  });

  it('새로 생긴 세 종류는 기본값으로 켜져 있다', () => {
    const repo = new NotificationRepository(db);

    repo.seedDefaultPrefsIfEmpty();

    const prefs = repo.getPrefs();
    for (const kind of R12C2_KINDS) {
      expect(prefs[kind], kind).toEqual({ enabled: true, soundEnabled: true });
    }
  });

  it('한 번 더 돌리면 아무 것도 생기지 않는다', () => {
    const repo = new NotificationRepository(db);
    repo.seedDefaultPrefsIfEmpty();

    expect(repo.seedDefaultPrefsIfEmpty()).toBe(0);
  });
});
