/**
 * Unit tests for MemberProfileService — offline-manual auto-timeout
 * (R9-Task10) + status-changed broadcast (R10-Task10).
 *
 * D1 (2026-09-28): split out of member-profile-service.test.ts, which
 * exceeded the 800-line file cap. These 2 describe blocks moved here
 * verbatim (no behavior change); getProfile / updateProfile / getView /
 * setStatus / reconnect / forget / getWorkStatus /
 * DEFAULT_AVATARS stayed in the original file. Header and helpers are
 * duplicated so this file is a self-contained suite.
 *
 * Coverage:
 *   - offline-manual auto-timeout: status_override expires after a
 *     configurable window (default 60 min), anchored on updated_at;
 *     surfaces the runtime status once expired; a profile edit resets
 *     the countdown; timeoutMs=0 disables auto-clear (legacy mode).
 *   - status-changed broadcast: setStatus/updateProfile/reconnect/
 *     getWorkStatus auto-clear all emit MEMBER_STATUS_CHANGED_EVENT with
 *     the expected cause + payload shape; a throwing listener is
 *     isolated; a stale-registry lookup (get() returns null) skips the
 *     emit instead of broadcasting a malformed payload.
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
  type MemberProviderLookup,
} from '../member-profile-service';
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
    // R12-W T9 — stub lookup 은 직원 roles / skillOverrides 가 없는 환경을
    // 시뮬레이션. row 가 있으면 빈 배열 / null 반환 (테스트가 별도 케이스로
    // override 가능), 없으면 null.
    getRoles(providerId) {
      return rows[providerId] ? [] : null;
    },
    getSkillOverrides(providerId) {
      return rows[providerId] ? null : null;
    },
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
      service.updateProfile('p1', { characterSheet: 'Role: Engineer' });

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

      service.updateProfile('p1', { characterSheet: 'Role: Engineer\nPersonality: Direct' });

      expect(events).toHaveLength(1);
      expect(events[0].cause).toBe('profile');
      expect(events[0].member.characterSheet).toBe('Role: Engineer\nPersonality: Direct');
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
        getRoles: () => null,
        getSkillOverrides: () => null,
      };
      const service = new MemberProfileService(repo, lookup);
      const events = captureEvents(service);

      service.setStatus('p1', 'offline-manual');

      expect(events).toHaveLength(0);
    });
  });
});
