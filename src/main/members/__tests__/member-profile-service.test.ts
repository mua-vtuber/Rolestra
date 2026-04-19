/**
 * Unit tests for MemberProfileService (R2 Task 9).
 *
 * Coverage:
 *   - getProfile default shape when no row exists (no side-effect insert).
 *   - updateProfile: upsert + read-back + updatedAt bumped + avatarData=null
 *     is a real value (not a "skip" sentinel).
 *   - updateProfile: does NOT touch statusOverride (routing guard).
 *   - getView: fuses provider meta + runtime workStatus.
 *   - getView: throws ProviderNotFoundError for unknown providerId.
 *   - setStatus('offline-manual') persists; survives service re-instantiation.
 *   - setStatus('online') clears the override.
 *   - reconnect: warmup success → runtime 'online' → getWorkStatus 'online'.
 *   - reconnect: warmup failure → runtime 'offline-connection'.
 *   - getWorkStatus: manual override beats runtime status in every combo.
 *   - DEFAULT_AVATARS has exactly 8 entries.
 *   - buildPersona: threads legacy persona into the builder output.
 *
 * Each test provisions a fresh temp ArenaRoot + on-disk SQLite so nothing
 * leaks between runs, matching the Task 8 / 10 / 11 pattern.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArenaRootService,
  type ArenaRootConfigAccessor,
} from '../../arena/arena-root-service';
import { runMigrations } from '../../database/migrator';
import { migrations } from '../../database/migrations/index';
import { MemberProfileRepository } from '../member-profile-repository';
import {
  MemberProfileService,
  ProviderNotFoundError,
  type ProviderLookup,
} from '../member-profile-service';
import { DEFAULT_AVATARS } from '../default-avatars';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createConfigStub(arenaRoot: string): ArenaRootConfigAccessor {
  const state = { arenaRoot };
  return {
    getSettings: () => state,
    updateSettings: (patch: { arenaRoot?: string }) => {
      if (patch.arenaRoot !== undefined) state.arenaRoot = patch.arenaRoot;
    },
  };
}

function seedProvider(
  db: Database.Database,
  id: string,
  displayName: string,
  persona = '',
): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, persona, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, ?, ?)`,
  ).run(id, displayName, persona, 1700000000000, 1700000000000);
}

/**
 * Build a stub ProviderLookup whose `get()` returns a rows-backed shape and
 * whose `warmup()` behaviour is caller-controlled. We default to a
 * resolving warmup so "happy-path" callers don't have to pass a stub each
 * time; failure-path tests override the resolver.
 */
function makeProviderLookup(
  rows: Record<string, { displayName: string; persona: string }>,
  warmup?: (providerId: string) => Promise<void>,
): ProviderLookup {
  return {
    get(providerId) {
      const meta = rows[providerId];
      if (!meta) return null;
      return { id: providerId, displayName: meta.displayName, persona: meta.persona };
    },
    warmup: warmup ?? (async () => undefined),
  };
}

describe('MemberProfileService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let repo: MemberProfileRepository;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-task9-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    repo = new MemberProfileRepository(db);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  // ── getProfile ─────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns the defaults when no row exists and does NOT insert', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      const profile = service.getProfile('p1');

      expect(profile).toEqual({
        providerId: 'p1',
        role: '',
        personality: '',
        expertise: '',
        avatarKind: 'default',
        avatarData: null,
        statusOverride: null,
        updatedAt: 0,
      });
      // Read-through must NOT create a row.
      expect(repo.get('p1')).toBeNull();
    });

    it('returns the persisted row when one exists', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      service.updateProfile('p1', { role: 'Engineer' });
      const profile = service.getProfile('p1');

      expect(profile.role).toBe('Engineer');
      expect(profile.updatedAt).toBeGreaterThan(0);
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('upserts, reads back the whitelisted fields, and bumps updatedAt', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      const before = Date.now();
      const saved = service.updateProfile('p1', {
        role: 'Engineer',
        personality: 'Direct',
        expertise: 'SQLite, FTS5',
        avatarKind: 'default',
        avatarData: 'blue-dev',
      });

      expect(saved.role).toBe('Engineer');
      expect(saved.personality).toBe('Direct');
      expect(saved.expertise).toBe('SQLite, FTS5');
      expect(saved.avatarKind).toBe('default');
      expect(saved.avatarData).toBe('blue-dev');
      expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
      expect(repo.get('p1')).toEqual(saved);
    });

    it('preserves avatarData=null as a real value (does not treat it as "skip")', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      // First: set a custom avatar path.
      service.updateProfile('p1', { avatarKind: 'custom', avatarData: '/tmp/pic.png' });
      expect(service.getProfile('p1').avatarData).toBe('/tmp/pic.png');

      // Second: explicitly clear it by passing null.
      const cleared = service.updateProfile('p1', { avatarData: null });
      expect(cleared.avatarData).toBeNull();
    });

    it('does NOT touch statusOverride even if the row was set via setStatus first', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      service.setStatus('p1', 'offline-manual');
      service.updateProfile('p1', { role: 'Engineer' });

      expect(service.getProfile('p1').statusOverride).toBe('offline-manual');
    });

    it('bumps updatedAt across successive edits', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      const a = service.updateProfile('p1', { role: 'A' });
      // Sleep 2ms to guarantee a distinct Date.now() on systems with 1ms resolution.
      await new Promise((r) => setTimeout(r, 2));
      const b = service.updateProfile('p1', { role: 'B' });

      expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    });
  });

  // ── getView ─────────────────────────────────────────────────────────

  describe('getView', () => {
    it('fuses provider meta + runtime workStatus', () => {
      seedProvider(db, 'p1', 'Ada Lovelace', 'Legacy persona blob');
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada Lovelace', persona: 'Legacy persona blob' },
      });
      const service = new MemberProfileService(repo, providers);
      service.updateProfile('p1', { role: 'Engineer' });

      const view = service.getView('p1');

      expect(view.providerId).toBe('p1');
      expect(view.displayName).toBe('Ada Lovelace');
      expect(view.persona).toBe('Legacy persona blob');
      expect(view.role).toBe('Engineer');
      // No warmup called yet → default runtime status.
      expect(view.workStatus).toBe('offline-connection');
    });

    it('throws ProviderNotFoundError when the provider is unknown', () => {
      const providers = makeProviderLookup({});
      const service = new MemberProfileService(repo, providers);

      expect(() => service.getView('ghost')).toThrow(ProviderNotFoundError);
    });
  });

  // ── setStatus ───────────────────────────────────────────────────────

  describe('setStatus', () => {
    it('persists offline-manual (survives re-instantiation of the service)', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      service.setStatus('p1', 'offline-manual');
      expect(service.getProfile('p1').statusOverride).toBe('offline-manual');

      // Simulate a restart: new service instance, same DB.
      const service2 = new MemberProfileService(repo, providers);
      expect(service2.getProfile('p1').statusOverride).toBe('offline-manual');
      expect(service2.getWorkStatus('p1')).toBe('offline-manual');
    });

    it('clears the override when target="online"', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      service.setStatus('p1', 'offline-manual');
      service.setStatus('p1', 'online');

      expect(service.getProfile('p1').statusOverride).toBeNull();
    });
  });

  // ── reconnect ───────────────────────────────────────────────────────

  describe('reconnect', () => {
    it('drives runtime to online on warmup success', async () => {
      seedProvider(db, 'p1', 'Ada');
      const warmup = vi.fn(async () => undefined);
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        warmup,
      );
      const service = new MemberProfileService(repo, providers);

      const status = await service.reconnect('p1');

      expect(warmup).toHaveBeenCalledWith('p1');
      expect(status).toBe('online');
      expect(service.getWorkStatus('p1')).toBe('online');
    });

    it('drives runtime to offline-connection on warmup failure', async () => {
      seedProvider(db, 'p1', 'Ada');
      const warmup = vi.fn(async () => {
        throw new Error('network unreachable');
      });
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        warmup,
      );
      const service = new MemberProfileService(repo, providers);

      const status = await service.reconnect('p1');

      expect(warmup).toHaveBeenCalledWith('p1');
      expect(status).toBe('offline-connection');
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });
  });

  // ── getWorkStatus decision tree ─────────────────────────────────────

  describe('getWorkStatus', () => {
    it('returns offline-connection by default when no probe has run', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });

    it('lets manual override win even when runtime says online', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      // First: warmup succeeds, runtime = 'online'.
      await service.reconnect('p1');
      expect(service.getWorkStatus('p1')).toBe('online');

      // User then flips manual → must return offline-manual regardless.
      service.setStatus('p1', 'offline-manual');
      expect(service.getWorkStatus('p1')).toBe('offline-manual');
    });

    it('lets manual override win even when runtime says offline-connection', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        async () => {
          throw new Error('fail');
        },
      );
      const service = new MemberProfileService(repo, providers);

      await service.reconnect('p1');
      service.setStatus('p1', 'offline-manual');

      expect(service.getWorkStatus('p1')).toBe('offline-manual');
    });

    it('falls back to runtime after the user clears the override', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      await service.reconnect('p1'); // runtime = online
      service.setStatus('p1', 'offline-manual');
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      service.setStatus('p1', 'online'); // clears override, runtime still online
      expect(service.getWorkStatus('p1')).toBe('online');
    });
  });

  // ── buildPersona ────────────────────────────────────────────────────

  describe('buildPersona', () => {
    it('threads the legacy persona from providers.persona into the builder', () => {
      seedProvider(db, 'p1', 'Ada', 'Likes terse answers.');
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada', persona: 'Likes terse answers.' },
      });
      const service = new MemberProfileService(repo, providers);
      service.updateProfile('p1', { role: 'Engineer', personality: 'Direct' });

      const persona = service.buildPersona('p1');

      expect(persona).toContain('Name: Ada');
      expect(persona).toContain('Role: Engineer');
      expect(persona).toContain('Personality: Direct');
      expect(persona).toContain('[Legacy Persona]');
      expect(persona).toContain('Likes terse answers.');
    });

    it('throws ProviderNotFoundError when the provider is unknown', () => {
      const providers = makeProviderLookup({});
      const service = new MemberProfileService(repo, providers);
      expect(() => service.buildPersona('ghost')).toThrow(ProviderNotFoundError);
    });
  });
});

// ── DEFAULT_AVATARS ─────────────────────────────────────────────────

describe('DEFAULT_AVATARS', () => {
  it('has exactly 8 entries', () => {
    expect(DEFAULT_AVATARS).toHaveLength(8);
  });

  it('has unique keys', () => {
    const keys = DEFAULT_AVATARS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a hex color and a non-empty emoji', () => {
    for (const entry of DEFAULT_AVATARS) {
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(entry.emoji.length).toBeGreaterThan(0);
    }
  });
});
