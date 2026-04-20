/**
 * DashboardService — R4 Task 2 single-call KPI aggregator (spec §7.5).
 *
 * Why this exists:
 *   The dashboard Hero block displays four KPIs that must refresh as a
 *   single logical event (mount / active-project change / modal close).
 *   Exposing each KPI as its own IPC channel would produce N+1 round
 *   trips between renderer and main and N+1 DB passes within main. This
 *   service collapses the four counts into a single method call that
 *   issues **≤ 4 indexed COUNT queries** — one per repository — with no
 *   raw SQL of its own.
 *
 * KPI mapping (spec §7.5 table):
 *   activeProjects   ← `projects.status = 'active'` count
 *   activeMeetings   ← meetings with `ended_at IS NULL` count (the
 *                     canonical "not done/failed/aborted" predicate;
 *                     every terminal outcome stamps `ended_at`)
 *   pendingApprovals ← `approval_items.status = 'pending'` count
 *   completedToday   ← meetings with `outcome='accepted'` and
 *                     `ended_at >= startOfLocalToday()` count
 *
 * `completedToday` and DST:
 *   "Today 00:00" is interpreted in the **application-local timezone**.
 *   Using `Date.UTC(...)` would shift the boundary by up to 24h for
 *   users west of UTC, and more importantly, it would silently misbehave
 *   on DST-transition days (fall-back: the "23:59:59" minute happens
 *   twice; spring-forward: "02:30" never exists). Constructing a local
 *   `Date` with Y/M/D + 0/0/0/0 and reading `.getTime()` picks whichever
 *   wall-clock midnight the OS TZ tables say is "the start of today",
 *   which is the only sane definition for a dashboard tile. The test
 *   suite pins a spring-forward-day clock to assert this explicitly.
 *
 * `clock` injection:
 *   Defaulting to `() => new Date()` lets production call
 *   `service.getKpis()` with no ceremony while tests can pin the clock
 *   to a specific DST transition. We pass a factory (not a fixed Date)
 *   because the service may outlive multiple KPI fetches and each call
 *   should observe "now".
 */

import type { KpiSnapshot } from '../../shared/dashboard-types';
import type { ApprovalRepository } from '../approvals/approval-repository';
import type { MeetingRepository } from '../meetings/meeting-repository';
import type { ProjectRepository } from '../projects/project-repository';

/**
 * Returns the epoch-ms timestamp for the most recent local-wall-clock
 * 00:00:00. Exported for direct unit testing — the DashboardService
 * consumes it only via the injected clock closure, but isolating the
 * pure function makes the DST edge case provable without running
 * against SQLite.
 */
export function startOfLocalDay(now: Date): number {
  // `new Date(y, m, d)` uses local TZ; `.getTime()` collapses back to
  // UTC epoch. This is the only Date constructor shape that honours
  // DST rules without extra work — `setHours(0,0,0,0)` on a Date whose
  // wall-clock is already "before the spring-forward gap" can land on
  // a nonexistent instant, which V8 normalises forward and produces the
  // wrong boundary. Building from Y/M/D sidesteps the normalisation.
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

/**
 * Constructor deps — three existing repositories plus an optional
 * clock factory. No DB handle is held directly; the repositories own
 * their prepared statements and the service merely composes their
 * count methods.
 */
export interface DashboardServiceDeps {
  projectRepo: ProjectRepository;
  meetingRepo: MeetingRepository;
  approvalRepo: ApprovalRepository;
  /**
   * Injected clock for deterministic tests. Defaults to
   * `() => new Date()` in production. The closure is re-invoked on
   * each `getKpis()` call so multiple snapshots reflect "now".
   */
  clock?: () => Date;
}

export class DashboardService {
  private readonly projectRepo: ProjectRepository;
  private readonly meetingRepo: MeetingRepository;
  private readonly approvalRepo: ApprovalRepository;
  private readonly clock: () => Date;

  constructor(deps: DashboardServiceDeps) {
    this.projectRepo = deps.projectRepo;
    this.meetingRepo = deps.meetingRepo;
    this.approvalRepo = deps.approvalRepo;
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Builds the 4-KPI snapshot in a single pass.
   *
   * Issues exactly four repository calls (one indexed COUNT each). The
   * ordering is deliberately independent — none of the counts depend on
   * each other — so a future parallelisation (e.g. moving `asyncify` or
   * pushing onto a worker thread) remains a local refactor.
   *
   * `asOf` is stamped from the injected clock at the *start* of the
   * aggregate so all four numbers carry the same logical timestamp.
   */
  getKpis(): KpiSnapshot {
    const now = this.clock();
    const asOf = now.getTime();
    const todayStart = startOfLocalDay(now);

    return {
      activeProjects: this.projectRepo.countByStatus('active'),
      activeMeetings: this.meetingRepo.countActive(),
      pendingApprovals: this.approvalRepo.countByStatus('pending'),
      completedToday: this.meetingRepo.countCompletedSince(todayStart),
      asOf,
    };
  }
}
