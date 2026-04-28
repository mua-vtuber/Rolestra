/**
 * DashboardPage — top-level container for the Rolestra dashboard (R4).
 *
 * Responsibilities:
 * - Pull the KPI snapshot via `useDashboardKpis()` and the active-project
 *   id via `useActiveProject()`.
 * - Render the Hero row: 4 KPI tiles + 2 quick-action buttons.
 * - Surface loading/error states explicitly — never silently substitute
 *   stale or fake data when the snapshot fails to load.
 *
 * Modal hosting (R4-Task10):
 * - The `ProjectCreateModal` is no longer owned by DashboardPage. It was
 *   lifted to `App.tsx` so both the Hero "+ 새 프로젝트" button AND the
 *   `ProjectRail` "+ 새 프로젝트" entry can share a single open/close
 *   state without prop-drilling a second instance through.
 * - `onRequestNewProject` is therefore the ONLY path to open the modal
 *   from inside the dashboard. R4 production always supplies it. For
 *   unit tests we fall back to a silent no-op so the page still renders.
 *
 * Prop escape hatches:
 * - `onRequestNewProject` — invoked when the user clicks the Hero's
 *   new-project button.
 * - `onRequestStartMeeting` — invoked when the user clicks the Hero's
 *   "회의 소집 →" button. App.tsx wires this to a messenger-view
 *   navigation: the actual `channel:start-meeting` IPC lives inside
 *   `StartMeetingModal`, mounted from a chosen channel. The dashboard
 *   button cannot launch a meeting on its own — it has no channel
 *   context — so the routing handoff is the canonical flow.
 *
 * F3 (cleanup-2026-04-27):
 * - The R4 Insight Strip (4-cell em-dash placeholder) was removed
 *   because it shipped no real data. V4 will reintroduce it once the
 *   week-windowed aggregates exist in the repositories. The
 *   `InsightStrip` component itself is kept as a presentation primitive
 *   for callers ready to pass real `cells`.
 */
import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { HeroKpiTile } from './HeroKpiTile';
import { HeroQuickActions } from './HeroQuickActions';
import { TasksWidget } from './widgets/TasksWidget';
import { PeopleWidget } from './widgets/PeopleWidget';
import { RecentWidget } from './widgets/RecentWidget';
import { ApprovalsWidget } from './widgets/ApprovalsWidget';
import { useActiveProject } from '../../hooks/use-active-project';
import { useDashboardKpis } from '../../hooks/use-dashboard-kpis';

export interface DashboardPageProps {
  /**
   * Invoked when the user clicks the Hero "+ 새 프로젝트" button.
   * App.tsx owns the `ProjectCreateModal` since R4-Task10 — when this
   * prop is omitted (unit-test default) the click is a no-op.
   */
  onRequestNewProject?: () => void;
  /** Invoked when the user clicks "회의 소집 →" (requires active project). */
  onRequestStartMeeting?: () => void;
  className?: string;
}

function noop(): void {
  /* intentionally empty — default for optional escape-hatch handlers */
}

export function DashboardPage({
  onRequestNewProject = noop,
  onRequestStartMeeting = noop,
  className,
}: DashboardPageProps): ReactElement {
  const { t } = useTranslation();
  const { data, loading, error } = useDashboardKpis();
  const { activeProjectId } = useActiveProject();

  // `data === null` covers both the initial fetch and the failure case
  // (the hook never fabricates a snapshot on initial error). Loading here
  // means "no data to show yet" — tiles render as skeletons.
  const showSkeletons = data === null;

  const errorMessage = error
    ? error.message && error.message.length > 0
      ? error.message
      : t('dashboard.error.kpi')
    : null;

  return (
    <div
      data-testid="dashboard-page"
      data-loading={loading ? 'true' : 'false'}
      className={clsx('flex flex-col gap-4 p-6', className)}
    >
      {errorMessage !== null && (
        <div
          role="alert"
          aria-label={t('dashboard.error.kpi')}
          data-testid="dashboard-error-banner"
          className="border border-danger rounded-panel px-4 py-3 text-sm text-danger bg-sunk"
        >
          {errorMessage}
        </div>
      )}

      <section
        data-testid="dashboard-hero"
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroKpiTile
            variant="projects"
            label={t('dashboard.kpi.activeProjects')}
            value={showSkeletons ? null : data.activeProjects}
          />
          <HeroKpiTile
            variant="meetings"
            label={t('dashboard.kpi.activeMeetings')}
            value={showSkeletons ? null : data.activeMeetings}
          />
          <HeroKpiTile
            variant="approvals"
            label={t('dashboard.kpi.pendingApprovals')}
            value={showSkeletons ? null : data.pendingApprovals}
          />
          <HeroKpiTile
            variant="completed"
            label={t('dashboard.kpi.completedToday')}
            value={showSkeletons ? null : data.completedToday}
          />
        </div>
        <HeroQuickActions
          hasActiveProject={Boolean(activeProjectId)}
          onNewProject={onRequestNewProject}
          onStartMeeting={onRequestStartMeeting}
        />
      </section>

      {/*
        R4-Task7 — 2×2 widget grid. The CSS `grid-template-areas` encodes
        spec §7.5: `tasks` spans two columns on row 1, `people` + `recent`
        sit under it on row 2, and `approvals` spans both rows on the
        right. Columns: 1fr / 1fr / minmax(20rem, 24rem) — the right
        column has a generous min/max so approval payload previews stay
        readable without hogging the full width on ultrawide displays.
      */}
      <section
        role="region"
        aria-label={t('dashboard.grid.ariaLabel')}
        data-testid="dashboard-grid"
        className="grid gap-3"
        style={{
          gridTemplateAreas: '"tasks tasks approvals" "people recent approvals"',
          gridTemplateColumns: '1fr 1fr minmax(20rem, 24rem)',
        }}
      >
        <TasksWidget className="[grid-area:tasks] min-h-[12rem]" />
        <PeopleWidget className="[grid-area:people] min-h-[10rem]" />
        <RecentWidget className="[grid-area:recent] min-h-[10rem]" />
        <ApprovalsWidget className="[grid-area:approvals] min-h-[22rem]" />
      </section>

    </div>
  );
}
