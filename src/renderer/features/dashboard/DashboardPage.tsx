/**
 * DashboardPage — top-level container for the Rolestra dashboard (R4).
 *
 * Responsibilities:
 * - Pull the KPI snapshot via `useDashboardKpis()` and the active-project
 *   id via `useActiveProject()`.
 * - Render the Hero row: 4 KPI tiles + 2 quick-action buttons.
 * - Surface loading/error states explicitly — never silently substitute
 *   stale or fake data when the snapshot fails to load.
 * - Own the ProjectCreateModal mount + open/close state (R4-Task9).
 *   The dashboard hosts the modal because both the Hero "+ 새 프로젝트"
 *   button and (later, Task 10) the ProjectRail "+ 새 프로젝트" entry
 *   share the same trigger surface; containing the modal here keeps the
 *   form state local without App-level prop drilling. If future work
 *   needs to trigger the modal from a sibling route we can lift this
 *   state to App.tsx — but as of Task 9 the dashboard is the only
 *   trigger source.
 * - Leave structural placeholders for Task 7 (2×2 widget grid) and
 *   Task 8 (insight strip) so App-level routing can mount the page today.
 *
 * Prop escape hatches:
 * - `onRequestNewProject` — when provided, the dashboard delegates to
 *   the caller (useful for tests that assert pass-through behaviour and
 *   for R6 when a deep-link needs to open the modal from outside).
 *   When NOT provided, the Hero button toggles the internally-hosted
 *   modal directly.
 * - `onRequestStartMeeting` defaults to a no-op; R6 wires the real flow.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { HeroKpiTile } from './HeroKpiTile';
import { HeroQuickActions } from './HeroQuickActions';
import { InsightStrip } from './InsightStrip';
import { TasksWidget } from './widgets/TasksWidget';
import { PeopleWidget } from './widgets/PeopleWidget';
import { RecentWidget } from './widgets/RecentWidget';
import { ApprovalsWidget } from './widgets/ApprovalsWidget';
import { ProjectCreateModal } from '../projects/ProjectCreateModal';
import { useActiveProject } from '../../hooks/use-active-project';
import { useDashboardKpis } from '../../hooks/use-dashboard-kpis';

export interface DashboardPageProps {
  /**
   * If provided, the "+ 새 프로젝트" button delegates to this callback
   * instead of opening the internal modal. If omitted, the dashboard
   * opens its own `<ProjectCreateModal>`.
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
  onRequestNewProject,
  onRequestStartMeeting = noop,
  className,
}: DashboardPageProps): ReactElement {
  const { t } = useTranslation();
  const { data, loading, error } = useDashboardKpis();
  const { activeProjectId } = useActiveProject();
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);

  const handleNewProject = (): void => {
    if (onRequestNewProject) {
      onRequestNewProject();
      return;
    }
    setCreateModalOpen(true);
  };

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
          onNewProject={handleNewProject}
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

      {/*
        R4-Task8 — Insight strip: 4 aggregate metrics (weekly delta, avg
        response, cumulative approvals, review completion). Values remain
        placeholders until R6 wires in the stream aggregates.
      */}
      <InsightStrip />

      {/*
        R4-Task9 — ProjectCreateModal. Only rendered when the dashboard
        owns the trigger (i.e. `onRequestNewProject` was NOT supplied).
        This avoids two modals fighting over open state when a parent
        (future App.tsx/global router) hosts its own copy.
      */}
      {!onRequestNewProject && (
        <ProjectCreateModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
        />
      )}
    </div>
  );
}
