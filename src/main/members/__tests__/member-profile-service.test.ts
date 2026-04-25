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
  MEMBER_STATUS_CHANGED_EVENT,
  MemberProfileService,
  ProviderNotFoundError,
  type MemberProviderLookup,
} from '../member-profile-service';
import { DEFAULT_AVATARS } from '../default-avatars';
import type { StreamMemberStatusChangedPayload } from '../../../shared/stream-events';

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
 * Build a stub MemberProviderLookup whose `get()` returns a rows-backed shape and
 * whose `warmup()` behaviour is caller-controlled. We default to a
 * resolving warmup so "happy-path" callers don't have to pass a stub each
 * time; failure-path tests override the resolver.
 */
function makeProviderLookup(
  rows: Record<string, { displayName: string; persona: string }>,
  warmup?: (providerId: string) => Promise<void>,
): MemberProviderLookup {
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

    it('setStatus("online") drops the stale runtime entry so getWorkStatus reverts to offline-connection default', async () => {
      // Guards the stale-runtime decision: once the user flips offline-manual
      // then online, we refuse to report a cached 'online' from a pre-flip
      // reconnect. The caller must re-probe via reconnect() to learn truth.
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      await service.reconnect('p1'); // runtime = 'online'
      expect(service.getWorkStatus('p1')).toBe('online');

      service.setStatus('p1', 'offline-manual');
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      service.setStatus('p1', 'online');
      // Override cleared AND runtime entry cleared → falls back to default.
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
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

    it('coalesces concurrent reconnect calls on the same providerId onto a single probe', async () => {
      // Build a warmup that we can hold mid-flight so the second call lands
      // while the first is still pending — that's the coalescing window.
      seedProvider(db, 'p1', 'Ada');
      let resolveWarmup!: () => void;
      const warmupGate = new Promise<void>((resolve) => {
        resolveWarmup = resolve;
      });
      const warmup = vi.fn(async (_id: string) => {
        await warmupGate;
      });
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        warmup,
      );
      const service = new MemberProfileService(repo, providers);

      // Two concurrent calls BEFORE awaiting — this is the coalescing check.
      const p1a = service.reconnect('p1');
      const p1b = service.reconnect('p1');

      // Release the single in-flight warmup.
      resolveWarmup();
      const [a, b] = await Promise.all([p1a, p1b]);

      expect(warmup).toHaveBeenCalledTimes(1);
      expect(warmup).toHaveBeenCalledWith('p1');
      expect(a).toBe('online');
      expect(b).toBe(a);

      // A reconnect issued AFTER the in-flight one settled should start a
      // fresh probe (the map entry is cleared in finally). We don't make
      // that a hard assertion here since the spec only demands "concurrent"
      // coalescing, but we do verify it is not stuck.
      const p1c = service.reconnect('p1');
      expect(await p1c).toBe('online');
      expect(warmup).toHaveBeenCalledTimes(2);
    });

    it('does NOT coalesce across different providerIds', async () => {
      seedProvider(db, 'p1', 'Ada');
      seedProvider(db, 'p2', 'Bea');
      const warmup = vi.fn(async () => undefined);
      const providers = makeProviderLookup(
        {
          p1: { displayName: 'Ada', persona: '' },
          p2: { displayName: 'Bea', persona: '' },
        },
        warmup,
      );
      const service = new MemberProfileService(repo, providers);

      await Promise.all([service.reconnect('p1'), service.reconnect('p2')]);

      expect(warmup).toHaveBeenCalledTimes(2);
      expect(warmup).toHaveBeenCalledWith('p1');
      expect(warmup).toHaveBeenCalledWith('p2');
    });
  });

  // ── forget ──────────────────────────────────────────────────────────

  describe('forget', () => {
    it('clears runtime status so getWorkStatus reverts to the default', async () => {
      // Task 18's IPC layer calls forget() on provider deletion so stale
      // runtime state cannot leak into UI that happens to query by the
      // recycled providerId.
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      await service.reconnect('p1'); // runtime = online
      expect(service.getWorkStatus('p1')).toBe('online');

      service.forget('p1');

      // Absent runtime entry + no override → default.
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });

    it('drops the in-flight reconnect entry mid-flight so a concurrent caller does NOT share the stale promise', async () => {
      // Task 18 may invoke forget() while a warmup is still pending (e.g. a
      // provider is deleted mid-reconnect). A reconnect issued AFTER the
      // forget but BEFORE the first probe settles must kick a fresh probe
      // — not piggy-back on the about-to-be-discarded result.
      seedProvider(db, 'p1', 'Ada');
      let resolveFirstWarmup!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        resolveFirstWarmup = resolve;
      });
      let warmupCount = 0;
      const warmup = vi.fn(async (_id: string) => {
        warmupCount += 1;
        if (warmupCount === 1) {
          // The first call is held until we explicitly release it.
          await firstGate;
        }
        // Subsequent calls resolve immediately.
      });
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        warmup,
      );
      const service = new MemberProfileService(repo, providers);

      const firstProbe = service.reconnect('p1');
      service.forget('p1'); // drops the in-flight entry mid-flight

      // Immediately ask to reconnect again. Because forget() cleared the
      // map, this must issue a NEW warmup rather than reusing firstProbe.
      const secondProbe = service.reconnect('p1');
      expect(warmup).toHaveBeenCalledTimes(2);

      // Release the first probe so both promises can settle.
      resolveFirstWarmup();
      await Promise.all([firstProbe, secondProbe]);
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

    it('reverts to offline-connection default after setStatus("online") clears the override AND the stale runtime', async () => {
      // Rationale: a cached 'online' from 10 min ago is a lie once the user
      // has signalled "come back to work". `setStatus('online')` drops both
      // the override and the runtime map entry so getWorkStatus returns the
      // honest default until the caller (or Task 18 IPC) follows up with
      // reconnect().
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers);

      await service.reconnect('p1'); // runtime = online
      service.setStatus('p1', 'offline-manual');
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      service.setStatus('p1', 'online'); // clears override AND runtime entry
      expect(service.getProfile('p1').statusOverride).toBeNull();
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });
  });

  // ── buildPersona ────────────────────────────────────────────────────

  // ── offline-manual auto-timeout (R9-Task10) ──────────────────────────

  describe('offline-manual auto-timeout', () => {
    // Spec §7.2 + R9 Task 10: status_override='offline-manual' expires
    // after a configurable window (default 60 min) so a user who toggled
    // "외근" and forgot does not stay offline forever. Timestamp source is
    // the persisted `updated_at` column; a clock injected via options
    // lets the assertion ignore real time.
    function makeClock(start: number) {
      let now = start;
      return {
        now: () => now,
        advance: (deltaMs: number) => {
          now += deltaMs;
        },
      };
    }

    it('clears the override AND surfaces the runtime status once the window elapses', async () => {
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(1_700_000_000_000);
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        async () => undefined,
      );
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 60 * 60 * 1000, // 60 min
        now: clock.now,
      });

      // Warm up first so the runtime slot holds 'online' — the auto-clear
      // must fall through to the runtime status, not the default.
      await service.reconnect('p1');
      expect(service.getWorkStatus('p1')).toBe('online');

      // User toggles "외근" → setStatus writes updated_at = clock.now.
      service.setStatus('p1', 'offline-manual');
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      // 59 min later: inside the window, override still in force.
      clock.advance(59 * 60 * 1000);
      expect(service.getWorkStatus('p1')).toBe('offline-manual');
      expect(service.getProfile('p1').statusOverride).toBe('offline-manual');

      // 1 more second → past the window. getWorkStatus auto-clears.
      clock.advance(61 * 1000);
      expect(service.getWorkStatus('p1')).toBe('online');
      expect(service.getProfile('p1').statusOverride).toBeNull();
    });

    it('falls back to offline-connection when the runtime slot was never probed', () => {
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(2_000_000_000_000);
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 10_000,
        now: clock.now,
      });

      service.setStatus('p1', 'offline-manual');
      clock.advance(11_000);

      expect(service.getWorkStatus('p1')).toBe('offline-connection');
      expect(service.getProfile('p1').statusOverride).toBeNull();
    });

    it('does NOT clear a fresh override within the window', () => {
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(3_000_000_000_000);
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 60_000,
        now: clock.now,
      });

      service.setStatus('p1', 'offline-manual');

      // 59.9 s < window → still offline-manual, row untouched.
      clock.advance(59_900);
      expect(service.getWorkStatus('p1')).toBe('offline-manual');
      expect(service.getProfile('p1').statusOverride).toBe('offline-manual');
    });

    it('a profile edit resets the countdown (updated_at bumps forward)', () => {
      // Edge case: updateProfile preserves statusOverride but bumps
      // updated_at via the injected clock. The timeout is anchored on
      // updated_at, so an edit during the offline window restarts the
      // timer. Acceptable under the "no new migrations" constraint;
      // documented as a minor imperfection in the service header.
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(4_000_000_000_000);
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 60_000,
        now: clock.now,
      });

      service.setStatus('p1', 'offline-manual');
      clock.advance(50_000);

      // Edit profile → updated_at jumps to clock.now (via this.now()).
      service.updateProfile('p1', { role: 'Engineer' });

      // 20 s after the edit: only 20 s elapsed since new updated_at,
      // still inside the 60 s window.
      clock.advance(20_000);
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      // Another 50 s → total 70 s since the edit → now expired.
      clock.advance(50_000);
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });

    it('defaults the timeout to 60 min when no option is passed', async () => {
      // Guard the production default: callers that omit
      // offlineManualTimeoutMs (main/index.ts) must get the
      // spec-mandated 60-minute window. We rely on the injected clock
      // to jump forward rather than waiting an hour.
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(5_000_000_000_000);
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers, {
        now: clock.now,
      });

      service.setStatus('p1', 'offline-manual');
      // Exactly 60 min later: still inside (">" not ">=", by design so
      // the very first boundary click is stable).
      clock.advance(60 * 60 * 1000);
      expect(service.getWorkStatus('p1')).toBe('offline-manual');

      // One more ms → expired.
      clock.advance(1);
      expect(service.getWorkStatus('p1')).toBe('offline-connection');
    });

    it('timeoutMs=0 disables the auto-clear entirely (legacy mode)', () => {
      seedProvider(db, 'p1', 'Ada');
      const clock = makeClock(6_000_000_000_000);
      const providers = makeProviderLookup({ p1: { displayName: 'Ada', persona: '' } });
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 0,
        now: clock.now,
      });

      service.setStatus('p1', 'offline-manual');
      clock.advance(24 * 60 * 60 * 1000); // 24 h
      expect(service.getWorkStatus('p1')).toBe('offline-manual');
      expect(service.getProfile('p1').statusOverride).toBe('offline-manual');
    });
  });

  // ── R10-Task10: status-changed broadcast ────────────────────────────

  describe('status-changed broadcast (R10-Task10)', () => {
    /**
     * Each subtest captures every event the service emits during the
     * exercise so the assertion can run against the EXACT sequence —
     * not a "contains-at-least" smoke check. Multiple emits per call
     * (e.g. runProbe fires both 'connecting' and the terminal status)
     * are expected; the tests pin the count.
     */
    function captureEvents(
      service: MemberProfileService,
    ): StreamMemberStatusChangedPayload[] {
      const events: StreamMemberStatusChangedPayload[] = [];
      service.on(MEMBER_STATUS_CHANGED_EVENT, (p) => events.push(p));
      return events;
    }

    it('setStatus(offline-manual) emits cause="status" with full MemberView', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada', persona: '' },
      });
      const service = new MemberProfileService(repo, providers);
      const events = captureEvents(service);

      service.setStatus('p1', 'offline-manual');

      expect(events).toHaveLength(1);
      expect(events[0].providerId).toBe('p1');
      expect(events[0].cause).toBe('status');
      expect(events[0].status).toBe('offline-manual');
      // MemberView is fused with provider meta — covers the bridge's
      // shape validation (member must be an object with displayName).
      expect(events[0].member.displayName).toBe('Ada');
      expect(events[0].member.workStatus).toBe('offline-manual');
    });

    it('updateProfile emits cause="profile" with the freshly-saved view', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada', persona: '' },
      });
      const service = new MemberProfileService(repo, providers);
      const events = captureEvents(service);

      service.updateProfile('p1', { role: 'Engineer', personality: 'Direct' });

      expect(events).toHaveLength(1);
      expect(events[0].cause).toBe('profile');
      expect(events[0].member.role).toBe('Engineer');
      expect(events[0].member.personality).toBe('Direct');
    });

    it('reconnect emits TWO cause="warmup" events (connecting + terminal)', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        async () => undefined,
      );
      const service = new MemberProfileService(repo, providers);
      const events = captureEvents(service);

      await service.reconnect('p1');

      // Two emits: pre-warmup ('connecting') + post-warmup ('online').
      // Pinning the count guards against a future refactor that
      // accidentally drops the in-flight tick — that would leave the
      // renderer's spinner stuck on offline-connection.
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.cause === 'warmup')).toBe(true);
      expect(events[0].status).toBe('connecting');
      expect(events[1].status).toBe('online');
    });

    it('reconnect failure terminal emit is offline-connection (not online)', async () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup(
        { p1: { displayName: 'Ada', persona: '' } },
        async () => {
          throw new Error('boom');
        },
      );
      const service = new MemberProfileService(repo, providers);
      const events = captureEvents(service);

      await service.reconnect('p1');

      expect(events).toHaveLength(2);
      expect(events[1].status).toBe('offline-connection');
    });

    it('getWorkStatus auto-clear emits cause="status"', () => {
      seedProvider(db, 'p1', 'Ada');
      let now = 1_000_000;
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada', persona: '' },
      });
      const service = new MemberProfileService(repo, providers, {
        offlineManualTimeoutMs: 60_000,
        now: () => now,
      });

      service.setStatus('p1', 'offline-manual');
      // Drop the events from setStatus — we are testing the auto-clear
      // path independently.
      const events: StreamMemberStatusChangedPayload[] = [];
      service.on(MEMBER_STATUS_CHANGED_EVENT, (p) => events.push(p));

      now += 61_000; // past the 60s window
      const status = service.getWorkStatus('p1');

      expect(status).toBe('offline-connection');
      expect(events).toHaveLength(1);
      expect(events[0].cause).toBe('status');
      expect(events[0].status).toBe('offline-connection');
    });

    it('isolates a throwing listener (does not break the caller)', () => {
      seedProvider(db, 'p1', 'Ada');
      const providers = makeProviderLookup({
        p1: { displayName: 'Ada', persona: '' },
      });
      const service = new MemberProfileService(repo, providers);
      service.on(MEMBER_STATUS_CHANGED_EVENT, () => {
        throw new Error('listener exploded');
      });
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        // Calling setStatus must not propagate the listener error.
        expect(() => service.setStatus('p1', 'offline-manual')).not.toThrow();
        // The warn call carries the stable rolestra marker.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [marker] = warnSpy.mock.calls[0]!;
        expect(marker).toBe('[rolestra.members] status-changed listener threw:');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('skips emit when the provider lookup returns null (stale registry)', () => {
      // Provider row exists in DB (FK happy) but the runtime lookup
      // returns null — emulates a registry that has already unregistered
      // the provider while the DB row is being torn down. The
      // emitStatusChanged guard MUST bail; otherwise the bridge would
      // see an undefined `member` and drop a malformed payload.
      seedProvider(db, 'p1', 'Ada');
      const lookup: MemberProviderLookup = {
        // Lookup returns null — simulates a registry-mid-tear-down race.
        get: () => null,
        warmup: async () => undefined,
      };
      const service = new MemberProfileService(repo, lookup);
      const events = captureEvents(service);

      service.setStatus('p1', 'offline-manual');

      expect(events).toHaveLength(0);
    });
  });

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
