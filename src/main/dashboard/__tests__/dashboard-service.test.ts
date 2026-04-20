/**
 * DashboardService unit tests (R4 Task 2).
 *
 * Coverage:
 *   - getKpis() issues ≤ 4 repository calls (one per KPI) — asserted via
 *     vi.spyOn on each count method
 *   - each KPI field maps 1:1 to spec §7.5 semantics on a real on-disk
 *     SQLite fixture (projects / meetings / approvals all seeded with
 *     mixed states)
 *   - completedToday uses app-local timezone 00:00: a clock pinned to a
 *     US spring-forward day (2026-03-08 07:30Z) must see "today" start
 *     at the local wall-clock midnight, not UTC midnight, and not the
 *     nonexistent 2026-03-08T02:30 local instant
 *   - handler throws "dashboard handler: service not initialized" when
 *     the accessor is not wired (mirrors arena-root/project handler
 *     pattern)
 *
 * Each DB test provisions its own temp ArenaRoot + fresh SQLite so tests
 * stay isolated, same fixture style as meeting-service.test.ts.
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
import { ProjectRepository } from '../../projects/project-repository';
import { ProjectService } from '../../projects/project-service';
import { ChannelRepository } from '../../channels/channel-repository';
import { ChannelService } from '../../channels/channel-service';
import { MeetingRepository } from '../../meetings/meeting-repository';
import { MeetingService } from '../../meetings/meeting-service';
import { ApprovalRepository } from '../../approvals/approval-repository';
import { ApprovalService } from '../../approvals/approval-service';
import { DashboardService, startOfLocalDay } from '../dashboard-service';
import {
  handleDashboardGetKpis,
  setDashboardServiceAccessor,
} from '../../ipc/handlers/dashboard-handler';

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

describe('DashboardService', () => {
  let arenaRoot: string;
  let arenaRootService: ArenaRootService;
  let db: Database.Database;
  let projectRepo: ProjectRepository;
  let meetingRepo: MeetingRepository;
  let approvalRepo: ApprovalRepository;
  let projectService: ProjectService;
  let channelService: ChannelService;
  let meetingService: MeetingService;
  let approvalService: ApprovalService;

  beforeEach(async () => {
    arenaRoot = makeTmpDir('rolestra-r4task2-');
    arenaRootService = new ArenaRootService(createConfigStub(arenaRoot));
    await arenaRootService.ensure();

    const dbPath = arenaRootService.dbPath();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrations);

    projectRepo = new ProjectRepository(db);
    meetingRepo = new MeetingRepository(db);
    approvalRepo = new ApprovalRepository(db);

    projectService = new ProjectService(projectRepo, arenaRootService);
    const channelRepo = new ChannelRepository(db);
    channelService = new ChannelService(channelRepo, projectRepo);
    meetingService = new MeetingService(meetingRepo);
    approvalService = new ApprovalService(approvalRepo);
  });

  afterEach(() => {
    db.close();
    cleanupDir(arenaRoot);
  });

  describe('getKpis — KPI mapping (spec §7.5)', () => {
    it('returns all-zero snapshot on empty DB', () => {
      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      const snapshot = service.getKpis();
      expect(snapshot.activeProjects).toBe(0);
      expect(snapshot.activeMeetings).toBe(0);
      expect(snapshot.pendingApprovals).toBe(0);
      expect(snapshot.completedToday).toBe(0);
      expect(snapshot.asOf).toBeGreaterThan(0);
    });

    it('activeProjects counts only status=active', async () => {
      // 2 active + 1 archived project
      await projectService.create({
        name: 'P1',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      await projectService.create({
        name: 'P2',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const p3 = await projectService.create({
        name: 'P3',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      projectService.archive(p3.id);

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      expect(service.getKpis().activeProjects).toBe(2);
    });

    it('activeMeetings counts only ended_at IS NULL (in-flight) rows', async () => {
      const project = await projectService.create({
        name: 'Proj',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const ch1 = channelService.create({ projectId: project.id, name: 'a' });
      const ch2 = channelService.create({ projectId: project.id, name: 'b' });
      const ch3 = channelService.create({ projectId: project.id, name: 'c' });

      // 2 active meetings (ch1, ch2)
      meetingService.start({ channelId: ch1.id });
      meetingService.start({ channelId: ch2.id });
      // 1 finished meeting on ch3 — must NOT count
      const m3 = meetingService.start({ channelId: ch3.id });
      meetingService.finish(m3.id, 'aborted');

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      expect(service.getKpis().activeMeetings).toBe(2);
    });

    it('pendingApprovals counts only status=pending', () => {
      approvalService.create({ kind: 'cli_permission', payload: {} });
      approvalService.create({ kind: 'consensus_decision', payload: {} });
      const decided = approvalService.create({
        kind: 'mode_transition',
        payload: {},
      });
      approvalService.decide(decided.id, 'approve');

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      expect(service.getKpis().pendingApprovals).toBe(2);
    });

    it('completedToday counts only outcome=accepted meetings finished since today_00:00', async () => {
      const project = await projectService.create({
        name: 'Proj',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const ch1 = channelService.create({ projectId: project.id, name: 'a' });
      const ch2 = channelService.create({ projectId: project.id, name: 'b' });
      const ch3 = channelService.create({ projectId: project.id, name: 'c' });

      // Accepted today
      const m1 = meetingService.start({ channelId: ch1.id });
      meetingService.finish(m1.id, 'accepted');

      // Rejected today — must NOT count (rejected/aborted are not "completed")
      const m2 = meetingService.start({ channelId: ch2.id });
      meetingService.finish(m2.id, 'rejected');

      // Accepted yesterday — must NOT count
      const m3 = meetingService.start({ channelId: ch3.id });
      meetingService.finish(m3.id, 'accepted');
      const yesterday = Date.now() - 25 * 60 * 60 * 1000;
      db.prepare('UPDATE meetings SET ended_at = ? WHERE id = ?').run(
        yesterday,
        m3.id,
      );

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      expect(service.getKpis().completedToday).toBe(1);
    });
  });

  describe('getKpis — N+1 prevention', () => {
    it('issues exactly one call per repository count method (≤ 4 total)', () => {
      const projectSpy = vi.spyOn(projectRepo, 'countByStatus');
      const meetingActiveSpy = vi.spyOn(meetingRepo, 'countActive');
      const meetingCompletedSpy = vi.spyOn(meetingRepo, 'countCompletedSince');
      const approvalSpy = vi.spyOn(approvalRepo, 'countByStatus');

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
      });
      service.getKpis();

      expect(projectSpy).toHaveBeenCalledTimes(1);
      expect(meetingActiveSpy).toHaveBeenCalledTimes(1);
      expect(meetingCompletedSpy).toHaveBeenCalledTimes(1);
      expect(approvalSpy).toHaveBeenCalledTimes(1);

      // Sum across the four distinct count methods must stay at 4 —
      // adding a 5th call would violate the "single-aggregate-pass"
      // contract spelled out in the plan (spec §7.5 / R4 Task 2).
      const total =
        projectSpy.mock.calls.length +
        meetingActiveSpy.mock.calls.length +
        meetingCompletedSpy.mock.calls.length +
        approvalSpy.mock.calls.length;
      expect(total).toBeLessThanOrEqual(4);
      expect(total).toBe(4);
    });
  });

  describe('completedToday — DST boundary (US spring-forward)', () => {
    it('computes startOfLocalDay() at the injected clock\'s local wall-clock midnight', () => {
      // 2026-03-08 is US spring-forward (DST begins 02:00 local → 03:00).
      // Pin the clock to 07:30 UTC — in US/Eastern that is 02:30 local
      // (except the 02:00-02:59 hour doesn't exist on this day, so V8
      // normalises it to 03:30). Regardless of whether the CI host is
      // in EST/EDT/UTC/KST, the invariant is: `startOfLocalDay(now)`
      // equals `new Date(y, m, d, 0, 0, 0, 0).getTime()` using the
      // host TZ — i.e. NOT UTC midnight.
      const fixed = new Date('2026-03-08T07:30:00Z');

      const expectedLocal = new Date(
        fixed.getFullYear(),
        fixed.getMonth(),
        fixed.getDate(),
        0,
        0,
        0,
        0,
      ).getTime();
      const utcMidnight = Date.UTC(
        fixed.getUTCFullYear(),
        fixed.getUTCMonth(),
        fixed.getUTCDate(),
      );

      expect(startOfLocalDay(fixed)).toBe(expectedLocal);

      // Sanity on non-UTC CI runners: local midnight must differ from
      // UTC midnight. We skip this assertion when the CI host happens
      // to be running in UTC (common for Linux containers), because in
      // that case both forms collapse to the same instant — which is
      // itself correct behaviour.
      const offsetMin = fixed.getTimezoneOffset();
      if (offsetMin !== 0) {
        expect(startOfLocalDay(fixed)).not.toBe(utcMidnight);
      }
    });

    it('getKpis() with an injected clock honours the local-midnight boundary', async () => {
      // Seed a meeting whose ended_at sits strictly before today's
      // local midnight (one minute earlier) — it MUST be excluded from
      // completedToday. A second meeting stamped exactly at local
      // midnight MUST be included (>= boundary).
      const project = await projectService.create({
        name: 'DstProj',
        kind: 'new',
        permissionMode: 'hybrid',
      });
      const chA = channelService.create({ projectId: project.id, name: 'a' });
      const chB = channelService.create({ projectId: project.id, name: 'b' });

      const fixed = new Date('2026-03-08T07:30:00Z'); // spring-forward
      const todayStart = startOfLocalDay(fixed);
      const justBefore = todayStart - 60_000;

      const mA = meetingService.start({ channelId: chA.id });
      meetingService.finish(mA.id, 'accepted');
      db.prepare('UPDATE meetings SET ended_at = ? WHERE id = ?').run(
        justBefore,
        mA.id,
      );

      const mB = meetingService.start({ channelId: chB.id });
      meetingService.finish(mB.id, 'accepted');
      db.prepare('UPDATE meetings SET ended_at = ? WHERE id = ?').run(
        todayStart,
        mB.id,
      );

      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
        clock: () => fixed,
      });
      const snapshot = service.getKpis();
      expect(snapshot.completedToday).toBe(1);
      expect(snapshot.asOf).toBe(fixed.getTime());
    });
  });

  describe('asOf timestamp', () => {
    it('stamps asOf from the injected clock', () => {
      const fixed = new Date('2026-04-20T12:00:00Z');
      const service = new DashboardService({
        projectRepo,
        meetingRepo,
        approvalRepo,
        clock: () => fixed,
      });
      expect(service.getKpis().asOf).toBe(fixed.getTime());
    });
  });
});

describe('dashboard-handler wiring', () => {
  afterEach(() => {
    setDashboardServiceAccessor(null as never);
  });

  it('throws "dashboard handler: service not initialized" before wiring', () => {
    setDashboardServiceAccessor(null as never);
    expect(() => handleDashboardGetKpis({})).toThrow(
      /dashboard handler: service not initialized/,
    );
  });

  it('returns { snapshot } from the wired service', () => {
    const fakeSnapshot = {
      activeProjects: 3,
      activeMeetings: 1,
      pendingApprovals: 2,
      completedToday: 4,
      asOf: 1_700_000_000_000,
    };
    const svc = { getKpis: vi.fn().mockReturnValue(fakeSnapshot) };
    setDashboardServiceAccessor(() => svc as never);

    const result = handleDashboardGetKpis({});
    expect(result).toEqual({ snapshot: fakeSnapshot });
    expect(svc.getKpis).toHaveBeenCalledTimes(1);
  });

  it('accepts (and ignores) projectId input — reserved for R6+', () => {
    const fakeSnapshot = {
      activeProjects: 0,
      activeMeetings: 0,
      pendingApprovals: 0,
      completedToday: 0,
      asOf: 1,
    };
    const svc = { getKpis: vi.fn().mockReturnValue(fakeSnapshot) };
    setDashboardServiceAccessor(() => svc as never);

    handleDashboardGetKpis({ projectId: 'any-id' });
    handleDashboardGetKpis({ projectId: null });
    // Service call shape MUST be unchanged — projectId is dropped.
    expect(svc.getKpis).toHaveBeenCalledTimes(2);
    expect(svc.getKpis).toHaveBeenLastCalledWith();
  });
});
