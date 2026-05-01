/**
 * Unit tests for provider-repository — R12-S Task 5.
 *
 * roles + skill_overrides 컬럼 read/write 정상 동작 확인. 기존 컬럼
 * (id / kind / display_name / persona / config_json) 은 R10 까지의
 * 회귀 테스트 (ipc-provider-roundtrip) 로 보장 — 본 spec 은 R12-S 신규
 * 필드만 검증.
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
      '신중한 PM',
      SAMPLE_API_CONFIG,
      ['planning', 'design.ui'],
      { planning: '커스텀 PM 프롬프트' },
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
      undefined,
      SAMPLE_API_CONFIG,
      [],
      null,
    );

    const rows = loadAllProviders();
    expect(rows[0].roles).toBe('[]');
    expect(rows[0].skillOverrides).toBeNull();
  });

  it('upserts roles on conflict (UPDATE path)', () => {
    saveProvider('p3', 'api', 'Test', undefined, SAMPLE_API_CONFIG, ['idea'], null);
    saveProvider(
      'p3',
      'api',
      'Test',
      undefined,
      SAMPLE_API_CONFIG,
      ['planning'],
      { planning: 'override' },
    );

    const rows = loadAllProviders();
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toBe('["planning"]');
    expect(rows[0].skillOverrides).toBe('{"planning":"override"}');
  });

  it('removeProvider deletes the row including roles', () => {
    saveProvider('p4', 'api', 'X', undefined, SAMPLE_API_CONFIG, ['general'], null);
    expect(loadAllProviders()).toHaveLength(1);

    removeProvider('p4');
    expect(loadAllProviders()).toHaveLength(0);
  });
});
