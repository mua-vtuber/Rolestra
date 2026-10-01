/**
 * Unit tests for provider-repository — R12-S Task 5.
 *
 * roles + skill_overrides 컬럼 read/write 정상 동작 확인. 기존 컬럼
 * (id / kind / display_name / config_json) 은 R10 까지의 회귀 테스트
 * (ipc-provider-roundtrip) 로 보장 — 본 spec 은 R12-S 신규 필드만 검증.
 *
 * F3 STEP 3b (spec 2026-09-29-ai-setup-and-character.md, QA defect):
 * `saveProvider` 는 더 이상 `persona` 파라미터를 받지 않는다 — UPDATE
 * 경로가 `persona` 컬럼을 SET 목록에서 아예 빼서, 기존 row 의 값이
 * (member:rename 처럼 다른 컬럼만 바뀌는 호출에서도) 항상 그대로 남는다.
 * 이 파일 맨 아래 "persona column preservation" describe 블록이 그
 * 회귀를 직접 검증한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations';
import type { ProviderConfig } from '../../../shared/provider-types';

let db: Database.Database;

vi.mock('../../database/connection', () => ({
  getDatabase: () => db,
}));

import { saveProvider, loadAllProviders, removeProvider } from '../provider-repository';
import { parseDepartmentHeadMap } from '../department-head-map';

const SAMPLE_API_CONFIG: ProviderConfig = {
  type: 'api',
  endpoint: 'https://api.example.com',
  apiKeyRef: 'k',
  model: 'sonnet',
};

describe('provider-repository — R12-S roles + skill_overrides', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('saves and loads roles + skill_overrides as JSON strings', () => {
    saveProvider(
      'p1',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['planning', 'design.ui'],
      { planning: '커스텀 PM 프롬프트' },
      {},
    );

    const rows = loadAllProviders();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('p1');
    expect(rows[0].roles).toBe('["planning","design.ui"]');
    expect(rows[0].skillOverrides).toBe('{"planning":"커스텀 PM 프롬프트"}');
  });

  it('persists empty roles and null skill_overrides as defaults', () => {
    saveProvider(
      'p2',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      [],
      null,
      {},
    );

    const rows = loadAllProviders();
    expect(rows[0].roles).toBe('[]');
    expect(rows[0].skillOverrides).toBeNull();
  });

  it('upserts roles on conflict (UPDATE path)', () => {
    saveProvider('p3', 'api', 'Test', SAMPLE_API_CONFIG, ['idea'], null, {});
    saveProvider(
      'p3',
      'api',
      'Test',
      SAMPLE_API_CONFIG,
      ['planning'],
      { planning: 'override' },
      {},
    );

    const rows = loadAllProviders();
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toBe('["planning"]');
    expect(rows[0].skillOverrides).toBe('{"planning":"override"}');
  });

  // R12-C2 T36 — is_department_head 컬럼 round-trip. 018 이 컬럼만 만들고
  // 아무도 읽지 않아, 부서장을 지정해도 재시작하면 사라졌다.
  it('saves and loads the department head pin map', () => {
    saveProvider(
      'p-head',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['planning', 'design.ux'],
      null,
      { planning: true, 'design.ux': false },
    );

    const rows = loadAllProviders();
    expect(rows).toHaveLength(1);
    // false 는 "부서장 아님" 이라 저장하지 않는다 — 컬럼이 커지지 않고
    // resolver 의 === true 검사와 결과가 같다.
    expect(rows[0].isDepartmentHead).toBe('{"planning":true}');
    expect(parseDepartmentHeadMap(rows[0].isDepartmentHead, 'p-head')).toEqual({
      planning: true,
    });
  });

  it('defaults the pin map to an empty object', () => {
    saveProvider(
      'p-nohead',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['idea'],
      null,
      {},
    );

    expect(loadAllProviders()[0].isDepartmentHead).toBe('{}');
  });

  it('upsert overwrites the pin map (UPDATE path)', () => {
    saveProvider(
      'p-up',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['planning'],
      null,
      { planning: true },
    );
    saveProvider(
      'p-up',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['planning'],
      null,
      {},
    );

    expect(loadAllProviders()[0].isDepartmentHead).toBe('{}');
  });

  it('a corrupted pin column throws with the provider id, never silently empties', () => {
    saveProvider(
      'p-broken',
      'api',
      'Claude',
      SAMPLE_API_CONFIG,
      ['planning'],
      null,
      { planning: true },
    );
    db.prepare(
      `UPDATE providers SET is_department_head = ? WHERE id = ?`,
    ).run('{oops', 'p-broken');

    const row = loadAllProviders()[0];
    expect(() =>
      parseDepartmentHeadMap(row.isDepartmentHead, row.id),
    ).toThrow(/p-broken/);
  });

  it('removeProvider deletes the row including roles', () => {
    saveProvider('p4', 'api', 'X', SAMPLE_API_CONFIG, ['general'], null, {});
    expect(loadAllProviders()).toHaveLength(1);

    removeProvider('p4');
    expect(loadAllProviders()).toHaveLength(0);
  });

  // F3 STEP 3b (spec 2026-09-29-ai-setup-and-character.md, QA defect):
  // saveProvider no longer takes a persona parameter, and its UPDATE
  // leaves the `persona` column out of the SET list entirely — this is
  // the regression the coordinator asked to pin down: a rename (or any
  // other saveProvider call that only changes OTHER columns) must never
  // blank out a pre-F3 row's stored legacy persona text.
  describe('persona column preservation (F3 STEP 3b)', () => {
    it('a saveProvider call that changes only displayName leaves a pre-existing persona value untouched', () => {
      // Seed a row the way a pre-F3 install could have one: a real
      // legacy persona value written directly at the DB layer (this
      // simulates data saveProvider itself can no longer produce, which
      // is exactly the point — the column still holds history from
      // before this change).
      saveProvider('p-legacy', 'api', 'Old Name', SAMPLE_API_CONFIG, ['planning'], null, {});
      db.prepare('UPDATE providers SET persona = ? WHERE id = ?')
        .run('Please be a curious friend.', 'p-legacy');
      expect(
        (db.prepare('SELECT persona FROM providers WHERE id = ?').get('p-legacy') as { persona: string }).persona,
      ).toBe('Please be a curious friend.');

      // Simulate member:rename: same id, only displayName differs, same
      // roles/skill_overrides/isDepartmentHead carried forward (mirrors
      // member-handler.ts's handleMemberRename).
      saveProvider('p-legacy', 'api', 'New Name', SAMPLE_API_CONFIG, ['planning'], null, {});

      const persisted = db.prepare('SELECT display_name AS displayName, persona FROM providers WHERE id = ?')
        .get('p-legacy') as { displayName: string; persona: string };
      expect(persisted.displayName).toBe('New Name');
      expect(persisted.persona).toBe('Please be a curious friend.');
    });

    it('a brand-new row (INSERT path) gets the schema default empty persona', () => {
      saveProvider('p-fresh', 'api', 'Fresh', SAMPLE_API_CONFIG, [], null, {});

      const persisted = db.prepare('SELECT persona FROM providers WHERE id = ?')
        .get('p-fresh') as { persona: string };
      expect(persisted.persona).toBe('');
    });
  });
});
