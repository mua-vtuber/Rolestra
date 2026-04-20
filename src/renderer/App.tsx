import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import './i18n';
import { NavRail, ProjectRail, Shell, ShellTopBar } from './components/shell';
import type { NavRailItem, ProjectRailProject } from './components/shell';
import { DevThemeSwitcher } from './components/shell/theme-switcher';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProjectCreateModal } from './features/projects/ProjectCreateModal';
import { useActiveProject } from './hooks/use-active-project';
import { useProjects } from './hooks/use-projects';
import type { Project } from '../shared/project-types';

const NAV_ITEMS: ReadonlyArray<NavRailItem> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'messenger', icon: 'chat', label: 'Messenger' },
  { id: 'approval', icon: 'bell', label: 'Approval' },
  { id: 'queue', icon: 'queue', label: 'Queue' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

/**
 * Map a full `Project` row to the rail-friendly projection. We keep only
 * what `ProjectRail` consumes so the rail never depends on schema-level
 * fields (status, autonomyMode, etc.) that are irrelevant to navigation.
 * Icon defaults to `folder`; R5+ may add per-kind or per-theme icons.
 */
function toRailProject(project: Project): ProjectRailProject {
  return { id: project.id, name: project.name, icon: 'folder' };
}

export function App() {
  const { t } = useTranslation();
  const { projects } = useProjects();
  const { activeProjectId, setActive } = useActiveProject();
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const railProjects = useMemo(
    () => projects.map(toRailProject),
    [projects],
  );

  // Resolve the active project's display name from the already-loaded
  // `projects` array. We never trigger a second IPC to fetch the full
  // object — `useActiveProject` stores only the id on purpose.
  const activeProjectName: string | null = useMemo(() => {
    if (!activeProjectId) return null;
    const found = projects.find((p) => p.id === activeProjectId);
    return found ? found.name : null;
  }, [activeProjectId, projects]);

  const handleSelectProject = useCallback(
    (id: string): void => {
      // `setActive` calls `project:open` THEN updates the store.
      // A rejection here means the Main side refused the open (folder
      // missing, permission error, …). We keep the current active
      // project untouched and log — R4 does not render a toast; a
      // future iteration can add inline error UX.
      void setActive(id).catch((reason: unknown) => {
        console.warn('[rolestra] project:open failed', reason);
      });
    },
    [setActive],
  );

  const handleCreateProject = useCallback((): void => {
    setModalOpen(true);
  }, []);

  const handleProjectCreated = useCallback(
    (project: Project): void => {
      // Drop the user straight into the freshly-created project so the
      // dashboard + rail reflect it immediately. Same error policy as
      // `handleSelectProject` — log and keep current state on failure.
      void setActive(project.id).catch((reason: unknown) => {
        console.warn('[rolestra] project:open failed after create', reason);
      });
    },
    [setActive],
  );

  return (
    <Shell
      nav={<NavRail items={NAV_ITEMS} activeId="dashboard" />}
      rail={
        <ProjectRail
          projects={railProjects}
          activeProjectId={activeProjectId ?? undefined}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
        />
      }
      topBar={
        <ShellTopBar
          title={t('shell.topbar.title', 'Office')}
          activeProjectName={activeProjectName}
          rightSlot={import.meta.env.DEV ? <DevThemeSwitcher /> : undefined}
        />
      }
    >
      <DashboardPage onRequestNewProject={handleCreateProject} />
      <ProjectCreateModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={handleProjectCreated}
      />
    </Shell>
  );
}
