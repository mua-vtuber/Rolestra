/**
 * Dashboard KPI types (v3).
 *
 * Renderer calls `dashboard:get-kpis` on mount / active-project change /
 * modal close. R4 returns a single snapshot — real-time stream subscription
 * is deferred to R6.
 */

/**
 * Single-shot KPI snapshot for the dashboard Hero block.
 *
 * Fields map 1:1 to spec §7.5 KPI table:
 * - activeProjects   ← projects.status='active' count
 * - activeMeetings   ← meetings.state NOT IN ('done','failed','aborted') count
 * - pendingApprovals ← approval_items.status='pending' count
 * - completedToday   ← meetings.state='done' AND completed_at ≥ today_00:00 count
 */
export interface KpiSnapshot {
  activeProjects: number;
  activeMeetings: number;
  pendingApprovals: number;
  completedToday: number;
  /** Snapshot creation time (epoch ms). */
  asOf: number;
}

/**
 * `dashboard:get-kpis` input.
 *
 * `projectId` is **reserved for R6+**. R4 always returns global aggregates.
 * Accepting the field now keeps the wire contract stable across phases.
 */
export interface DashboardGetKpisInput {
  /** Reserved for R6+ project-scoped KPIs. R4 ignores this field. */
  projectId?: string | null;
}
