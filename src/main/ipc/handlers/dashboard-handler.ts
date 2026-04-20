/**
 * dashboard:* IPC handler.
 *
 * Single-endpoint surface — `dashboard:get-kpis` — fronts
 * {@link DashboardService}. The handler is a thin translator; the
 * service owns the aggregation + timezone semantics.
 *
 * `projectId` on the input is reserved for R6+ project-scoped KPIs
 * (spec §7.5 notes) and is ignored here. Accepting the field today
 * keeps the wire contract stable across phases.
 *
 * Accessor pattern mirrors `project-handler.ts` / `arena-root-handler.ts`:
 * main boot wires a lazy `() => DashboardService` closure, and handlers
 * throw a deterministic "not initialized" error if they fire before
 * that wiring happens (e.g. a renderer invocation during a broken
 * bootstrap).
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import type { DashboardService } from '../../dashboard/dashboard-service';

let dashboardAccessor: (() => DashboardService) | null = null;

/** Lazy wiring — set once by main/index.ts after service instantiation. */
export function setDashboardServiceAccessor(
  fn: () => DashboardService,
): void {
  dashboardAccessor = fn;
}

function getService(): DashboardService {
  if (!dashboardAccessor) {
    throw new Error('dashboard handler: service not initialized');
  }
  return dashboardAccessor();
}

/** dashboard:get-kpis — returns a fresh 4-KPI snapshot. */
export function handleDashboardGetKpis(
  _data: IpcRequest<'dashboard:get-kpis'>,
): IpcResponse<'dashboard:get-kpis'> {
  // `_data.projectId` is accepted on the wire but ignored until R6.
  const snapshot = getService().getKpis();
  return { snapshot };
}
