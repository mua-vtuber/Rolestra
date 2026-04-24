/**
 * R10-Task3: channel handler 의 DM 전용 헬퍼 2종(`handleDmList` /
 * `handleDmCreate`) 테스트.
 *
 * ChannelService 는 실제 DB 로 구동하지만 providerRegistry 는 singleton
 * 이라 vi.spyOn 으로 `listAll()` 을 stub 한다 — BaseProvider mock 전체를
 * 구성하는 비용을 회피.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDmList,
  handleDmCreate,
  setChannelServiceAccessor,
} from '../channel-handler';
import { ChannelRepository } from '../../../channels/channel-repository';
import { ChannelService } from '../../../channels/channel-service';
import {
  ProjectRepository,
} from '../../../projects/project-repository';
import { runMigrations } from '../../../database/migrator';
import { migrations } from '../../../database/migrations/index';
import { providerRegistry } from '../../../providers/registry';
import type { ProviderInfo } from '../../../../shared/provider-types';

function seedProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?)`,
  ).run(id, `Display ${id}`, 1_700_000_000_000, 1_700_000_000_000);
}

describe('channel handler — DM list + create (R10-Task3)', () => {
  let db: Database.Database;
  let channelService: ChannelService;
  let listAllSpy: ReturnType<typeof vi.spyOn> | null;

  beforeEach(() => {
    listAllSpy = null;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    const projectRepo = new ProjectRepository(db);
    const channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo, projectRepo);
    setChannelServiceAccessor(() => channelService);

    listAllSpy = vi
      .spyOn(providerRegistry, 'listAll')
      .mockImplementation((): ProviderInfo[] => [
        {
          id: 'prov-a',
          displayName: 'Alpha Provider',
          kind: 'api',
        } as unknown as ProviderInfo,
        {
          id: 'prov-b',
          displayName: 'Bravo Provider',
          kind: 'api',
        } as unknown as ProviderInfo,
      ]);
  });

  afterEach(() => {
    listAllSpy?.mockRestore();
    db.close();
  });

  it('returns one row per registered provider with exists flag', () => {
    seedProvider(db, 'prov-a');
    seedProvider(db, 'prov-b');
    channelService.createDm('prov-a'); // only prov-a has a DM so far

    const { items } = handleDmList();
    expect(items).toHaveLength(2);

    const a = items.find((i) => i.providerId === 'prov-a');
    const b = items.find((i) => i.providerId === 'prov-b');
    expect(a?.exists).toBe(true);
    expect(a?.channel?.kind).toBe('dm');
    expect(a?.providerName).toBe('Alpha Provider');
    expect(b?.exists).toBe(false);
    expect(b?.channel).toBeNull();
  });

  it('returns exists=false for every provider when no DMs exist', () => {
    seedProvider(db, 'prov-a');
    seedProvider(db, 'prov-b');

    const { items } = handleDmList();
    expect(items).toHaveLength(2);
    for (const row of items) {
      expect(row.exists).toBe(false);
      expect(row.channel).toBeNull();
    }
  });

  it('creates a DM channel via handleDmCreate', () => {
    seedProvider(db, 'prov-a');
    const { channel } = handleDmCreate({ providerId: 'prov-a' });
    expect(channel.kind).toBe('dm');
    expect(channel.projectId).toBeNull();

    // After create, handleDmList should flip exists=true for prov-a.
    const { items } = handleDmList();
    expect(items.find((i) => i.providerId === 'prov-a')?.exists).toBe(true);
  });

  it('propagates DuplicateDmError when the provider already has a DM', () => {
    seedProvider(db, 'prov-a');
    handleDmCreate({ providerId: 'prov-a' });
    expect(() => handleDmCreate({ providerId: 'prov-a' })).toThrow(/dm/i);
  });
});
