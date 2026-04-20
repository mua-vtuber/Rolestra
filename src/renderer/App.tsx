import { useTranslation } from 'react-i18next';

import './i18n';
import { NavRail, ProjectRail, Shell, ShellTopBar } from './components/shell';
import type { NavRailItem } from './components/shell';
import type { ProjectRailProject } from './components/shell';
import { DevThemeSwitcher } from './components/shell/theme-switcher';

const NAV_ITEMS: ReadonlyArray<NavRailItem> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'messenger', icon: 'chat', label: 'Messenger' },
  { id: 'approval', icon: 'bell', label: 'Approval' },
  { id: 'queue', icon: 'queue', label: 'Queue' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

const PLACEHOLDER_PROJECTS: ReadonlyArray<ProjectRailProject> = [
  { id: 'p-demo', name: 'Demo Project', icon: 'folder' },
];

export function App() {
  const { t } = useTranslation();
  return (
    <Shell
      nav={<NavRail items={NAV_ITEMS} activeId="dashboard" />}
      rail={<ProjectRail projects={PLACEHOLDER_PROJECTS} activeProjectId="p-demo" />}
      topBar={
        <ShellTopBar
          title={t('shell.topbar.title', 'Office')}
          subtitle={t('shell.topbar.subtitle', 'Welcome')}
          rightSlot={import.meta.env.DEV ? <DevThemeSwitcher /> : undefined}
        />
      }
    >
      <div className="p-6 text-fg-muted text-sm">
        {t('app.mainPlaceholder', 'The dashboard will move in here during R4.')}
      </div>
    </Shell>
  );
}
