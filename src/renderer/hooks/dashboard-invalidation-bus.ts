/**
 * Dashboard invalidation bus — keeps the Dashboard surfaces fresh when
 * a project is created/archived from anywhere in the app.
 *
 * Mirrors the design of `channel-invalidation-bus.ts`: each consumer hook
 * (currently `useDashboardKpis`, future `useDashboardActivity` etc.)
 * registers a refetch callback at mount and the host fires
 * `notifyDashboardChanged()` after a project mutation completes. Without
 * this, the App-level `useProjects` instance refreshes (so the project
 * rail updates) but `useDashboardKpis` keeps its initial-mount snapshot,
 * leaving the activeProjects KPI stale until the user navigates away
 * and back.
 *
 * The bus stays renderer-only — main-side stream events (e.g.
 * `stream:project-updated`) would also work but no production caller
 * fires them today, and broadening that surface costs more than the
 * 25-line bus this file provides.
 *
 * Tests can call `__resetDashboardInvalidationBusForTests()` between
 * specs to keep the subscriber set clean.
 */

export type DashboardInvalidationCallback = () => void | Promise<void>;

const subscribers = new Set<DashboardInvalidationCallback>();

export function subscribeDashboardInvalidation(
  fn: DashboardInvalidationCallback,
): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export async function notifyDashboardChanged(): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const fn of subscribers) {
    try {
      const maybe = fn();
      if (maybe && typeof (maybe as Promise<void>).then === 'function') {
        pending.push(
          (maybe as Promise<void>).catch(() => {
            /* swallow per-subscriber failures */
          }),
        );
      }
    } catch {
      /* ignore sync subscriber throws */
    }
  }
  await Promise.all(pending);
}

/** @internal — vitest only. */
export function __resetDashboardInvalidationBusForTests(): void {
  subscribers.clear();
}
