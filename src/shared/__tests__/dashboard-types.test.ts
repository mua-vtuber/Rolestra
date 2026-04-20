/**
 * Type-level contract tests for dashboard-types.ts.
 *
 * Ensures the wire shape stays stable as R4 evolves.
 */

import { describe, it, expect } from 'vitest';
import type { KpiSnapshot, DashboardGetKpisInput } from '../dashboard-types';
import { dashboardGetKpisSchema } from '../ipc-schemas';

describe('KpiSnapshot', () => {
  it('accepts a fully-populated snapshot', () => {
    const snapshot: KpiSnapshot = {
      activeProjects: 3,
      activeMeetings: 1,
      pendingApprovals: 5,
      completedToday: 7,
      asOf: Date.now(),
    };
    expect(snapshot.activeProjects).toBe(3);
    expect(snapshot.asOf).toBeGreaterThan(0);
  });

  it('accepts all-zero snapshot (fresh install)', () => {
    const empty: KpiSnapshot = {
      activeProjects: 0,
      activeMeetings: 0,
      pendingApprovals: 0,
      completedToday: 0,
      asOf: 0,
    };
    expect(empty.activeProjects).toBe(0);
  });
});

describe('dashboardGetKpisSchema', () => {
  it('accepts empty input ({})', () => {
    const result = dashboardGetKpisSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts undefined projectId', () => {
    const input: DashboardGetKpisInput = { projectId: undefined };
    expect(dashboardGetKpisSchema.safeParse(input).success).toBe(true);
  });

  it('accepts null projectId (R6+ reserved)', () => {
    const input: DashboardGetKpisInput = { projectId: null };
    expect(dashboardGetKpisSchema.safeParse(input).success).toBe(true);
  });

  it('accepts a plausible projectId string', () => {
    const input: DashboardGetKpisInput = { projectId: 'proj_abc123' };
    expect(dashboardGetKpisSchema.safeParse(input).success).toBe(true);
  });

  it('rejects empty-string projectId', () => {
    expect(dashboardGetKpisSchema.safeParse({ projectId: '' }).success).toBe(false);
  });

  it('rejects non-string projectId', () => {
    expect(dashboardGetKpisSchema.safeParse({ projectId: 42 }).success).toBe(false);
    expect(dashboardGetKpisSchema.safeParse({ projectId: true }).success).toBe(false);
  });

  it('rejects projectId longer than 128 chars', () => {
    const tooLong = 'x'.repeat(129);
    expect(dashboardGetKpisSchema.safeParse({ projectId: tooLong }).success).toBe(false);
  });
});
